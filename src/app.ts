import { fileURLToPath } from "node:url";
import { createShiftWorkbook, MAX_EXPORT_ROWS } from "./services/export.service.js";
import { shiftFilter, RequestError } from "./services/shift-query.js";
import express, { type ErrorRequestHandler } from "express";
import jwt from "jsonwebtoken";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { Role, type PrismaClient } from "./generated/prisma/client.js";
import { authenticateToken, requireManager } from "./middleware/auth.js";
import { createShiftService } from "./services/shift.service.js";
import { hashPassword, verifyPassword } from "./password.js";

function credentials(body: unknown, registration = false) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const { email, password, name } = body as Record<string, unknown>;
  if (typeof email !== "string" || email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof password !== "string" || password.length === 0 || Buffer.byteLength(password) > 256) return null;
  if (registration && (password.length < 12 || typeof name !== "string" ||
      name.trim().length === 0 || name.length > 100)) return null;
  return { email, password, name: typeof name === "string" ? name.trim() : "" };
}

export function createApp(prisma: PrismaClient, secret: string) {
  const app = express();
  const authenticate = authenticateToken(prisma, secret);
  const shifts = createShiftService(prisma);
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "16kb" }));
  app.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  const limiter = (limit: number) => rateLimit({ windowMs: 15 * 60 * 1000, limit,
    standardHeaders: "draft-8", legacyHeaders: false,
    message: { error: "Çok fazla deneme. Lütfen daha sonra tekrar deneyin." } });


  app.get("/", (_req, res) => { res.redirect("/app/"); });
  app.use("/app", express.static(fileURLToPath(new URL("../public", import.meta.url))));
  app.get("/users", authenticate, requireManager, async (_req, res) => {
    const users = await prisma.user.findMany({ select: {
      id: true, email: true, name: true, role: true, createdAt: true
    } });
    res.json(users);
  });
  app.post("/register", limiter(10), async (req, res) => {
    const input = credentials(req.body, true);
    if (!input) return res.status(400).json({ error: "Geçerli e-posta, isim (1–100 karakter) ve şifre (en az 12 karakter, en çok 256 bayt) gerekli." });
    try {
      const password = await hashPassword(input.password);
      const user = await prisma.user.create({ data: {
        email: input.email, name: input.name, password, role: Role.WORKER
      } });
      return res.status(201).json({ id: user.id, email: user.email, name: user.name });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        return res.status(409).json({ error: "Bu email adresi zaten kullanımda." });
      }
      throw error;
    }
  });
  app.post("/login", limiter(20), async (req, res) => {
    const input = credentials(req.body);
    if (!input) return res.status(400).json({ error: "Geçerli e-posta ve şifre gerekli." });
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    const matches = await verifyPassword(input.password, user?.password);
    if (!user || !matches) return res.status(401).json({ error: "Email veya şifre hatalı" });
    const token = jwt.sign({ id: user.id }, secret, { algorithm: "HS256", expiresIn: "8h" });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  });
  app.post("/shifts/start", authenticate, async (req, res) => {
    res.status(201).json(await shifts.startShift(req.user!.id));
  });
  app.post("/shifts/end", authenticate, async (req, res) => {
    res.json({ message: "Vardiya başarıyla sonlandırıldı.", shift: await shifts.endShift(req.user!.id) });
  });
  app.get("/shifts/current", authenticate, async (req, res) => {
    res.json({ currentShift: await shifts.getCurrentShift(req.user!.id) ?? null });
  });
  app.get("/shifts", authenticate, async (req, res) => {
    const where = shiftFilter(req.query, req.user!);
    const pageInput = req.query.page ?? "1";
    if (typeof pageInput !== "string" || !/^[1-9]\d{0,3}$/.test(pageInput)) {
      throw new RequestError("Geçersiz sayfa numarası.", 400);
    }
    const page = Number(pageInput);
    const pageSize = 20;
    const [items, total] = await Promise.all([
      prisma.shift.findMany({ where, orderBy: [{ startTime: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize, take: pageSize,
        select: { id: true, startTime: true, endTime: true, status: true,
          user: { select: { id: true, name: true, email: true } } }
      }),
      prisma.shift.count({ where })
    ]);
    res.json({ items, total, page, pageSize });
  });
  app.get("/shifts/export", authenticate, limiter(5), async (req, res) => {
    const where = shiftFilter(req.query, req.user!);
    const buffer = await createShiftWorkbook(prisma, where);
    if (!buffer) {
      return res.status(413).json({ error: `En fazla ${MAX_EXPORT_ROWS} vardiya aktarılabilir. Tarih aralığını daraltın.` });
    }
    const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul" }).format(new Date());
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="vardiyalar-${date}.xlsx"`);
    res.send(Buffer.from(buffer));
  });
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    const status = error?.statusCode ?? error?.status;
    if (status === 413) return res.status(413).json({ error: "İstek boyutu çok büyük." });
    if (error?.type === "entity.parse.failed") return res.status(400).json({ error: "Geçersiz JSON." });
    if (error instanceof RequestError) return res.status(error.statusCode).json({ error: error.message });
    if (status === 404 || status === 409) return res.status(status).json({ error: error.message });
    res.status(500).json({ error: "Sunucu hatası oluştu." });
  };
  app.use(errorHandler);
  return app;
}
