import ExcelJS from "exceljs";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

export const MAX_EXPORT_ROWS = 5000;
const columns = {
  id: true, startTime: true, endTime: true, status: true,
  user: { select: { id: true, name: true, email: true } }
} as const;
const istanbul = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
});

export async function createShiftWorkbook(prisma: PrismaClient, where: Prisma.ShiftWhereInput) {
  const rows = await prisma.shift.findMany({
    where,
    select: columns, orderBy: [{ startTime: "asc" }, { id: "asc" }], take: MAX_EXPORT_ROWS + 1
  });
  if (rows.length > MAX_EXPORT_ROWS) return null;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Vardiya Takip";
  const sheet = workbook.addWorksheet("Vardiyalar");
  sheet.columns = [
    { header: "Vardiya No", key: "id", width: 14 },
    { header: "Personel No", key: "userId", width: 14 },
    { header: "Personel", key: "name", width: 28 },
    { header: "E-posta", key: "email", width: 34 },
    { header: "Başlangıç (İstanbul)", key: "start", width: 24 },
    { header: "Bitiş (İstanbul)", key: "end", width: 24 },
    { header: "Durum", key: "status", width: 18 },
    { header: "Süre (saat)", key: "hours", width: 16 }
  ];
  for (const row of rows) {
    sheet.addRow({
      id: row.id, userId: row.user.id, name: row.user.name, email: row.user.email,
      start: istanbul.format(row.startTime),
      end: row.endTime ? istanbul.format(row.endTime) : "",
      status: row.status === "ACTIVE" ? "Aktif" : "Tamamlandı",
      // Active shifts have no final duration. Strings are kept as string cells, never formulas.
      hours: row.endTime ? Math.max(0, row.endTime.getTime() - row.startTime.getTime()) / 3600000 : null
    });
  }
  sheet.getColumn("hours").numFmt = "0.00";
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF155E75" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: "H1" };
  return workbook.xlsx.writeBuffer();
}
