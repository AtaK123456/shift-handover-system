import { RequestError } from "./shift-query.js";
const localDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul" });
export function shiftSchedule(body: unknown, now = new Date()) {
  const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const { shiftDate, scheduledStart, scheduledEnd } = input;
  if (shiftDate === undefined && scheduledStart === undefined && scheduledEnd === undefined) {
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", hourCycle: "h23" }).format(now));
    return { shiftDate: localDate.format(now), scheduledStart: hour < 8 ? "00:00" : hour < 16 ? "08:00" : "16:00", scheduledEnd: hour < 8 ? "08:00" : hour < 16 ? "16:00" : "00:00" };
  }
  const date = typeof shiftDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(shiftDate) ? new Date(`${shiftDate}T00:00:00Z`) : null;
  const time = (value: unknown): value is string => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== shiftDate || !time(scheduledStart) || !time(scheduledEnd) || scheduledStart === scheduledEnd) {
    throw new RequestError("Geçerli vardiya tarihi ve saat aralığı gerekli.", 400);
  }
  return { shiftDate: shiftDate as string, scheduledStart, scheduledEnd };
}
