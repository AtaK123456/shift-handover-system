import { Router } from "express";
import multer from "multer";
import sharp from "sharp";
import { rateLimit } from "express-rate-limit";
import { EntryKind, EntryPriority, EquipmentStatus, type PrismaClient } from "../generated/prisma/client.js";
import { RequestError } from "../services/shift-query.js";
const user = { select: { id: true, name: true } } as const;
const entrySelect = { id: true, kind: true, priority: true, title: true, description: true, createdAt: true,
  shiftId: true, author: user, closedAt: true, closedBy: user, closeNote: true,
  photos: { select: { id: true } } } as const;
const boardKinds: EntryKind[] = [EntryKind.VALVE, EntryKind.ATTENTION, EntryKind.TASK];
function text(value: unknown, min: number, max: number) {
  if (typeof value !== "string" || value.trim().length < min || value.length > max) throw new RequestError("Metin alanlarını kontrol edin.", 400);
  return value.trim();
}
function id(value: unknown) {
  if (typeof value !== "string" || !/^[1-9]\d{0,8}$/.test(value)) throw new RequestError("Geçersiz kayıt numarası.", 400);
  return Number(value);
}
export function createOperationsRouter(prisma: PrismaClient) {
  const router = Router();
  const uploads = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 3, fields: 4, fieldSize: 16000 },
    fileFilter: (_req, file, done) => {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) return done(new RequestError("Yalnızca JPEG, PNG veya WebP fotoğraf yükleyin.", 400));
      done(null, true);
    }
  });
  const writeLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false,
    message: { error: "Çok fazla deneme. Lütfen daha sonra tekrar deneyin." } });
  router.get("/equipment", async (_req, res) => {
    res.json({ items: await prisma.equipment.findMany({ orderBy: { code: "asc" }, include: { updatedBy: user } }) });
  });
  router.put("/equipment/:code", writeLimit, async (req, res) => {
    const { status, version } = req.body ?? {};
    const code = req.params.code;
    if (typeof code !== "string" || !["GT1", "GT2", "ST"].includes(code) || !Object.values(EquipmentStatus).includes(status) || !Number.isSafeInteger(version) || version < 0 || version >= 2147483647) {
      throw new RequestError("Ekipman durumunu kontrol edin.", 400);
    }
    const note = text(req.body.note ?? "", 0, 1000);
    const result = await prisma.$transaction(async tx => {
      const existing = await tx.equipment.findUniqueOrThrow({ where: { code } });
      const update = await tx.equipment.updateMany({ where: { code, version }, data: { status, note, version: { increment: 1 }, updatedById: req.user!.id, updatedAt: new Date() } });
      if (!update.count) throw new RequestError("Kayıt başka bir kullanıcı tarafından güncellendi. Yenileyip tekrar deneyin.", 409);
      await tx.equipmentChange.create({ data: { equipmentCode: code, fromStatus: existing.status, toStatus: status, note, userId: req.user!.id } });
      return tx.equipment.findUniqueOrThrow({ where: { code }, include: { updatedBy: user } });
    });
    res.json(result);
  });
  router.get("/entries", async (req, res) => {
    const { view = "open", page = "1" } = req.query;
    if (!["open", "history"].includes(String(view)) || typeof view !== "string" || typeof page !== "string" || !/^[1-9]\d{0,3}$/.test(page)) throw new RequestError("Geçersiz filtre parametresi.", 400);
    const where = view === "open" ? { closedAt: null, kind: { in: boardKinds } } : { OR: [{ kind: { in: [EntryKind.EVENT, EntryKind.NOTE] } }, { closedAt: { not: null } }] };
    const [items, total] = await Promise.all([
      prisma.operationEntry.findMany({ where, select: entrySelect, take: 20, skip: (Number(page) - 1) * 20, orderBy: view === "open" ? [{ priority: "desc" }, { createdAt: "desc" }, { id: "desc" }] : [{ createdAt: "desc" }, { id: "desc" }] }),
      prisma.operationEntry.count({ where })
    ]);
    res.json({ items, total, page: Number(page), pageSize: 20 });
  });
  router.post("/entries", writeLimit, uploads.array("photos", 3), async (req, res) => {
    const { kind, priority = "NORMAL" } = req.body ?? {};
    if (!Object.values(EntryKind).includes(kind) || !Object.values(EntryPriority).includes(priority)) throw new RequestError("Geçerli bir kayıt türü seçin.", 400);
    const title = text(req.body.title, 1, 160);
    const description = text(req.body.description, 1, 4000);
    const photos: { data: Uint8Array<ArrayBuffer> }[] = [];
    for (const file of (req.files ?? []) as Express.Multer.File[]) {
      try {
        const image = sharp(file.buffer, { limitInputPixels: 20_000_000, animated: false });
        const meta = await image.metadata();
        if (!meta.format || !["jpeg", "png", "webp"].includes(meta.format) || (meta.pages ?? 1) > 1) throw new Error("Invalid image");
        const data = await image.rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
        photos.push({ data: new Uint8Array(data) });
      } catch { throw new RequestError("Fotoğraf okunamadı. Geçerli JPEG, PNG veya WebP seçin.", 400); }
    }
    const shift = await prisma.shift.findFirst({ where: { userId: req.user!.id, status: "ACTIVE" }, select: { id: true } });
    const entry = await prisma.operationEntry.create({ data: { kind, priority, title, description, authorId: req.user!.id,
      ...(shift ? { shiftId: shift.id } : {}), photos: { create: photos } }, select: entrySelect });
    res.status(201).json(entry);
  });
  router.post("/entries/:id/close", writeLimit, async (req, res) => {
    const entryId = id(req.params.id);
    const closeNote = text(req.body?.closeNote ?? "", 0, 1000);
    const updated = await prisma.operationEntry.updateMany({ where: { id: entryId, closedAt: null, kind: { in: boardKinds } },
      data: { closedAt: new Date(), closedById: req.user!.id, closeNote } });
    if (!updated.count) throw new RequestError("Kayıt bulunamadı veya zaten kapatıldı.", 409);
    res.json(await prisma.operationEntry.findUniqueOrThrow({ where: { id: entryId }, select: entrySelect }));
  });
  router.get("/photos/:id", async (req, res) => {
    if (typeof req.params.id !== "string" || !/^[a-f0-9-]{36}$/i.test(req.params.id)) throw new RequestError("Fotoğraf bulunamadı.", 404);
    const photo = await prisma.operationPhoto.findUnique({ where: { id: req.params.id }, select: { data: true } });
    if (!photo) throw new RequestError("Fotoğraf bulunamadı.", 404);
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Disposition", 'inline; filename="photo.jpg"');
    res.send(Buffer.from(photo.data));
  });
  return router;
}
