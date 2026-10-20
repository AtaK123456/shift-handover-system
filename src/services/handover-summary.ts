import type { Prisma } from "../generated/prisma/client.js";
const preview = { id: true, title: true, description: true, kind: true, priority: true, equipmentCode: true, createdAt: true } as const;
const boardKinds = ["VALVE", "ATTENTION", "TASK"] as const;
export async function handoverSummary(tx: Prisma.TransactionClient, userId: number) {
  const revision = await tx.operationRevision.findUniqueOrThrow({ where: { id: 1 } });
  const equipment = await tx.equipment.findMany({ orderBy: { code: "asc" }, include: { updatedBy: { select: { id: true, name: true } } } });
  const groups = await tx.operationEntry.groupBy({ by: ["kind", "priority"], where: { closedAt: null, kind: { in: [...boardKinds] } }, _count: true });
  const counts = { total: 0, important: 0, VALVE: 0, ATTENTION: 0, TASK: 0 };
  for (const group of groups) { counts.total += group._count; if (group.priority === "HIGH") counts.important += group._count; counts[group.kind as typeof boardKinds[number]] += group._count; }
  const important = await tx.operationEntry.findMany({ where: { closedAt: null, kind: { in: [...boardKinds] }, priority: "HIGH" }, take: 5, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: preview });
  const recent = await tx.operationEntry.findMany({ where: { kind: { in: ["EVENT", "NOTE"] } }, take: 5, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: preview });
  const tasks = await tx.operationEntry.findMany({ where: { closedAt: null, kind: "TASK" }, take: 5, orderBy: [{ priority: "desc" }, { createdAt: "desc" }, { id: "desc" }], select: preview });
  const valves = await tx.operationEntry.findMany({ where: { closedAt: null, kind: "VALVE" }, take: 5, orderBy: [{ priority: "desc" }, { createdAt: "desc" }, { id: "desc" }], select: preview });
  const shift = await tx.shift.findFirst({ where: { userId, status: "ACTIVE" }, select: { id: true } });
  const receipt = shift ? await tx.handoverRead.findFirst({ where: { userId, shiftId: shift.id }, orderBy: [{ revision: "desc" }, { id: "desc" }], select: { id: true, revision: true, readAt: true } }) : null;
  return { revision: revision.version, equipment, counts, important, recent, tasks, valves, activeShiftId: shift?.id ?? null, receipt };
}
