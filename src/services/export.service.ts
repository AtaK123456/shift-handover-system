import ExcelJS from "exceljs";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

export const MAX_EXPORT_ROWS = 5000;
const columns = {
  id: true, startTime: true, endTime: true, status: true, shiftDate: true, scheduledStart: true, scheduledEnd: true,
  user: { select: { id: true, name: true, email: true } }
} as const;
const istanbul = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
});

export async function createShiftWorkbook(prisma: PrismaClient, where: Prisma.ShiftWhereInput, language: "tr" | "en" = "tr") {
  const rows = await prisma.shift.findMany({
    where,
    select: columns, orderBy: [{ startTime: "asc" }, { id: "asc" }], take: MAX_EXPORT_ROWS + 1
  });
  if (rows.length > MAX_EXPORT_ROWS) return null;

  const workbook = new ExcelJS.Workbook();
  const en = language === "en";
  workbook.creator = en ? "Shift Logbook" : "Vardiya Takip";
  const sheet = workbook.addWorksheet(en ? "Shifts" : "Vardiyalar");
  sheet.columns = [
    { header: "Vardiya No", key: "id", width: 14 },
    { header: "Personel No", key: "userId", width: 14 },
    { header: "Personel", key: "name", width: 28 },
    { header: "E-posta", key: "email", width: 34 },
    { header: "Başlangıç (İstanbul)", key: "start", width: 24 },
    { header: "Bitiş (İstanbul)", key: "end", width: 24 },
    { header: "Durum", key: "status", width: 18 },
    { header: "Vardiya tarihi", key: "shiftDate", width: 18 },
    { header: "Vardiya saatleri", key: "scheduled", width: 22 }
  ];
  if (en) {
    const headers = ["Shift ID", "Staff ID", "Staff member", "Email", "Start (Istanbul)", "End (Istanbul)", "Status", "Shift date", "Shift hours"];
    sheet.columns.forEach((column, index) => { column.header = headers[index]!; });
  }
  for (const row of rows) {
    sheet.addRow({
      id: row.id, userId: row.user.id, name: row.user.name, email: row.user.email,
      start: istanbul.format(row.startTime),
      end: row.endTime ? istanbul.format(row.endTime) : "",
      status: row.status === "ACTIVE" ? (en ? "Active" : "Aktif") : (en ? "Completed" : "Tamamlandı"),
      // User-supplied values remain string cells, never formulas.
      shiftDate: row.shiftDate || "",
      scheduled: row.scheduledStart && row.scheduledEnd ? `${row.scheduledStart}–${row.scheduledEnd}` : ""
    });
  }
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF155E75" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: "I1" };
  return workbook.xlsx.writeBuffer();
}
