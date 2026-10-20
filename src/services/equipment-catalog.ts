// Stable identifiers keep existing entries, change logs, and handover snapshots linked.
export const MAX_EQUIPMENT = 100;
export function validEquipmentCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z][A-Z0-9_-]{0,29}$/.test(value) && !["GENERAL", "UNKNOWN"].includes(value);
}
