import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { RequestError } from "./shift-query.js";
export const updateSelect = { id: true, entryId: true, body: true, createdAt: true, author: { select: { id: true, name: true } } } as const;
// Fetch one latest note and its total per entry in one bounded result set.
export async function updatePreviews(db: Pick<Prisma.TransactionClient, "$queryRaw">, ids: number[]) {
  const result = new Map<number, { _count: { updates: number }; updates: Array<{ id: number; entryId: number; body: string; createdAt: Date; author: { id: number; name: string } }> }>();
  if (!ids.length) return result;
  const rows = await db.$queryRaw<Array<{ id: number; entryId: number; body: string; createdAt: Date; authorId: number; name: string; total: bigint }>>(Prisma.sql`
    SELECT DISTINCT ON (u."entryId") u.id, u."entryId", u.body, u."createdAt", u."authorId", a.name,
      COUNT(*) OVER (PARTITION BY u."entryId") AS total
    FROM "OperationUpdate" u JOIN "User" a ON a.id = u."authorId"
    WHERE u."entryId" IN (${Prisma.join([...new Set(ids)])})
    ORDER BY u."entryId", u."createdAt" DESC, u.id DESC`);
  for (const row of rows) result.set(row.entryId, { _count: { updates: Number(row.total) }, updates: [{ id: row.id, entryId: row.entryId, body: row.body, createdAt: row.createdAt, author: { id: row.authorId, name: row.name } }] });
  return result;
}
export const emptyUpdates = { _count: { updates: 0 }, updates: [] };
const kinds = ["TASK", "VALVE", "ATTENTION"] as const;
export async function appendUpdate(db: PrismaClient, entryId: number, authorId: number, body: string, requestId: string) {
  return db.$transaction(async tx => {
    // Serialize with closure and acknowledgement; failed/replayed writes do not change revision.
    await tx.$queryRaw`SELECT id FROM "OperationRevision" WHERE id = 1 FOR UPDATE`;
    const existing = await tx.operationUpdate.findUnique({ where: { authorId_requestId: { authorId, requestId } }, select: updateSelect });
    if (existing) {
      if (existing.entryId !== entryId || existing.body !== body) throw new RequestError("UPDATE_REQUEST_CONFLICT", 409);
      return { item: existing, replay: true };
    }
    const entry = await tx.operationEntry.findUnique({ where: { id: entryId }, select: { kind: true, closedAt: true } });
    if (!entry) throw new RequestError("UPDATE_ENTRY_NOT_FOUND", 404);
    if (entry.closedAt || !kinds.includes(entry.kind as typeof kinds[number])) throw new RequestError("UPDATE_ENTRY_CLOSED", 409);
    const item = await tx.operationUpdate.create({ data: { entryId, authorId, body, requestId, createdAt: new Date() }, select: updateSelect });
    await tx.operationRevision.update({ where: { id: 1 }, data: { version: { increment: 1 } } });
    return { item, replay: false };
  });
}
export async function listUpdates(tx: Prisma.TransactionClient, entryId: number, page: number) {
  const entry = await tx.operationEntry.findUnique({ where: { id: entryId }, select: { id: true, title: true, kind: true, closedAt: true } });
  if (!entry) throw new RequestError("UPDATE_ENTRY_NOT_FOUND", 404);
  const items = await tx.operationUpdate.findMany({ where: { entryId }, select: updateSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20, skip: (page - 1) * 20 });
  const total = await tx.operationUpdate.count({ where: { entryId } });
  return { entry, items, total, page, pageSize: 20, canWrite: !entry.closedAt && kinds.includes(entry.kind as typeof kinds[number]) };
}
