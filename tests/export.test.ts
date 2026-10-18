import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import jwt from "jsonwebtoken";
import ExcelJS from "exceljs";
import { createApp } from "../src/app.js";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { MAX_EXPORT_ROWS } from "../src/services/export.service.js";
const secret = "export-test-secret-".repeat(3);
const sample = { id: 7, startTime: new Date("2026-10-19T05:00:00Z"), endTime: new Date("2026-10-19T13:30:00Z"), status: "COMPLETED", user: { id: 1, name: '=HYPERLINK("https://example.com")', email: "a@example.com" } };
function setup(role = "WORKER", rows = [sample]) {
  let query: any;
  let counted: any;
  const db = { user: { findUnique: async () => ({ id: 1, role, email: "a@example.com" }) },
    shift: { findMany: async (input: any) => { query = input; return rows; }, count: async (input: any) => { counted = input; return rows.length; } } };
  return { app: createApp(db as unknown as PrismaClient, secret), query: () => query, counted: () => counted };
}
const authorization = `Bearer ${jwt.sign({ id: 1, role: "MANAGER" }, secret, { expiresIn: "1h" })}`;
async function workbook(response: any) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(response.body);
  return book.getWorksheet("Vardiyalar")!;
}
function download(app: ReturnType<typeof createApp>, query = "") {
  return request(app).get(`/shifts/export${query}`).set("Authorization", authorization)
    .buffer(true).parse((res, done) => { const chunks: Buffer[] = []; res.on("data", chunk => chunks.push(Buffer.from(chunk))); res.on("end", () => done(null, Buffer.concat(chunks))); });
}
test("Excel export and history require authentication", async () => {
  const { app, query } = setup();
  await request(app).get("/shifts/export").expect(401);
  await request(app).get("/shifts").expect(401);
  assert.equal(query(), undefined);
});
test("export is a real XLSX, uses own-user filter, and keeps untrusted text out of formulas", async () => {
  const { app, query } = setup();
  const res = await download(app).expect(200);
  assert.match(res.headers["content-type"], /spreadsheetml/);
  assert.match(res.headers["content-disposition"], /^attachment; filename="vardiyalar-\d{4}-\d{2}-\d{2}\.xlsx"$/);
  const sheet = await workbook(res);
  assert.equal(sheet.getCell("C2").value, sample.user.name);
  assert.equal(sheet.getCell("C2").type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell("E2").value, "2026-10-19 08:00:00");
  assert.equal(sheet.getCell("H2").value, 8.5);
  assert.equal(query().where.userId, 1);
  assert.equal(query().take, MAX_EXPORT_ROWS + 1);
  assert.deepEqual(query().select.user.select, { id: true, name: true, email: true });
});
test("team export/list is manager-only regardless of token role or requested userId", async () => {
  for (const role of ["WORKER", "SUPERVISOR"]) {
    const { app, query } = setup(role);
    await request(app).get("/shifts/export?scope=all").set("Authorization", authorization).expect(403);
    await request(app).get("/shifts?scope=all").set("Authorization", authorization).expect(403);
    assert.equal(query(), undefined);
  }
  const { app, query } = setup("MANAGER");
  await download(app, "?scope=all").expect(200);
  assert.equal(query().where.userId, undefined);
  await request(app).get("/shifts?userId=999").set("Authorization", authorization).expect(400);
  await request(app).get("/shifts?scope=own").set("Authorization", authorization).expect(200);
  assert.equal(query().where.userId, 1);
});
test("inclusive date filters use Istanbul boundaries and are shared by list/export", async () => {
  const { app, query, counted } = setup();
  const url = "?from=2026-10-19&to=2026-10-19";
  await request(app).get(`/shifts${url}`).set("Authorization", authorization).expect(200);
  const where = query().where;
  assert.equal(where.startTime.gte.toISOString(), "2026-10-18T21:00:00.000Z");
  assert.equal(where.startTime.lt.toISOString(), "2026-10-19T21:00:00.000Z");
  assert.deepEqual(counted().where, where);
  await download(app, url).expect(200);
  assert.deepEqual(query().where, where);
});
test("bad date, scope and page parameters return 400", async () => {
  const { app } = setup();
  for (const query of ["from=2026-02-30", "from=bad", "from=2026-10-20&to=2026-10-19", "scope=other", "from[]=2026-10-19"]) {
    await request(app).get(`/shifts?${query}`).set("Authorization", authorization).expect(400);
    await request(app).get(`/shifts/export?${query}`).set("Authorization", authorization).expect(400);
  }
  for (const page of ["0", "-1", "1.5", "10000", "abc"]) await request(app).get(`/shifts?page=${page}`).set("Authorization", authorization).expect(400);
});
test("history is paginated and selects only public fields", async () => {
  const { app, query } = setup();
  const res = await request(app).get("/shifts?page=2").set("Authorization", authorization).expect(200);
  assert.equal(query().skip, 20); assert.equal(query().take, 20);
  assert.equal(query().select.password, undefined);
  assert.equal(res.body.page, 2); assert.equal(res.body.pageSize, 20);
});
test("empty export has headers; active shifts have no final end or duration", async () => {
  const empty = await workbook(await download(setup("WORKER", []).app).expect(200));
  assert.equal(empty.rowCount, 1);
  const active = { ...sample, endTime: null, status: "ACTIVE" };
  const { app } = setup("WORKER", [active] as any);
  const sheet = await workbook(await download(app).expect(200));
  assert.equal(sheet.getCell("G2").value, "Aktif");
  assert.equal(sheet.getCell("H2").value, null);
});
test("oversized exports are rejected without silently truncating, with rate limiting", async () => {
  const { app } = setup("WORKER", Array(MAX_EXPORT_ROWS + 1).fill(sample));
  await request(app).get("/shifts/export").set("Authorization", authorization).expect(413);
  const fresh = setup("WORKER", []).app;
  for (let i=0; i<5; i++) await download(fresh).expect(200);
  await request(fresh).get("/shifts/export").set("Authorization", authorization).expect(429);
});
test("frontend assets are served with the security policy", async () => {
  const { app } = setup();
  await request(app).get("/").expect(302).expect("Location", "/app/");
  const res = await request(app).get("/app/").expect(200);
  assert.match(res.text, /Vardiya Defteri/);
  assert.match(res.headers["content-security-policy"], /script-src 'self'/);
  await request(app).get("/app/app.js").expect(200);
});
