import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import request from "supertest";
import jwt from "jsonwebtoken";
import pg from "pg";
import { createPrismaClient } from "../../src/database.js";
import { createApp } from "../../src/app.js";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL must point to a disposable database with migrations applied.");
const secret = "integration-test-secret-".repeat(3);

test("PostgreSQL enforces one active shift across independent API instances", async () => {
  const db1 = createPrismaClient(url);
  const db2 = createPrismaClient(url);
  const users: number[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const user = await db1.user.create({ data: { email: `${randomUUID()}@example.com`, name: "Test", password: "unused" } });
      users.push(user.id);
    }
    const apps = [createApp(db1, secret), createApp(db2, secret)];
    const token = `Bearer ${jwt.sign({ id: users[0] }, secret, { expiresIn: "1h" })}`;
    const starts = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      request(apps[i % 2]!).post("/shifts/start").set("Authorization", token)));
    assert.deepEqual(starts.map(r => r.status).sort(), [201, ...Array(11).fill(409)]);
    assert.equal(await db1.shift.count({ where: { userId: users[0], status: "ACTIVE" } }), 1);
    // A direct database writer is subject to the same invariant.
    await assert.rejects(db2.shift.create({ data: { userId: users[0]!, status: "ACTIVE" } }),
      (error: any) => error.code === "P2002");
    await db2.shift.create({ data: { userId: users[1]!, status: "ACTIVE" } });
    const ends = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      request(apps[i % 2]!).post("/shifts/end").set("Authorization", token)));
    assert.deepEqual(ends.map(r => r.status).sort(), [200, ...Array(7).fill(404)]);
    const ended = await db1.shift.findFirstOrThrow({ where: { userId: users[0], status: "COMPLETED" } });
    await request(apps[0]!).post("/shifts/end").set("Authorization", token).expect(404);
    assert.deepEqual((await db1.shift.findUniqueOrThrow({ where: { id: ended.id } })).endTime, ended.endTime);
    // Completed history must not prevent starting the next shift.
    await request(apps[1]!).post("/shifts/start").set("Authorization", token).expect(201);
    await request(apps[0]!).post("/shifts/end").set("Authorization", token).expect(200);
    assert.equal(await db1.shift.count({ where: { userId: users[0], status: "COMPLETED" } }), 2);
  } finally {
    await db1.shift.deleteMany({ where: { userId: { in: users } } });
    await db1.user.deleteMany({ where: { id: { in: users } } });
    await Promise.all([db1.$disconnect(), db2.$disconnect()]);
  }
});

test("migration refuses existing duplicates without changing records", async () => {
  const client = new pg.Client({ connectionString: url });
  const schema = `migration_test_${randomUUID().replaceAll("-", "")}`;
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(await readFile(new URL("../../prisma/migrations/20261002111741_init/migration.sql", import.meta.url), "utf8"));
    const user = await client.query(`INSERT INTO "User" (email, name, password) VALUES ('duplicate@example.com', 'Test', 'unused') RETURNING id`);
    await client.query(`INSERT INTO "Shift" ("userId") VALUES ($1), ($1)`, [user.rows[0].id]);
    const migration = await readFile(new URL("../../prisma/migrations/20261019000100_one_active_shift_per_user/migration.sql", import.meta.url), "utf8");
    await assert.rejects(client.query(migration), /Multiple ACTIVE shifts/);
    await client.query("ROLLBACK");
    assert.equal((await client.query(`SELECT COUNT(*)::int AS count FROM "Shift" WHERE status = 'ACTIVE'`)).rows[0].count, 2);
  } finally {
    await client.query("ROLLBACK");
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});
