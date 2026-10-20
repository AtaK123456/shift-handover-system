import type { Request } from "express";
import { EntryKind, EntryPriority, type Prisma } from "../generated/prisma/client.js";
import { parseShiftDate, RequestError } from "./shift-query.js";
export function operationQuery(query: Request["query"]) {
  const invalid = () => new RequestError("Geçersiz filtre parametresi.", 400);
  if (Object.keys(query).some(key => !["view", "page", "q", "kind", "equipment", "priority", "status", "from", "to"].includes(key))) throw invalid();
  const { view = "open", page = "1", q, kind, equipment, priority, status, from, to } = query;
  if (typeof view !== "string" || !["open", "history", "all"].includes(view) || typeof page !== "string" || !/^[1-9]\d{0,3}$/.test(page)) throw invalid();
  const conditions: Prisma.OperationEntryWhereInput[] = [];
  if (view === "open") conditions.push({ closedAt: null, kind: { in: [EntryKind.VALVE, EntryKind.ATTENTION, EntryKind.TASK] } });
  if (view === "history") conditions.push({ OR: [{ kind: { in: [EntryKind.EVENT, EntryKind.NOTE] } }, { closedAt: { not: null } }] });
  if (q !== undefined) {
    if (typeof q !== "string" || q.length > 160) throw invalid();
    if (q.trim()) {
      const search = q.trim().replace(/[\\%_]/g, "\\$&");
      conditions.push({ OR: ["title", "description", "closeNote"].map(field => ({ [field]: { contains: search, mode: "insensitive" } })) });
    }
  }
  if (kind !== undefined) { if (typeof kind !== "string" || !Object.values(EntryKind).includes(kind as EntryKind)) throw invalid(); conditions.push({ kind: kind as EntryKind }); }
  if (equipment !== undefined) { if (typeof equipment !== "string" || !["GT1", "GT2", "ST", "GENERAL"].includes(equipment)) throw invalid(); conditions.push({ equipmentCode: equipment === "GENERAL" ? null : equipment }); }
  if (priority !== undefined) { if (typeof priority !== "string" || !Object.values(EntryPriority).includes(priority as EntryPriority)) throw invalid(); conditions.push({ priority: priority as EntryPriority }); }
  if (status !== undefined) { if (status !== "open" && status !== "closed") throw invalid(); conditions.push(status === "open" ? { closedAt: null, kind: { in: [EntryKind.VALVE, EntryKind.ATTENTION, EntryKind.TASK] } } : { closedAt: { not: null } }); }
  const start = from === undefined ? undefined : parseShiftDate(from), end = to === undefined ? undefined : parseShiftDate(to);
  if (start === null || end === null || (start && end && start > end)) throw invalid();
  if (start || end) conditions.push({ createdAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: new Date(end.getTime() + 86400000) } : {}) } });
  return { where: { AND: conditions } as Prisma.OperationEntryWhereInput, page: Number(page), view };
}
