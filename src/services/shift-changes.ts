import { Prisma } from "../generated/prisma/client.js";
import { shiftSchedule } from "./schedule.js";

const types = ["NEW_ENTRY", "CLOSED_ENTRY", "PROGRESS", "EQUIPMENT", "WORK_DETAILS"] as const;
type ChangeType = typeof types[number];
type ChangeRow = {
  type: ChangeType; id: number; entryId: number | null; kind: string | null;
  title: string; body: string; equipmentCode: string | null;
  fromStatus: string | null; toStatus: string | null;
  workDetails: { workStatus: string; responsibleTeam: string; nextStep: string } | null;
  actorName: string | null; createdAt: Date; total: bigint;
};

export function currentShiftWindow(now = new Date()) {
  const slot = shiftSchedule({}, now);
  const start = new Date(`${slot.shiftDate}T${slot.scheduledStart}:00+03:00`);
  return { ...slot, start, end: new Date(start.getTime() + 8 * 60 * 60 * 1000) };
}

export async function shiftChanges(tx: Prisma.TransactionClient, now = new Date()) {
  const window = currentShiftWindow(now);
  const since = window.start;
  // A half-open shift interval and a fixed observation time prevent future records
  // or the next shift's boundary from leaking into this read-only preview.
  const until = new Date(Math.min(now.getTime(), window.end.getTime() - 1));
  // Each indexed source contributes at most eight rows plus its exact count.
  // One round trip, at most 40 rows, no per-entry history/photo lookups.
  const rows = await tx.$queryRaw<ChangeRow[]>(Prisma.sql`
    (SELECT 'NEW_ENTRY' AS type, e.id, e.id AS "entryId", e.kind::text,
      e.title, e.description AS body, e."equipmentCode",
      NULL::text AS "fromStatus", NULL::text AS "toStatus", a.name AS "actorName",
      e."createdAt", NULL::jsonb AS "workDetails", COUNT(*) OVER () AS total
      FROM "OperationEntry" e JOIN "User" a ON a.id = e."authorId"
      WHERE e.kind IN ('TASK', 'VALVE', 'ATTENTION') AND e."createdAt" >= ${since} AND e."createdAt" <= ${until}
      ORDER BY e."createdAt" DESC, e.id DESC LIMIT 8)
    UNION ALL
    (SELECT 'CLOSED_ENTRY', e.id, e.id, e.kind::text, e.title,
      COALESCE(e."closeNote", ''), e."equipmentCode", NULL::text, NULL::text, a.name,
      e."closedAt", NULL::jsonb AS "workDetails", COUNT(*) OVER ()
      FROM "OperationEntry" e LEFT JOIN "User" a ON a.id = e."closedById"
      WHERE e.kind IN ('TASK', 'VALVE', 'ATTENTION') AND e."closedAt" >= ${since} AND e."closedAt" <= ${until}
      ORDER BY e."closedAt" DESC, e.id DESC LIMIT 8)
    UNION ALL
    (SELECT 'PROGRESS', u.id, e.id, e.kind::text, e.title, u.body,
      e."equipmentCode", NULL::text, NULL::text, a.name, u."createdAt", NULL::jsonb AS "workDetails", COUNT(*) OVER ()
      FROM "OperationUpdate" u JOIN "OperationEntry" e ON e.id = u."entryId"
      JOIN "User" a ON a.id = u."authorId"
      WHERE u."createdAt" >= ${since} AND u."createdAt" <= ${until}
      ORDER BY u."createdAt" DESC, u.id DESC LIMIT 8)
    UNION ALL
    (SELECT 'EQUIPMENT', c.id, NULL::int, NULL::text, c."equipmentCode", c.note,
      c."equipmentCode", c."fromStatus"::text, c."toStatus"::text, a.name,
      c."createdAt", NULL::jsonb AS "workDetails", COUNT(*) OVER ()
      FROM "EquipmentChange" c JOIN "User" a ON a.id = c."userId"
      WHERE c."equipmentCode" IN ('GT1', 'GT2', 'ST') AND c."createdAt" >= ${since} AND c."createdAt" <= ${until}
      ORDER BY c."createdAt" DESC, c.id DESC LIMIT 8)
    UNION ALL
    (SELECT 'WORK_DETAILS', w.id, e.id, e.kind::text, e.title, '', e."equipmentCode",
      NULL::text, NULL::text, a.name, w."createdAt",
      jsonb_build_object('workStatus', w."workStatus", 'responsibleTeam', w."responsibleTeam", 'nextStep', w."nextStep"), COUNT(*) OVER ()
      FROM "WorkDetailChange" w JOIN "OperationEntry" e ON e.id = w."entryId" JOIN "User" a ON a.id = w."authorId"
      WHERE w.version > 0 AND w."createdAt" >= ${since} AND w."createdAt" <= ${until}
      ORDER BY w."createdAt" DESC, w.id DESC LIMIT 8)
  `);
  const counts: Record<ChangeType, number> = { NEW_ENTRY: 0, CLOSED_ENTRY: 0, PROGRESS: 0, EQUIPMENT: 0, WORK_DETAILS: 0 };
  for (const row of rows) counts[row.type] = Number(row.total);
  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || types.indexOf(a.type) - types.indexOf(b.type) || b.id - a.id);
  return {
    shiftDate: window.shiftDate, scheduledStart: window.scheduledStart, scheduledEnd: window.scheduledEnd,
    since, counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0),
    items: rows.slice(0, 8).map(({ total: _count, ...item }) => item)
  };
}
