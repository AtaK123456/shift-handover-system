import { WorkStatus, type Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { RequestError } from "./shift-query.js";
export const workSelect = { workStatus: true, responsibleTeam: true, nextStep: true, workVersion: true } as const;
const entrySelect = { id: true, title: true, kind: true, closedAt: true, ...workSelect } as const;
const changeSelect = { id: true, version: true, workStatus: true, responsibleTeam: true, nextStep: true, createdAt: true, author: { select: { id: true, name: true } } } as const;
export const boardKinds = ["TASK", "VALVE", "ATTENTION"] as const;
export function workFields(input: Record<string, unknown>) {
  const status = input.workStatus ?? "OPEN";
  const field = (value: unknown, max: number) => {
    if (typeof value !== "string" || value.length > max || value.includes("\0")) throw new RequestError("WORK_INVALID", 400);
    return value.trim();
  };
  if (typeof status !== "string" || !Object.values(WorkStatus).includes(status as WorkStatus)) throw new RequestError("WORK_INVALID", 400);
  return { workStatus: status as WorkStatus, responsibleTeam: field(input.responsibleTeam ?? "", 120), nextStep: field(input.nextStep ?? "", 1000) };
}
export async function readWork(tx: Prisma.TransactionClient, entryId: number, page: number) {
  const entry = await tx.operationEntry.findUnique({ where: { id: entryId }, select: entrySelect });
  if (!entry || !boardKinds.includes(entry.kind as typeof boardKinds[number])) throw new RequestError("WORK_NOT_FOUND", 404);
  const items = await tx.workDetailChange.findMany({ where: { entryId }, select: changeSelect, take: 20, skip: (page - 1) * 20, orderBy: [{ version: "desc" }] });
  const total = await tx.workDetailChange.count({ where: { entryId } });
  return { entry, items, total, page, pageSize: 20, canWrite: !entry.closedAt };
}
export async function writeWork(db: PrismaClient, entryId: number, authorId: number, input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new RequestError("WORK_INVALID", 400);
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some(key => !["version", "workStatus", "responsibleTeam", "nextStep"].includes(key)) ||
    !Number.isInteger(body.version) || (body.version as number) < 0 || (body.version as number) >= 2147483647 ||
    !["workStatus", "responsibleTeam", "nextStep"].every(key => typeof body[key] === "string")) throw new RequestError("WORK_INVALID", 400);
  const values = workFields(body);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "OperationRevision" WHERE id = 1 FOR UPDATE`;
    const entry = await tx.operationEntry.findUnique({ where: { id: entryId }, select: entrySelect });
    if (!entry || !boardKinds.includes(entry.kind as typeof boardKinds[number])) throw new RequestError("WORK_NOT_FOUND", 404);
    if (entry.closedAt) throw new RequestError("WORK_CLOSED", 409);
    const same = entry.workStatus === values.workStatus && entry.responsibleTeam === values.responsibleTeam && entry.nextStep === values.nextStep;
    // Identical retries are harmless; stale, different edits never overwrite newer work.
    if (entry.workVersion !== body.version && !same) throw new RequestError("WORK_CONFLICT", 409);
    if (same) return entry;
    const updated = await tx.operationEntry.update({ where: { id: entryId }, data: { ...values, workVersion: { increment: 1 } }, select: entrySelect });
    await tx.workDetailChange.create({ data: { entryId, authorId, version: updated.workVersion, ...values, createdAt: new Date() } });
    await tx.operationRevision.update({ where: { id: 1 }, data: { version: { increment: 1 } } });
    return updated;
  });
}
