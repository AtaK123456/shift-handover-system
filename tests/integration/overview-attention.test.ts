import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { createPrismaClient } from "../../src/database.js";
import { createApp } from "../../src/app.js";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL must point to a disposable database.");

test("overview includes normal attention items, prioritizes important work, and drops closed items", async () => {
  const db = createPrismaClient(url), secret = "attention-test-secret-".repeat(3);
  let userId: number | undefined;
  try {
    userId = (await db.user.create({ data: { email: `attention-${randomUUID()}@example.com`, name: "Attention Tester", password: "unused" } })).id;
    const auth = `Bearer ${jwt.sign({ id: userId }, secret, { expiresIn: "1h" })}`, app = createApp(db, secret);
    const normal = await db.operationEntry.create({ data: { authorId: userId, kind: "ATTENTION", priority: "NORMAL", title: "Monitor oil level", description: "Carry forward until checked" } });
    const high = await db.operationEntry.create({ data: { authorId: userId, kind: "ATTENTION", priority: "HIGH", title: "Inspection required", description: "Priority assigned by operator", createdAt: new Date("2020-01-01") } });
    const summary = async () => (await request(app).get("/operations/summary").set("Authorization", auth).expect(200)).body;
    const first = await summary();
    assert.equal(first.counts.ATTENTION, 2);
    assert.deepEqual(first.openItems.map((item: any) => item.id), [high.id, normal.id]);
    assert.equal(new Set(first.openItems.map((item: any) => item.id)).size, first.openItems.length);
    assert.deepEqual(first.attention.map((item: any) => item.id), [high.id, normal.id]);
    assert.ok(first.important.some((item: any) => item.id === high.id));
    assert.ok(!first.important.some((item: any) => item.id === normal.id));
    await request(app).post(`/operations/entries/${normal.id}/close`).set("Authorization", auth).send({ closeNote: "Checked" }).expect(200);
    const filtered = await request(app).get("/operations/entries?view=open&kind=ATTENTION&equipment=GENERAL&priority=HIGH").set("Authorization", auth).expect(200);
    assert.deepEqual(filtered.body.items.map((item: any) => item.id), [high.id]);
    await request(app).get("/operations/entries?view=open&priority=URGENT").set("Authorization", auth).expect(400);
    await request(app).get("/operations/entries?view=open&priority[]=HIGH").set("Authorization", auth).expect(400);
    const after = await summary();
    assert.equal(after.counts.ATTENTION, 1);
    assert.ok(!after.openItems.some((item: any) => item.id === normal.id));
    assert.ok(!after.attention.some((item: any) => item.id === normal.id));
    assert.ok((await db.operationEntry.findUniqueOrThrow({ where: { id: normal.id } })).closedAt);
  } finally {
    if (userId) { await db.operationEntry.deleteMany({ where: { authorId: userId } }); await db.user.delete({ where: { id: userId } }); }
    await db.$disconnect();
  }
});
