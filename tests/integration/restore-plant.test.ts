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

test("retained compatibility migration preserves existing equipment codes and references", async () => {
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

test("restoring plant workflow disables catalog writes without deleting custom definitions or their work", async () => {
  const db = createPrismaClient(url), suffix = randomUUID().slice(0,8), code = `OLD-${suffix.toUpperCase()}`;
  let userId: number | undefined, entryId: number | undefined;
  try {
    userId = (await db.user.create({ data: { email: `restore-${suffix}@example.com`, name: "Restore Tester", password: "unused", role: "MANAGER" } })).id;
    const auth = `Bearer ${jwt.sign({ id: userId }, secret, { expiresIn: "1h" })}`, app = createApp(db, secret);
    await db.equipment.create({ data: { code, name: "Previously configured area", status: "ACTIVE", note: "Retain this note" } });
    const entry = await db.operationEntry.create({ data: { authorId: userId, equipmentCode: code, kind: "TASK", priority: "HIGH", title: "Existing handover work", description: "Keep the original reference" } }); entryId = entry.id;
    const get = (path: string) => request(app).get(path).set("Authorization", auth);
    const units = await get("/operations/equipment").expect(200);
    assert.deepEqual(units.body.items.map((item: any) => item.code), ["GT1", "GT2", "ST"]);
    const summary = (await get("/operations/summary").expect(200)).body;
    assert.deepEqual(summary.equipment.map((item: any) => item.code), ["GT1", "GT2", "ST"]);
    assert.ok(summary.important.some((item: any) => item.id === entryId));
    assert.ok((await get("/operations/entries?view=open")).body.items.some((item: any) => item.id === entryId && item.equipmentCode === code));
    await request(app).post("/operations/equipment").set("Authorization", auth).send({ code: "NEW-AREA", name: "Not supported" }).expect(404);
    await request(app).patch(`/operations/equipment/${code}`).set("Authorization", auth).send({ name: "Overwrite", version: 0 }).expect(404);
    await request(app).put(`/operations/equipment/${code}`).set("Authorization", auth).send({ status: "INACTIVE", version: 0 }).expect(400);
    await request(app).post("/operations/entries").set("Authorization", auth).send({ kind: "NOTE", title: "New record", description: "Unsupported equipment", equipmentCode: code }).expect(400);
    await request(app).post(`/operations/entries/${entryId}/close`).set("Authorization", auth).send({ closeNote: "Existing work completed" }).expect(200);
    const stored = await db.operationEntry.findUniqueOrThrow({ where: { id: entryId } });
    assert.equal(stored.equipmentCode, code); assert.equal(stored.closeNote, "Existing work completed");
    const equipment = await db.equipment.findUniqueOrThrow({ where: { code } });
    assert.equal(equipment.name, "Previously configured area"); assert.equal(equipment.status, "ACTIVE"); assert.equal(equipment.note, "Retain this note");
    assert.ok((await get("/operations/entries?view=history")).body.items.some((item: any) => item.id === entryId));
  } finally {
    if (entryId) await db.operationEntry.deleteMany({ where: { id: entryId } });
    await db.equipment.deleteMany({ where: { code } });
    if (userId) await db.user.deleteMany({ where: { id: userId } }); await db.$disconnect();
  }
});
