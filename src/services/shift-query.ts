import type { Request } from "express";
import type { Prisma } from "../generated/prisma/client.js";

export class RequestError extends Error {
  constructor(message: string, public readonly statusCode: number) { super(message); }
}

export function parseShiftDate(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const check = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(check.getTime()) || check.toISOString().slice(0, 10) !== value) return null;
  return new Date(`${value}T00:00:00+03:00`);
}

export function shiftFilter(query: Request["query"], user: { id: number; role: string }): Prisma.ShiftWhereInput {
  if (Object.keys(query).some(key => !["from", "to", "scope", "page"].includes(key))) {
    throw new RequestError("Geçersiz filtre parametresi.", 400);
  }
  const { from, to, scope = "own" } = query;
  if (scope !== "own" && scope !== "all") throw new RequestError("Geçersiz kapsam.", 400);
  if (scope === "all" && user.role !== "MANAGER") {
    throw new RequestError("Tüm personeli görmek için yönetici yetkisi gerekli.", 403);
  }
  const start = from === undefined ? undefined : parseShiftDate(from);
  const end = to === undefined ? undefined : parseShiftDate(to);
  if (start === null || end === null || (start && end && start > end)) {
    throw new RequestError("Geçerli bir tarih aralığı seçin (YYYY-AA-GG).", 400);
  }
  return {
    ...(scope === "own" ? { userId: user.id } : {}),
    startTime: {
      ...(start ? { gte: start } : {}),
      ...(end ? { lt: new Date(end.getTime() + 86400000) } : {})
    }
  };
}
