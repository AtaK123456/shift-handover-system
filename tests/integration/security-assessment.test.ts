import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import jwt from "jsonwebtoken";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { createApp } from "../../src/app.js";
import { createPrismaClient } from "../../src/database.js";
import { hashPassword } from "../../src/password.js";
import type { User } from "../../src/generated/prisma/client.js";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL must identify a disposable test database.");
const secret = "assessment-jwt-test-only-".repeat(3), code = "assessment-registration-test-only";
type Context = { db: ReturnType<typeof createPrismaClient>; app: ReturnType<typeof createApp>; users: User[]; auth: string[]; ids: number[] };
async function fixture(run: (context: Context) => Promise<void>) {
  const db = createPrismaClient(url), ids: number[] = [];
  try {
    const password = await hashPassword("assessment-test-password");
    const users: User[] = [];
    for (const role of ["WORKER", "WORKER", "MANAGER"] as const) {
      const user = await db.user.create({ data: { email: `${randomUUID()}@example.invalid`, name: "Assessment Operator", password, role } });
      ids.push(user.id); users.push(user);
    }
    const app = createApp(db, secret, { registrationCode: code, analyzer: null });
    const auth = ids.map(id => `Bearer ${jwt.sign({ id }, secret, { expiresIn: "8h" })}`);
    await run({ db, app, users, auth, ids });
  } finally {
    await db.operationEntry.deleteMany({ where: { authorId: { in: ids } } });
    await db.equipmentChange.deleteMany({ where: { userId: { in: ids } } });
    await db.shift.deleteMany({ where: { userId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
}

test("assessment: anonymous requests cannot reach any operations, shift, AI or photo handler", async () => fixture(async ({ db, app }) => {
  const revision = await db.operationRevision.findUniqueOrThrow({ where: { id: 1 } });
  const routes = [
    ["get", "/users"], ["get", "/shifts"], ["get", "/shifts/current"], ["get", "/shifts/export"],
    ["post", "/shifts/start"], ["post", "/shifts/end"], ["get", "/operations/equipment"], ["put", "/operations/equipment/GT1"],
    ["get", "/operations/entries"], ["post", "/operations/entries"], ["get", "/operations/entries/1/work"],
    ["patch", "/operations/entries/1/work"], ["get", "/operations/entries/1/updates"], ["post", "/operations/entries/1/updates"],
    ["post", "/operations/entries/1/close"], ["get", "/operations/summary"], ["post", "/operations/summary/read"],
    ["get", "/operations/photos/00000000-0000-0000-0000-000000000000"], ["get", "/ai/status"], ["post", "/ai/analyze"]
  ] as const;
  for (const [method, path] of routes) {
    const response = await request(app)[method](path).send({ userId: 1, role: "MANAGER" }).expect(401);
    assert.deepEqual(Object.keys(response.body), ["error"]);
  }
  assert.equal((await db.operationRevision.findUniqueOrThrow({ where: { id: 1 } })).version, revision.version);
}));

test("assessment: forged claims cannot escalate roles or start/end another worker's shift", async () => fixture(async ({ db, app, users, auth }) => {
  const forged = `Bearer ${jwt.sign({ id: users[0].id, role: "MANAGER", userId: users[2].id }, secret, { expiresIn: "1h" })}`;
  await request(app).get("/users").set("Authorization", forged).expect(403);
  await request(app).get("/shifts?scope=all").set("Authorization", forged).expect(403);
  await request(app).get("/shifts/export?scope=all").set("Authorization", forged).expect(403);
  const other = await request(app).post("/shifts/start").set("Authorization", auth[1]).send({}).expect(201);
  const own = await request(app).post("/shifts/start").set("Authorization", auth[0]).send({ userId: users[1].id, role: "MANAGER" }).expect(201);
  assert.equal(own.body.userId, users[0].id);
  await request(app).post("/shifts/end").set("Authorization", auth[0]).send({ userId: users[1].id, shiftId: other.body.id }).expect(200);
  assert.equal((await db.shift.findUniqueOrThrow({ where: { id: other.body.id } })).status, "ACTIVE");
  const listing = await request(app).get("/shifts").set("Authorization", auth[0]).expect(200);
  assert.ok(listing.body.items.length > 0 && listing.body.items.every((item: any) => item.user.id === users[0].id));
  const manager = await request(app).get("/users").set("Authorization", auth[2]).expect(200);
  assert.ok(manager.body.length > 0); assert.ok(manager.body.every((item: any) => !("password" in item)));
}));

test("assessment: registration rejects invalid codes and cannot inject a manager role", async () => fixture(async ({ db, app, ids }) => {
  const email = `${randomUUID()}@example.invalid`, body = { email, name: "Assessment", password: "assessment-test-password", role: "MANAGER" };
  for (const registrationCode of [undefined, "incorrect-test-code", [code], { value: code }, "x".repeat(129)]) {
    const response = await request(app).post("/register").send({ ...body, registrationCode }).expect(403);
    assert.equal(response.text.includes(code), false); assert.equal(await db.user.count({ where: { email } }), 0);
  }
  const response = await request(app).post("/register").send({ ...body, registrationCode: code }).expect(201);
  ids.push(response.body.id);
  assert.equal(response.text.includes(code), false); assert.equal("password" in response.body, false);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: response.body.id } })).role, "WORKER");
  await request(app).post("/register").send({ ...body, registrationCode: code }).expect(409);
  await request(createApp(db, secret)).post("/register").send({ ...body, registrationCode: code }).expect(403);
}));

test("assessment: injection strings remain literal and operation ownership cannot be mass-assigned", async () => fixture(async ({ db, app, users, auth }) => {
  const attack = "' OR 1=1 --", payload = { kind: "TASK", title: `${randomUUID()} ${attack}`, description: "<img src=x onerror=alert(1)>",
    authorId: users[2].id, closedAt: "2026-01-01", closedById: users[2].id, createdAt: "2020-01-01", photos: [{ data: "forged" }], role: "MANAGER" };
  const entry = await request(app).post("/operations/entries").set("Authorization", auth[0]).send(payload).expect(201);
  assert.equal(entry.body.author.id, users[0].id); assert.equal(entry.body.closedAt, null); assert.equal(entry.body.closedBy, null);
  assert.equal(entry.body.photos.length, 0); assert.notEqual(entry.body.createdAt.slice(0, 4), "2020");
  const found = await request(app).get("/operations/entries").query({ view: "all", q: attack }).set("Authorization", auth[0]).expect(200);
  assert.ok(found.body.items.length > 0 && found.body.items.every((item: any) => item.title.includes(attack)));
  assert.equal(await db.user.count({ where: { id: users[2].id } }), 1);
  for (const path of ["/operations/entries?page=1&page=2", "/operations/entries?q[$ne]=x", "/shifts?scope=own&scope=all", "/operations/entries?kind=TASK%27%20OR%201=1--"])
    await request(app).get(path).set("Authorization", auth[0]).expect(400);
  await request(app).post("/login").send({ email: { $ne: null }, password: "assessment-test-password" }).expect(400);
  const proto = JSON.parse('{"kind":"NOTE","title":"Prototype probe","description":"Literal data","__proto__":{"isAdmin":true}}');
  await request(app).post("/operations/entries").set("Authorization", auth[0]).send(proto).expect(201);
  assert.equal(({} as any).isAdmin, undefined);
}));

test("assessment: deceptive uploads and oversized files fail; private photos are re-encoded without metadata", async () => fixture(async ({ app, auth }) => {
  const send = (buffer: Buffer, name: string, type: string) => request(app).post("/operations/entries").set("Authorization", auth[0])
    .field("kind", "TASK").field("title", "Photo security assessment").field("description", "Synthetic photo only")
    .attach("photos", buffer, { filename: name, contentType: type });
  await send(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), "fake.jpg", "image/jpeg").expect(400);
  await send(Buffer.from("<script>alert(1)</script>"), "fake.png", "image/png").expect(400);
  await send(Buffer.from("invalid"), "bad.webp", "image/webp").expect(400);
  await send(Buffer.from("invalid"), "file.html", "text/html").expect(400);
  await send(Buffer.alloc(5 * 1024 * 1024 + 1), "large.jpg", "image/jpeg").expect(400);
  const marker = "assessment-private-metadata";
  const photo = await sharp({ create: { width: 16, height: 24, channels: 3, background: "#5079a9" } }).withMetadata({ orientation: 6 })
    .withExif({ IFD0: { Artist: marker } }).jpeg().toBuffer();
  let extra = request(app).post("/operations/entries").set("Authorization", auth[0]).field("kind", "TASK").field("title", "Too many photos").field("description", "test");
  for (let i = 0; i < 4; i++) extra = extra.attach("photos", photo, { filename: `${i}.jpg`, contentType: "image/jpeg" });
  await extra.expect(400);
  const entry = await send(photo, "../../photo.jpg", "image/jpeg").expect(201);
  const id = entry.body.photos[0].id;
  await request(app).get(`/operations/photos/${id}`).expect(401);
  const served = await request(app).get(`/operations/photos/${id}`).set("Authorization", auth[1]).expect(200).expect("Content-Type", /image\/jpeg/);
  assert.equal(served.headers["cache-control"], "no-store"); assert.equal(served.headers["x-content-type-options"], "nosniff");
  const meta = await sharp(served.body).metadata();
  assert.equal(meta.exif, undefined); assert.equal(meta.orientation, undefined); assert.equal(meta.width, 24); assert.equal(meta.height, 16);
  assert.equal(served.body.includes(Buffer.from(marker)), false); assert.equal("data" in entry.body.photos[0], false);
}));

test("assessment: NUL text is rejected before database work instead of causing server errors", async () => fixture(async ({ db, app, auth }) => {
  const entry = await request(app).post("/operations/entries").set("Authorization", auth[0]).send({ kind: "TASK", title: "NUL assessment", description: "Synthetic baseline" }).expect(201);
  const gt1 = await db.equipment.findUniqueOrThrow({ where: { code: "GT1" } });
  const revision = (await db.operationRevision.findUniqueOrThrow({ where: { id: 1 } })).version;
  const registration = { email: `${randomUUID()}@example.invalid`, name: "Assessment", password: "assessment-test-password", registrationCode: code };
  const responses = [
    await request(app).post("/register").send({ ...registration, email: "nul\0@example.invalid" }),
    await request(app).post("/register").send({ ...registration, name: "Name\0" }),
    await request(app).post("/login").send({ email: "nul\0@example.invalid", password: "assessment-test-password" }),
    await request(app).post("/operations/entries").set("Authorization", auth[0]).send({ kind: "TASK", title: "nul\0", description: "test" }),
    await request(app).post("/operations/entries").set("Authorization", auth[0]).send({ kind: "TASK", title: "test", description: "nul\0" }),
    await request(app).put("/operations/equipment/GT1").set("Authorization", auth[0]).send({ status: "ACTIVE", version: gt1.version, note: "nul\0" }),
    await request(app).post(`/operations/entries/${entry.body.id}/close`).set("Authorization", auth[0]).send({ closeNote: "nul\0" }),
    await request(app).get("/operations/entries").query({ q: "nul\0" }).set("Authorization", auth[0])
  ];
  assert.deepEqual(responses.map(response => response.status), Array(8).fill(400));
  assert.equal(await db.user.count({ where: { email: registration.email } }), 0);
  assert.equal((await db.operationRevision.findUniqueOrThrow({ where: { id: 1 } })).version, revision);
  assert.equal((await db.operationEntry.findUniqueOrThrow({ where: { id: entry.body.id } })).closedAt, null);
  assert.equal((await db.equipment.findUniqueOrThrow({ where: { code: "GT1" } })).note, gt1.note);
}));

test("assessment: spoofed client IP headers cannot reset registration and login limits", async () => fixture(async ({ app }) => {
  for (let i = 0; i < 20; i++) await request(app).post("/login").set("X-Real-IP", `198.51.100.${i + 1}`)
    .send({ email: "missing@example.invalid", password: "assessment-test-password" }).expect(401);
  await request(app).post("/login").set("X-Real-IP", "203.0.113.1").set("X-Forwarded-For", "203.0.113.2")
    .send({ email: "missing@example.invalid", password: "assessment-test-password" }).expect(429);
  for (let i = 0; i < 10; i++) await request(app).post("/register").set("X-Real-IP", `198.51.100.${i + 1}`).send({ registrationCode: "wrong" }).expect(403);
  await request(app).post("/register").set("X-Real-IP", "203.0.113.1").set("X-Forwarded-For", "203.0.113.2").send({ registrationCode: code }).expect(429);
}));

test("assessment: cross-origin probes and static traversal do not disclose data or local files", async () => fixture(async ({ app, auth }) => {
  const response = await request(app).get("/operations/summary").set("Origin", "https://untrusted.example.invalid").set("Authorization", auth[0]).expect(200);
  assert.equal(response.headers["access-control-allow-origin"], undefined); assert.equal(response.headers["cache-control"], "no-store");
  await request(app).post("/operations/entries").set("Origin", "https://untrusted.example.invalid").type("form").send({ kind: "TASK", title: "CSRF", description: "test" }).expect(401);
  for (const path of ["/app/.env", "/app/%2e%2e/.env", "/app/..%2f.env", "/app/package.json", "/app/src/config.ts", "/app/.git/config"])
    await request(app).get(path).expect(404);
  const html = await request(app).get("/app/").expect(200);
  assert.ok(html.headers["content-security-policy"].includes("script-src 'self'"));
  assert.ok(html.headers["content-security-policy"].includes("frame-ancestors 'self'"));
  assert.equal(html.headers["x-content-type-options"], "nosniff"); assert.equal(html.headers["x-powered-by"], undefined);
  assert.equal(html.text.includes(code), false); assert.equal(html.text.includes(secret), false);
}));
