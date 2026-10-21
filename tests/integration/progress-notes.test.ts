import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { createPrismaClient } from "../../src/database.js";
import { createApp } from "../../src/app.js";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL must point to a disposable database.");
const secret = "progress-integration-secret-".repeat(3);
async function fixture() {
  const db = createPrismaClient(url), users: number[] = [];
  for (let i=0;i<2;i++) users.push((await db.user.create({ data: { name: `Progress Operator ${i}`, email: `progress-${randomUUID()}@example.com`, password: "private-test-hash" } })).id);
  const app = createApp(db, secret), auth = users.map(id => `Bearer ${jwt.sign({ id }, secret, { expiresIn: "1h" })}`);
  const entry = await db.operationEntry.create({ data: { authorId: users[0]!, kind: "TASK", title: "GT1 inspection", description: "Original work description", equipmentCode: "GT1" } });
  const get = (path: string, who=0) => request(app).get(path).set("Authorization", auth[who]!);
  const post = (path: string, body: object, who=0) => request(app).post(path).set("Authorization", auth[who]!).send(body);
  const cleanup = async () => {
    await db.handoverRead.deleteMany({ where: { userId: { in: users } } });
    await db.operationEntry.deleteMany({ where: { authorId: { in: users } } });
    await db.shift.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } }); await db.$disconnect();
  };
  return { db, app, users, entry, get, post, cleanup };
}

test("progress notes authenticate authors, survive handover/closure and invalidate old acknowledgements", async () => {
  const f = await fixture(), path = `/operations/entries/${f.entry.id}/updates`;
  try {
    await request(f.app).get(path).expect(401);
    await request(f.app).post(path).send({ body: "Unauthorized", requestId: randomUUID() }).expect(401);
    const originalRevision = (await f.get("/operations/summary")).body.revision;
    for (const input of [{ body: " " }, { body: "x".repeat(2001) }, { body: "bad\0text" }, { body: "ok", authorId: f.users[1] }, { body: "ok", createdAt: new Date() }, { body: "ok", requestId: "invalid" }]) {
      await f.post(path, { requestId: randomUUID(), ...input }).expect(400);
    }
    for (const query of ["page=0", "page[]=1", "unknown=1"]) await f.get(`${path}?${query}`).expect(400);
    await f.post("/operations/entries/999999999/updates", { body: "Missing", requestId: randomUUID() }).expect(404);
    assert.equal((await f.get("/operations/summary")).body.revision, originalRevision);
    await f.post("/shifts/start", {}).expect(201);
    const before = (await f.get("/operations/summary")).body;
    await f.post("/operations/summary/read", { revision: before.revision }).expect(200);
    const input = { body: "  Maintenance team informed.  ", requestId: randomUUID() };
    const saved = (await f.post(path, input, 1).expect(201)).body;
    assert.equal(saved.author.id, f.users[1]); assert.equal(saved.body, input.body.trim()); assert.ok(saved.createdAt);
    assert.equal(saved.author.email, undefined); assert.equal(saved.author.password, undefined); assert.equal(saved.requestId, undefined);
    await f.post("/operations/summary/read", { revision: before.revision }).expect(409);
    const updated = (await f.get("/operations/summary")).body;
    assert.equal(updated.revision, before.revision+1);
    const preview = updated.openItems.find((item: any) => item.id === f.entry.id);
    assert.equal(preview._count.updates, 1); assert.equal(preview.updates[0].body, saved.body);
    await f.post("/operations/summary/read", { revision: updated.revision }).expect(200);
    await f.post("/shifts/end", {}).expect(200); await f.post("/shifts/start", {}, 1).expect(201);
    assert.equal((await f.get(path,1)).body.items[0].id, saved.id);
    const original = await f.db.operationEntry.findUniqueOrThrow({ where: { id: f.entry.id } });
    assert.equal(original.description, f.entry.description); assert.equal(original.createdAt.getTime(), f.entry.createdAt.getTime());
    await f.post(`/operations/entries/${f.entry.id}/close`, { closeNote: "Completed" }, 1).expect(200);
    const closed = (await f.get(path)).body;
    assert.equal(closed.canWrite, false); assert.equal(closed.items[0].id, saved.id);
    await f.post(path, { body: "Too late", requestId: randomUUID() }).expect(409);
    const revision = (await f.get("/operations/summary")).body.revision;
    await f.post(path, input, 1).expect(200); // Lost-response retries remain safe after closure.
    assert.equal((await f.get("/operations/summary")).body.revision, revision);
    const historical = (await f.get("/operations/entries?view=history")).body.items.find((item: any)=>item.id===f.entry.id);
    assert.equal(historical._count.updates, 1); assert.equal(historical.closeNote, "Completed");
    await request(f.app).patch(`${path}/${saved.id}`).set("Authorization", `Bearer ${jwt.sign({id:f.users[1]}, secret, {expiresIn:"1h"})}`).send({body:"Overwrite"}).expect(404);
  } finally { await f.cleanup(); }
});

test("retries, concurrent authors and closure races cannot duplicate, overwrite or append to closed work", async () => {
  const f = await fixture(), path = `/operations/entries/${f.entry.id}/updates`;
  try {
    const before = (await f.get("/operations/summary")).body.revision, input = { body: "Inspection requested", requestId: randomUUID() };
    const same = await Promise.all([f.post(path,input),f.post(path,input)]);
    assert.deepEqual(same.map(r=>r.status).sort(), [200,201]); assert.equal(same[0]!.body.id,same[1]!.body.id);
    assert.equal((await f.get("/operations/summary")).body.revision, before+1);
    await f.post(path, {...input, body:"Different"}).expect(409);
    const distinct = await Promise.all([f.post(path,{body:"Measure vibration",requestId:randomUUID()}), f.post(path,{body:"Team dispatched",requestId:randomUUID()},1)]);
    assert.deepEqual(distinct.map(r=>r.status),[201,201]); assert.equal((await f.get(path)).body.total,3);
    const event = await f.db.operationEntry.create({ data: { authorId:f.users[0]!,kind:"NOTE",title:"General observation",description:"Not open work" } });
    await f.post(`/operations/entries/${event.id}/updates`,{body:"Not allowed",requestId:randomUUID()}).expect(409);
    const race = await Promise.all([f.post(path,{body:"Final check",requestId:randomUUID()}), f.post(`/operations/entries/${f.entry.id}/close`,{closeNote:"Finished"},1)]);
    assert.ok([201,409].includes(race[0]!.status)); assert.equal(race[1]!.status,200);
    assert.equal((await f.get(path)).body.total,race[0]!.status===201?4:3);
    await f.post(path,{body:"After closure",requestId:randomUUID()}).expect(409);
    // Seed enough immutable history to exercise server pagination and bounded list previews.
    await f.db.operationUpdate.createMany({data:Array.from({length:25},(_,i)=>({entryId:f.entry.id,authorId:f.users[0]!,body:`Earlier progress ${i}`,requestId:randomUUID(),createdAt:new Date("2020-01-01")}))});
    const first = (await f.get(path)).body, second = (await f.get(`${path}?page=2`)).body;
    assert.equal(first.items.length,20); assert.equal(first.total,second.total); assert.equal(second.items.length,first.total-20);
    assert.equal(new Set([...first.items,...second.items].map((item:any)=>item.id)).size,first.total);
    const history = (await f.get("/operations/entries?view=history")).body.items.find((item:any)=>item.id===f.entry.id);
    assert.equal(history.updates.length,1); assert.equal(history._count.updates,first.total);
    assert.equal(history.updates[0].author.email,undefined);
  } finally { await f.cleanup(); }
});
