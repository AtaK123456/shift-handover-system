import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import jwt from "jsonwebtoken";
import request from "supertest";
import { createPrismaClient } from "../../src/database.js";
import { createApp } from "../../src/app.js";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL must point to a disposable database.");
const secret = "work-details-integration-".repeat(3);

test("migration adds work tracking without changing existing open/closed records, photos or notes", async () => {
  const client = new pg.Client({ connectionString: url }); await client.connect();
  const schema = `work_migration_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}"`);
    const root = new URL("../../prisma/migrations/", import.meta.url);
    for (const directory of (await readdir(root)).filter(name => /^\d/.test(name) && name < "20261022000200_work_details").sort()) {
      await client.query(await readFile(new URL(`${directory}/migration.sql`, root), "utf8"));
    }
    await client.query(`INSERT INTO "User" (id,email,name,password) VALUES (1,'migration@example.com','Operator','retained-hash');
      INSERT INTO "OperationEntry" (id,kind,title,description,"authorId","equipmentCode","createdAt","closedAt","closedById","closeNote") VALUES
      (1,'TASK','Open work','Original open description',1,'GT1','2020-01-01',NULL,NULL,NULL),
      (2,'ATTENTION','Closed work','Original closed description',1,'GT2','2020-01-01','2020-01-02',1,'Completed');
      INSERT INTO "OperationPhoto" (id,"entryId",data) VALUES ('retained-photo',2,decode('010203','hex'));
      INSERT INTO "OperationUpdate" ("entryId","authorId",body,"requestId") VALUES (1,1,'Retained progress note','00000000-0000-0000-0000-000000000001')`);
    const before = (await client.query('SELECT row_to_json(e) AS value FROM "OperationEntry" e ORDER BY id')).rows.map(row => row.value);
    await client.query(await readFile(new URL("20261022000200_work_details/migration.sql", root), "utf8"));
    const after = (await client.query('SELECT row_to_json(e) AS value FROM "OperationEntry" e ORDER BY id')).rows.map(row => row.value);
    for (const row of after) {
      assert.equal(row.workStatus, "OPEN"); assert.equal(row.responsibleTeam, ""); assert.equal(row.nextStep, ""); assert.equal(row.workVersion, 0);
      for (const key of ["workStatus", "responsibleTeam", "nextStep", "workVersion"]) delete row[key];
    }
    assert.deepEqual(after, before);
    assert.equal((await client.query('SELECT body FROM "OperationUpdate"')).rows[0].body, "Retained progress note");
    assert.deepEqual((await client.query('SELECT data FROM "OperationPhoto"')).rows[0].data, Buffer.from([1,2,3]));
    assert.equal((await client.query('SELECT COUNT(*)::int AS total FROM "WorkDetailChange"')).rows[0].total, 0);
  } finally { await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await client.end(); }
});
async function fixture() {
  const db = createPrismaClient(url), users: number[] = [];
  for (let i=0; i<2; i++) users.push((await db.user.create({ data: { name: `Work Operator ${i}`, email: `work-${randomUUID()}@example.com`, password: "private-hash" } })).id);
  const app = createApp(db, secret), auth = users.map(id => `Bearer ${jwt.sign({ id }, secret, { expiresIn: "1h" })}`);
  const entry = await db.operationEntry.create({ data: { authorId: users[0]!, kind: "TASK", title: "Old GT1 work", description: "Keep original description", equipmentCode: "GT1", createdAt: new Date("2020-01-01") } });
  const get = (path: string) => request(app).get(path).set("Authorization", auth[0]!);
  const patch = (body: object, who=0) => request(app).patch(`/operations/entries/${entry.id}/work`).set("Authorization", auth[who]!).send(body);
  const cleanup = async () => {
    await db.handoverRead.deleteMany({ where: { userId: { in: users } } });
    await db.operationEntry.deleteMany({ where: { authorId: { in: users } } });
    await db.shift.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } }); await db.$disconnect();
  };
  return { db, app, users, auth, entry, get, patch, cleanup };
}

test("work details protect concurrent edits, retain author history and invalidate acknowledgments without changing original records", async () => {
  const f = await fixture(), path = `/operations/entries/${f.entry.id}/work`;
  const values = { version: 0, workStatus: "IN_PROGRESS", responsibleTeam: " Mechanical maintenance ", nextStep: "Inspect bearing" };
  try {
    await request(f.app).get(path).expect(401); await request(f.app).patch(path).send(values).expect(401);
    await request(f.app).post("/shifts/start").set("Authorization", f.auth[0]!).send({}).expect(201);
    const before = (await f.get("/operations/summary").expect(200)).body;
    await request(f.app).post("/operations/summary/read").set("Authorization", f.auth[0]!).send({ revision: before.revision }).expect(200);
    const saved = (await f.patch(values).expect(200)).body;
    assert.equal(saved.workVersion, 1); assert.equal(saved.responsibleTeam, "Mechanical maintenance");
    assert.equal(saved.workStatus, "IN_PROGRESS"); assert.equal(saved.nextStep, "Inspect bearing");
    const snapshot = (await f.get("/operations/summary").expect(200)).body;
    assert.equal(snapshot.revision, before.revision + 1);
    assert.equal(snapshot.openItems.find((item: any) => item.id === f.entry.id).nextStep, "Inspect bearing");
    assert.ok(snapshot.changes.items.some((item: any) => item.type === "WORK_DETAILS" && item.entryId === f.entry.id && item.workDetails.workStatus === "IN_PROGRESS"));
    await request(f.app).post("/operations/summary/read").set("Authorization", f.auth[0]!).send({ revision: before.revision }).expect(409);
    await f.patch(values).expect(200); // Lost-response replay adds no change/revision.
    assert.equal((await f.get("/operations/summary").expect(200)).body.revision, snapshot.revision);
    await f.patch({ ...values, nextStep: "Stale overwrite" }, 1).expect(409);
    const racing = await Promise.all([
      f.patch({ ...values, version: 1, workStatus: "WAITING", nextStep: "Await parts" }),
      f.patch({ ...values, version: 1, nextStep: "Await inspection" }, 1)
    ]);
    assert.deepEqual(racing.map(result => result.status).sort(), [200, 409]);
    const history = (await f.get(path).expect(200)).body;
    assert.equal(history.total, 2); assert.equal(history.entry.workVersion, 2);
    assert.equal(history.items[1].author.id, f.users[0]); assert.equal(history.items[1].nextStep, "Inspect bearing");
    assert.ok(!JSON.stringify(history).includes("private-hash")); assert.ok(!JSON.stringify(history).includes("@example.com"));
    await request(f.app).post(`/operations/entries/${f.entry.id}/close`).set("Authorization", f.auth[1]!).send({ closeNote: "Completed" }).expect(200);
    await f.patch({ ...values, version: 2 }).expect(409);
    const closed = (await f.get(path).expect(200)).body;
    assert.equal(closed.canWrite, false); assert.equal(closed.total, 2); assert.ok(closed.entry.closedAt);
    const original = await f.db.operationEntry.findUniqueOrThrow({ where: { id: f.entry.id } });
    assert.equal(original.description, "Keep original description"); assert.equal(original.createdAt.toISOString(), "2020-01-01T00:00:00.000Z");
    const retained = (await f.get("/operations/entries?view=history").expect(200)).body.items.find((item: any) => item.id === f.entry.id);
    assert.equal(retained.workVersion, 2); assert.equal(retained.closeNote, "Completed");
  } finally { await f.cleanup(); }
});

test("work inputs, initial creation, paginated history and closure races remain consistent", async () => {
  const f = await fixture(), path = `/operations/entries/${f.entry.id}/work`, values = { version: 0, workStatus: "WAITING", responsibleTeam: "Electrical", nextStep: "Check supply" };
  try {
    for (const extra of [{ workStatus: "CLOSED" }, { version: -1 }, { version: "0" }, { responsibleTeam: "x".repeat(121) }, { nextStep: "x".repeat(1001) }, { nextStep: "a\0b" }, { authorId: f.users[1] }, { nextStep: null }]) await f.patch({ ...values, ...extra }).expect(400);
    await f.patch({ version: 0 }).expect(400);
    for (const query of ["?page=0", "?page=1&page=2", "?authorId=1"]) await f.get(path + query).expect(400);
    await f.get("/operations/entries/99999999/work").expect(404);
    const event = await f.db.operationEntry.create({ data: { authorId: f.users[0]!, kind: "EVENT", title: "Event", description: "Observation" } });
    await f.get(`/operations/entries/${event.id}/work`).expect(404);
    const created = (await request(f.app).post("/operations/entries").set("Authorization", f.auth[0]!)
      .field("kind", "TASK").field("priority", "NORMAL").field("title", "New work").field("description", "Initial text").field("equipmentCode", "GT2")
      .field("workStatus", "WAITING").field("responsibleTeam", "Electrical").field("nextStep", "Check supply").expect(201)).body;
    assert.equal(created.workStatus, "WAITING"); assert.equal(created.workVersion, 0);
    const initial = (await f.get(`/operations/entries/${created.id}/work`).expect(200)).body;
    assert.equal(initial.total, 1); assert.equal(initial.items[0].version, 0);
    await f.db.workDetailChange.createMany({ data: Array.from({ length: 25 }, (_,i) => ({ entryId: created.id, authorId: f.users[0]!, version: i+1, workStatus: "WAITING" as const, responsibleTeam: "Electrical", nextStep: `Step ${i+1}` })) });
    const first = (await f.get(`/operations/entries/${created.id}/work?page=1`).expect(200)).body;
    const second = (await f.get(`/operations/entries/${created.id}/work?page=2`).expect(200)).body;
    assert.equal(first.items.length, 20); assert.equal(second.items.length, 6); assert.equal(first.total, 26);
    assert.equal(first.items[0].version, 25); assert.equal(second.items.at(-1).version, 0);
    const [changed, closed] = await Promise.all([
      f.patch(values), request(f.app).post(`/operations/entries/${f.entry.id}/close`).set("Authorization", f.auth[1]!).send({ closeNote: "Closed during editing" })
    ]);
    assert.equal(closed.status, 200); assert.ok([200,409].includes(changed.status));
    assert.equal(await f.db.workDetailChange.count({ where: { entryId: f.entry.id } }), changed.status === 200 ? 1 : 0);
    await f.patch(values).expect(409);
  } finally { await f.cleanup(); }
});
