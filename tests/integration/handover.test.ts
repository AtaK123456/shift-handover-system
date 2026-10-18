import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import jwt from "jsonwebtoken";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../src/database.js";
import { createApp } from "../../src/app.js";
const secret = "handover-test-secret-".repeat(3);
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL must identify a disposable test database.");

test("shared handover persists across shifts; photos, close history and equipment conflict protection", async () => {
  const db = createPrismaClient(url);
  const app = createApp(db, secret);
  const users: number[] = [];
  try {
    for (let i=0; i<2; i++) users.push((await db.user.create({ data: { email: `${randomUUID()}@example.com`, name: `Operator ${i}`, password: "unused" } })).id);
    const auth = users.map(id => `Bearer ${jwt.sign({ id }, secret, { expiresIn: "1h" })}`);
    await request(app).get("/operations/entries").expect(401);
    await request(app).get("/operations/equipment").expect(401);
    const start = await request(app).post("/shifts/start").set("Authorization", auth[0]!).send({ shiftDate: "2026-10-19", scheduledStart: "16:00", scheduledEnd: "00:00" }).expect(201);
    assert.equal(start.body.scheduledEnd, "00:00");
    const image = await sharp({ create: { width: 20, height: 20, channels: 3, background: "red" } }).png().toBuffer();
    const entry = await request(app).post("/operations/entries").set("Authorization", auth[0]!)
      .field("kind", "VALVE").field("priority", "HIGH").field("title", "V-101 açık").field("description", "Kontrol sonrası kapatılacak.")
      .attach("photos", image, { filename: "valve.png", contentType: "image/png" }).expect(201);
    assert.equal(entry.body.shiftId, start.body.id); assert.equal(entry.body.author.id, users[0]);
    assert.equal(entry.body.photos.length, 1); assert.equal(entry.body.photos[0].data, undefined);
    const photoId = entry.body.photos[0].id;
    await request(app).get(`/operations/photos/${photoId}`).expect(401);
    const photo = await request(app).get(`/operations/photos/${photoId}`).set("Authorization", auth[1]!).expect(200).expect("Content-Type", /image\/jpeg/);
    assert.equal((await sharp(photo.body).metadata()).format, "jpeg");
    await request(app).post("/shifts/end").set("Authorization", auth[0]!).expect(200);
    const next = await request(app).get("/operations/entries?view=open").set("Authorization", auth[1]!).expect(200);
    assert.ok(next.body.items.some((item: any) => item.id === entry.body.id));
    const close = await request(app).post(`/operations/entries/${entry.body.id}/close`).set("Authorization", auth[1]!).send({ closeNote: "İş tamamlandı, vana kapandı." }).expect(200);
    assert.equal(close.body.closedBy.id, users[1]); assert.ok(close.body.closedAt);
    await request(app).post(`/operations/entries/${entry.body.id}/close`).set("Authorization", auth[0]!).send({ closeNote: "overwrite" }).expect(409);
    const open = await request(app).get("/operations/entries?view=open").set("Authorization", auth[0]!).expect(200);
    assert.equal(open.body.items.some((item: any) => item.id === entry.body.id), false);
    const past = await request(app).get("/operations/entries?view=history").set("Authorization", auth[0]!).expect(200);
    assert.equal(past.body.items.find((item: any) => item.id === entry.body.id).closeNote, "İş tamamlandı, vana kapandı.");
    const units = await request(app).get("/operations/equipment").set("Authorization", auth[0]!).expect(200);
    assert.deepEqual(units.body.items.map((item: any) => item.code), ["GT1", "GT2", "ST"]);
    const gt1 = units.body.items.find((item: any) => item.code === "GT1");
    await request(app).put("/operations/equipment/GT1").set("Authorization", auth[0]!).send({ status: "ACTIVE", note: "Kontrol edildi", version: gt1.version }).expect(200);
    await request(app).put("/operations/equipment/GT1").set("Authorization", auth[1]!).send({ status: "INACTIVE", note: "stale", version: gt1.version }).expect(409);
    assert.equal(await db.equipmentChange.count({ where: { userId: users[0] } }), 1);
    // A false MIME type cannot smuggle SVG or arbitrary bytes into the photo store.
    await request(app).post("/operations/entries").set("Authorization", auth[0]!)
      .field("kind", "EVENT").field("title", "Bad photo").field("description", "bad")
      .attach("photos", Buffer.from("<svg onload='alert(1)'/>"), { filename: "fake.jpg", contentType: "image/jpeg" }).expect(400);
    await request(app).post("/shifts/start").set("Authorization", auth[0]!).send({ shiftDate: "2026-02-30", scheduledStart: "08:00", scheduledEnd: "16:00" }).expect(400);
    const note = await request(app).post("/operations/entries").set("Authorization", auth[1]!).send({ kind: "NOTE", title: "Genel not", description: "Sadece geçmişte" }).expect(201);
    const after = await request(app).get("/operations/entries?view=open").set("Authorization", auth[1]!).expect(200);
    assert.equal(after.body.items.some((item: any) => item.id === note.body.id), false);
  } finally {
    await db.operationEntry.deleteMany({ where: { authorId: { in: users } } });
    await db.equipmentChange.deleteMany({ where: { userId: { in: users } } });
    await db.shift.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }
});
