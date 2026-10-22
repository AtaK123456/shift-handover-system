import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { createPrismaClient } from "../../src/database.js";
import { createApp } from "../../src/app.js";
import { shiftChanges } from "../../src/services/shift-changes.js";
import { Prisma } from "../../src/generated/prisma/client.js";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL must point to a disposable database.");

test("shift changes count all four sources, include boundaries and old work updates, and bound the merged preview", async () => {
  const db = createPrismaClient(url), secret = "shift-changes-test-".repeat(3);
  const user = await db.user.create({ data: { name: "Shift Observer", email: `changes-${randomUUID()}@example.com`, password: "private-hash" } });
  const instant = (time: string) => new Date(`2026-10-22T${time}Z`);
  const read = (now: Date) => db.$transaction(tx => shiftChanges(tx, now), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  try {
    const old = await db.operationEntry.create({ data: { authorId: user.id, kind: "TASK", title: "Old ongoing work", description: "Original description", equipmentCode: "GT1", createdAt: instant("04:59:59.999") } });
    const boundary = await db.operationEntry.create({ data: { authorId: user.id, kind: "ATTENTION", title: "Start boundary", description: "Inspect", createdAt: instant("05:00:00.000") } });
    await db.operationEntry.createMany({ data: [
      { authorId: user.id, kind: "NOTE", title: "General note", description: "Separate recent list", createdAt: instant("05:30:00.000") },
      { authorId: user.id, kind: "TASK", title: "Future", description: "Not yet", createdAt: instant("06:00:00.001") },
      { authorId: user.id, kind: "TASK", title: "Next shift", description: "Boundary", createdAt: instant("13:00:00.000") }
    ] });
    await db.operationUpdate.create({ data: { authorId: user.id, entryId: old.id, body: "Progress on old work", requestId: randomUUID(), createdAt: instant("05:20:00.000") } });
    await db.operationEntry.update({ where: { id: old.id }, data: { closedAt: instant("05:40:00.000"), closedById: user.id, closeNote: "Finished" } });
    // A retained closed entry may have no closer; it still contributes to history.
    await db.operationEntry.create({ data: { authorId: user.id, kind: "VALVE", title: "Retained closed record", description: "Old", createdAt: instant("04:00:00.000"), closedAt: instant("05:45:00.000") } });
    await db.equipmentChange.createMany({ data: [
      { equipmentCode: "GT1", fromStatus: "ACTIVE", toStatus: "MAINTENANCE", note: "Check vibration", userId: user.id, createdAt: instant("05:10:00.000") },
      { equipmentCode: "GT1", fromStatus: "MAINTENANCE", toStatus: "MAINTENANCE", note: "Note only", userId: user.id, createdAt: instant("06:00:00.000") }
    ] });
    const first = await read(instant("06:00:00.000"));
    assert.deepEqual(first.counts, { NEW_ENTRY: 1, CLOSED_ENTRY: 2, PROGRESS: 1, EQUIPMENT: 2, WORK_DETAILS: 0 }); assert.equal(first.total, 6);
    assert.equal(first.items[0]!.type, "EQUIPMENT"); assert.equal(first.items[0]!.body, "Note only");
    assert.ok(first.items.some(row => row.type === "NEW_ENTRY" && row.entryId === boundary.id));
    assert.ok(first.items.some(row => row.type === "PROGRESS" && row.entryId === old.id && row.body === "Progress on old work"));
    assert.ok(first.items.some(row => row.type === "CLOSED_ENTRY" && row.entryId === old.id && row.body === "Finished"));
    assert.ok(first.items.some(row => row.type === "CLOSED_ENTRY" && row.actorName === null));
    assert.ok(!JSON.stringify(first).includes("private-hash")); assert.ok(!JSON.stringify(first).includes(user.email));
    assert.equal(first.items.find(row => row.type === "PROGRESS")!.actorName, user.name);
    await db.operationUpdate.createMany({ data: Array.from({ length: 20 }, () => ({ entryId: boundary.id, authorId: user.id, body: "Same-time update", requestId: randomUUID(), createdAt: instant("05:59:00.000") })) });
    const many = await read(instant("06:00:00.000"));
    assert.equal(many.counts.PROGRESS, 21); assert.equal(many.total, 26); assert.equal(many.items.length, 8);
    assert.equal(many.items[0]!.type, "EQUIPMENT");
    const noteIds = many.items.filter(row => row.type === "PROGRESS").map(row => row.id);
    assert.deepEqual(noteIds, [...noteIds].sort((a, b) => b - a));
    assert.deepEqual((await read(instant("06:00:00.000"))).items, many.items);
    const next = await read(instant("13:00:00.000"));
    assert.deepEqual(next.counts, { NEW_ENTRY: 1, CLOSED_ENTRY: 0, PROGRESS: 0, EQUIPMENT: 0, WORK_DETAILS: 0 });
    assert.equal(next.items[0]!.title, "Next shift");
    const empty = await read(new Date("2026-10-23T05:00:00Z")); assert.equal(empty.total, 0); assert.deepEqual(empty.items, []);
    const app = createApp(db, secret);
    await request(app).get("/operations/summary").expect(401);
    const response = await request(app).get("/operations/summary").set("Authorization", `Bearer ${jwt.sign({ id: user.id }, secret, { expiresIn: "1h" })}`).expect(200);
    assert.equal(response.body.activeShiftId, null); assert.ok(response.body.changes); assert.ok(response.body.changes.items.length <= 8);
    assert.equal((await db.operationEntry.findUniqueOrThrow({ where: { id: old.id } })).description, "Original description");
  } finally {
    await db.equipmentChange.deleteMany({ where: { userId: user.id } });
    await db.operationEntry.deleteMany({ where: { authorId: user.id } });
    await db.user.delete({ where: { id: user.id } }); await db.$disconnect();
  }
});
