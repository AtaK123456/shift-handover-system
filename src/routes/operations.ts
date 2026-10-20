import { requireManager } from "../middleware/auth.js";
import { MAX_EQUIPMENT, validEquipmentCode } from "../services/equipment-catalog.js";
import { handoverSummary } from "../services/handover-summary.js";
import { operationQuery } from "../services/operation-query.js";
import { Prisma } from "../generated/prisma/client.js";
import { Router } from "express";
import multer from "multer";
import sharp from "sharp";
import { rateLimit } from "express-rate-limit";
import { EntryKind, EntryPriority, EquipmentStatus, type PrismaClient } from "../generated/prisma/client.js";
import { RequestError } from "../services/shift-query.js";
const user = { select: { id: true, name: true } } as const;
const entrySelect = { id: true, kind: true, priority: true, title: true, description: true, createdAt: true,
  shiftId: true, equipmentCode: true, author: user, closedAt: true, closedBy: user, closeNote: true,
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
  const uploads = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 3, fields: 5, fieldSize: 16000 },
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
  router.post("/equipment", requireManager, writeLimit, async (req, res) => {
    const { code, name } = req.body ?? {};
    if (!validEquipmentCode(code) || Object.keys(req.body).some(key => !["code", "name"].includes(key))) throw new RequestError("EQUIPMENT_INVALID_CODE", 400);
    const label = text(name, 1, 100);
    try {
      const item = await prisma.$transaction(async tx => {
        await tx.operationRevision.update({ where: { id: 1 }, data: { version: { increment: 1 } } });
        if (await tx.equipment.count() >= MAX_EQUIPMENT) throw new RequestError("EQUIPMENT_LIMIT", 409);
        return tx.equipment.create({ data: { code, name: label } });
      });
      res.status(201).json(item);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") throw new RequestError("EQUIPMENT_CODE_EXISTS", 409);
      throw error;
    }
  });
  router.patch("/equipment/:code", requireManager, writeLimit, async (req, res) => {
    const { name, version } = req.body ?? {};
    if (!validEquipmentCode(req.params.code) || !Number.isSafeInteger(version) || version < 0 || version >= 2147483647 || Object.keys(req.body).some(key => !["name", "version"].includes(key))) throw new RequestError("EQUIPMENT_INVALID_DETAILS", 400);
    const label = text(name, 1, 100);
    const item = await prisma.$transaction(async tx => {
      await tx.operationRevision.update({ where: { id: 1 }, data: { version: { increment: 1 } } });
      const updated = await tx.equipment.updateMany({ where: { code: String(req.params.code), version }, data: { name: label, version: { increment: 1 } } });
      if (!updated.count) throw new RequestError("EQUIPMENT_CHANGED", 409);
      return tx.equipment.findUniqueOrThrow({ where: { code: String(req.params.code) }, include: { updatedBy: user } });
    });
    res.json(item);
  });
  router.put("/equipment/:code", writeLimit, async (req, res) => {
    const { status, version } = req.body ?? {};
    const code = req.params.code;
    if (!validEquipmentCode(code) || !Object.values(EquipmentStatus).includes(status) || !Number.isSafeInteger(version) || version < 0 || version >= 2147483647) {
      throw new RequestError("Ekipman durumunu kontrol edin.", 400);
    }
    const note = text(req.body.note ?? "", 0, 1000);
    const result = await prisma.$transaction(async tx => {
      await tx.operationRevision.update({ where: { id: 1 }, data: { version: { increment: 1 } } });
      const existing = await tx.equipment.findUnique({ where: { code } });
      if (!existing) throw new RequestError("EQUIPMENT_NOT_FOUND", 404);
      const update = await tx.equipment.updateMany({ where: { code, version }, data: { status, note, version: { increment: 1 }, updatedById: req.user!.id, updatedAt: new Date() } });
      if (!update.count) throw new RequestError("Kayıt başka bir kullanıcı tarafından güncellendi. Yenileyip tekrar deneyin.", 409);
      await tx.equipmentChange.create({ data: { equipmentCode: code, fromStatus: existing.status, toStatus: status, note, userId: req.user!.id } });
      return tx.equipment.findUniqueOrThrow({ where: { code }, include: { updatedBy: user } });
    });
    res.json(result);
  });
  router.get("/entries", async (req, res) => {
    const { where, page, view } = operationQuery(req.query);
    if (req.query.equipment && req.query.equipment !== "GENERAL" && !await prisma.equipment.findUnique({ where: { code: String(req.query.equipment) }, select: { code: true } })) throw new RequestError("EQUIPMENT_NOT_FOUND", 400);
    const [items, total] = await Promise.all([
      prisma.operationEntry.findMany({ where, select: entrySelect, take: 20, skip: (Number(page) - 1) * 20, orderBy: view === "open" ? [{ priority: "desc" }, { createdAt: "desc" }, { id: "desc" }] : [{ createdAt: "desc" }, { id: "desc" }] }),
      prisma.operationEntry.count({ where })
    ]);
    res.json({ items, total, page: Number(page), pageSize: 20 });
  });
  router.post("/entries", writeLimit, uploads.array("photos", 3), async (req, res) => {
    const { kind, priority = "NORMAL" } = req.body ?? {};
    if (!Object.values(EntryKind).includes(kind) || !Object.values(EntryPriority).includes(priority)) throw new RequestError("Geçerli bir kayıt türü seçin.", 400);
    const equipmentCode = [undefined, null, ""].includes(req.body.equipmentCode) ? null : req.body.equipmentCode;
    if (equipmentCode !== null && !validEquipmentCode(equipmentCode)) throw new RequestError("Ekipman durumunu kontrol edin.", 400);
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
    const entry = await prisma.$transaction(async tx => {
      await tx.operationRevision.update({ where: { id: 1 }, data: { version: { increment: 1 } } });
      if (equipmentCode !== null && !await tx.equipment.findUnique({ where: { code: equipmentCode }, select: { code: true } })) throw new RequestError("EQUIPMENT_NOT_FOUND", 400);
      const shift = await tx.shift.findFirst({ where: { userId: req.user!.id, status: "ACTIVE" }, select: { id: true } });
      return tx.operationEntry.create({ data: { kind, priority, title, description, equipmentCode, authorId: req.user!.id,
        ...(shift ? { shiftId: shift.id } : {}), photos: { create: photos } }, select: entrySelect });
    });
    res.status(201).json(entry);
  });
  router.post("/entries/:id/close", writeLimit, async (req, res) => {
    const entryId = id(req.params.id);
    const closeNote = text(req.body?.closeNote ?? "", 0, 1000);
    const entry = await prisma.$transaction(async tx => {
      await tx.operationRevision.update({ where: { id: 1 }, data: { version: { increment: 1 } } });
      const updated = await tx.operationEntry.updateMany({ where: { id: entryId, closedAt: null, kind: { in: boardKinds } },
        data: { closedAt: new Date(), closedById: req.user!.id, closeNote } });
      if (!updated.count) throw new RequestError("Kayıt bulunamadı veya zaten kapatıldı.", 409);
      return tx.operationEntry.findUniqueOrThrow({ where: { id: entryId }, select: entrySelect });
    });
    res.json(entry);
  });
  router.get("/summary", async (req, res) => {
    res.json(await prisma.$transaction(tx => handoverSummary(tx, req.user!.id), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
  });
  router.post("/summary/read", writeLimit, async (req, res) => {
    const revision = req.body?.revision;
    if (!Number.isInteger(revision) || revision < 0 || revision > 2147483647) throw new RequestError("Geçersiz özet sürümü.", 400);
    const receipt = await prisma.$transaction(async tx => {
      // Lock the same row as every operations write, so an unseen update cannot be acknowledged.
      const locked = await tx.operationRevision.updateMany({ where: { id: 1, version: revision }, data: { version: revision } });
      if (!locked.count) throw new RequestError("Devir özeti değişti. Güncel özeti inceleyip tekrar onaylayın.", 409);
      const summary = await handoverSummary(tx, req.user!.id);
      if (!summary.activeShiftId) throw new RequestError("Devri onaylamadan önce vardiyanızı başlatın.", 409);
      const active = await tx.shift.updateMany({ where: { id: summary.activeShiftId, userId: req.user!.id, status: "ACTIVE" }, data: { status: "ACTIVE" } });
      if (!active.count) throw new RequestError("Devri onaylamadan önce vardiyanızı başlatın.", 409);
      const { receipt: _previous, ...snapshot } = summary;
      return tx.handoverRead.upsert({ where: { userId_shiftId_revision: { userId: req.user!.id, shiftId: summary.activeShiftId, revision } },
        create: { userId: req.user!.id, shiftId: summary.activeShiftId, revision, snapshot: JSON.parse(JSON.stringify(snapshot)) }, update: {},
        select: { id: true, revision: true, readAt: true } });
    });
    res.json(receipt);
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
