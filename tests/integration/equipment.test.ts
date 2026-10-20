import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import jwt from "jsonwebtoken";
import request from "supertest";
import { createPrismaClient } from "../../src/database.js";
import { createApp } from "../../src/app.js";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL must point to a disposable database.");
const secret = "equipment-integration-secret-".repeat(3);

test("catalog migration preserves existing equipment codes and entry references", async () => {
  const client = new pg.Client({ connectionString: url }); await client.connect();
  const schema = `catalog_migration_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}";
      CREATE TABLE "Equipment" (code TEXT PRIMARY KEY);
      CREATE TABLE "LegacyEntry" (id INTEGER PRIMARY KEY, "equipmentCode" TEXT REFERENCES "Equipment"(code));
      INSERT INTO "Equipment" VALUES ('GT1'), ('GT2'), ('ST');
      INSERT INTO "LegacyEntry" VALUES (1, 'GT1');`);
    await client.query(await readFile(new URL("../../prisma/migrations/20261020000100_equipment_catalog_names/migration.sql", import.meta.url), "utf8"));
    assert.deepEqual((await client.query('SELECT code, name FROM "Equipment" ORDER BY code')).rows, ["GT1", "GT2", "ST"].map(code => ({ code, name: code })));
    assert.equal((await client.query('SELECT "equipmentCode" FROM "LegacyEntry" WHERE id=1')).rows[0].equipmentCode, "GT1");
  } finally { await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await client.end(); }
});

test("manager catalog changes preserve links, enforce roles and versions, and feed custom codes to AI", async () => {
  const db = createPrismaClient(url), suffix = randomUUID().slice(0,8), code = `AREA-${suffix.toUpperCase()}`;
  const users: number[] = [], codes: string[] = [code];
  try {
    for (const role of ["MANAGER", "WORKER"] as const) users.push((await db.user.create({ data: { email: `${role}-${suffix}@example.com`, name: role, password: "unused", role } })).id);
    const auth = users.map(id => `Bearer ${jwt.sign({ id, role: "MANAGER" }, secret, { expiresIn: "1h" })}`);
    let supplied: any;
    const app = createApp(db, secret, { analyzer: async input => {
      supplied = input; return { equipment: code, category: "OTHER", kind: "NOTE", priority: "UNKNOWN", rationale: "Review the record.", uncertainty: "Insufficient details.", evidence: [input.description], questions: [] };
    } });
    const get = (path: string) => request(app).get(path).set("Authorization", auth[1]!);
    const post = (path: string, body: object, who = 0) => request(app).post(path).set("Authorization", auth[who]!).send(body);
    const patch = (body: object, who = 0) => request(app).patch(`/operations/equipment/${code}`).set("Authorization", auth[who]!).send(body);
    await request(app).post("/operations/equipment").send({ code, name: "Depot A" }).expect(401);
    await post("/operations/equipment", { code, name: "Depot A" }, 1).expect(403);
    await patch({ name: "Intrusion", version: 0 }, 1).expect(403);
    for (const invalid of ["", "depot-a", "GENERAL", "UNKNOWN", "A/B", "A".repeat(31), 5]) await post("/operations/equipment", { code: invalid, name: "Invalid" }).expect(400);
    await post("/operations/equipment", { code, name: " " }).expect(400);
    await post("/operations/equipment", { code, name: "x".repeat(101) }).expect(400);
    const created = await post("/operations/equipment", { code, name: " Depot A " }).expect(201);
    assert.equal(created.body.name, "Depot A"); assert.equal(created.body.status, "UNKNOWN");
    const rev = (await get("/operations/summary")).body.revision;
    await post("/operations/equipment", { code, name: "Duplicate" }).expect(409);
    assert.equal((await get("/operations/summary")).body.revision, rev);
    const work = await post("/operations/entries", { kind: "TASK", title: "Depot check", description: "Check pending", equipmentCode: code }, 1).expect(201);
    await request(app).put(`/operations/equipment/${code}`).set("Authorization", auth[1]!).send({ status: "ACTIVE", note: "Work in progress", version: 0 }).expect(200);
    const renamed = await patch({ name: "Warehouse A", version: 1 }).expect(200);
    assert.equal(renamed.body.version, 2); assert.equal(renamed.body.note, "Work in progress");
    await patch({ name: "Stale overwrite", version: 1 }).expect(409);
    await patch({ name: "Illegal code change", version: 2, code: "OTHER" }).expect(400);
    const record = await get(`/operations/entries?view=all&equipment=${code}`).expect(200);
    assert.equal(record.body.items[0].id, work.body.id); assert.equal(record.body.items[0].equipmentCode, code);
    await request(app).put(`/operations/equipment/${code}`).set("Authorization", auth[1]!).send({ status: "INACTIVE", version: 2, name: "Worker rename" }).expect(200);
    assert.equal((await db.equipment.findUniqueOrThrow({ where: { code } })).name, "Warehouse A");
    await post("/operations/entries", { kind: "NOTE", title: "Bad link", description: "Test", equipmentCode: "ABSENT" }).expect(400);
    await get("/operations/entries?equipment=ABSENT").expect(400);
    await request(app).put("/operations/equipment/ABSENT").set("Authorization", auth[1]!).send({ status: "ACTIVE", version: 0 }).expect(404);
    await post("/ai/analyze", { title: "Depot", description: "Warehouse A needs review.", language: "en" }, 1).expect(200);
    assert.ok(supplied.equipmentCatalog.some((item: any) => item.code === code && item.name === "Warehouse A"));
    await post("/ai/analyze", { title: "Depot", description: "Review", language: "en", equipmentCatalog: [{ code: "FAKE", name: "Fake" }] }, 1).expect(400);
    const count = await db.equipment.count();
    const fillers = Array.from({ length: 99 - count }, (_, i) => ({ code: `CAP-${suffix.toUpperCase()}-${i}`, name: `Area ${i}` }));
    codes.push(...fillers.map(item => item.code)); await db.equipment.createMany({ data: fillers });
    const racing = [`RACE-A-${suffix.toUpperCase()}`, `RACE-B-${suffix.toUpperCase()}`]; codes.push(...racing);
    const race = await Promise.all(racing.map(code => post("/operations/equipment", { code, name: "Concurrent area" })));
    assert.deepEqual(race.map(r => r.status).sort(), [201, 409]); assert.equal(await db.equipment.count(), 100);
  } finally {
    await db.operationEntry.deleteMany({ where: { authorId: { in: users } } });
    await db.equipmentChange.deleteMany({ where: { userId: { in: users } } });
    await db.equipment.deleteMany({ where: { code: { in: codes } } });
    await db.user.deleteMany({ where: { id: { in: users } } }); await db.$disconnect();
  }
});
