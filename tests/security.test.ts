import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { scryptSync } from 'node:crypto';
import { createApp } from '../src/app.js';
import { getJwtSecret } from '../src/config.js';
import { hashPassword, verifyPassword } from '../src/password.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
const secret = 'test-secret-'.repeat(4);
const base = { id: 1, email: 'worker@example.com', name: 'Worker', role: 'WORKER', password: 'invalid' };
function setup(user: typeof base | null = { ...base }, failure = false) {
  let listed = false;
  let created: any;
  let owner: number | undefined;
  const db = { user: {
    findUnique: async () => { if (failure) throw new Error('DATABASE_URL=private'); return user; },
    findMany: async () => { listed = true; return []; },
    create: async ({ data }: any) => { created = data; return { ...base, ...data }; }
  }, shift: { findFirst: async ({ where }: any) => { owner = where.userId; return null; } } };
  return { app: createApp(db as unknown as PrismaClient, secret), listed: () => listed, created: () => created, owner: () => owner };
}
const bearer = (claims: object = { id: 1 }, options: jwt.SignOptions = {}) =>
  `Bearer ${jwt.sign(claims, secret, { expiresIn: '1h', ...options })}`;
test('anonymous users cannot list users or access shifts', async () => {
  const { app, listed } = setup();
  await request(app).get('/users').expect(401);
  await request(app).get('/shifts/current').expect(401);
  await request(app).post('/shifts/start').expect(401);
  await request(app).post('/shifts/end').expect(401);
  assert.equal(listed(), false);
});
test('database WORKER role overrides stale MANAGER token claim', async () => {
  const { app, listed } = setup();
  await request(app).get('/users').set('Authorization', bearer({ id: 1, role: 'MANAGER' })).expect(403);
  assert.equal(listed(), false);
});
test('current manager can list users', async () => {
  const { app, listed } = setup({ ...base, role: 'MANAGER' });
  await request(app).get('/users').set('Authorization', bearer()).expect(200);
  assert.equal(listed(), true);
});
test('malformed, expired, wrong-algorithm, unsigned and invalid-claim tokens fail', async () => {
  const { app } = setup();
  const values = ['Basic abc', 'Bearer abc extra', 'Bearer garbage', bearer({}), bearer({ id: '1' }),
    bearer({ id: -1 }), bearer({ id: 1 }, { expiresIn: -1 }), bearer({ id: 1 }, { algorithm: 'HS384' }),
    `Bearer ${jwt.sign({ id: 1 }, secret)}`, `Bearer ${jwt.sign({ id: 1 }, '', { algorithm: 'none' })}`];
  for (const value of values) await request(app).get('/users').set('Authorization', value).expect(401);
});
test('deleted user token is rejected', async () => {
  await request(setup(null).app).get('/users').set('Authorization', bearer()).expect(401);
});
test('shift ownership uses authenticated identity', async () => {
  const { app, owner } = setup();
  await request(app).get('/shifts/current?userId=999').set('Authorization', bearer()).expect(200, { currentShift: null });
  assert.equal(owner(), 1);
});
test('invalid credentials fail before database processing', async () => {
  const { app } = setup(null, true);
  for (const body of [{}, { email: {}, password: [] }, { email: 'a@b.com', password: 123 }, { email: 'a@b.com', password: 'a'.repeat(257) }]) {
    await request(app).post('/login').send(body).expect(400);
  }
  await request(app).post('/register').send({ email: 'a@b.com', password: 'short', name: 'A' }).expect(400);
});
test('registration hashes passwords, forces WORKER and omits secrets', async () => {
  const { app, created } = setup();
  const res = await request(app).post('/register').send({ email: 'a@b.com', name: ' A ', password: 'long-password-123', role: 'MANAGER' }).expect(201);
  assert.equal(created().role, 'WORKER');
  assert.equal(created().name, 'A');
  assert.equal(await verifyPassword('long-password-123', created().password), true);
  assert.equal('password' in res.body, false);
});
test('legacy hashes authenticate; wrong passwords and corrupt hashes fail', async () => {
  const salt = '1234567890abcdef1234567890abcdef';
  const password = `${salt}:${scryptSync('old-pass', salt, 64).toString('hex')}`;
  const { app } = setup({ ...base, password });
  const res = await request(app).post('/login').send({ email: base.email, password: 'old-pass' }).expect(200);
  assert.equal((jwt.verify(res.body.token, secret) as jwt.JwtPayload).id, 1);
  assert.equal('password' in res.body.user, false);
  await request(app).post('/login').send({ email: base.email, password: 'wrong' }).expect(401);
  for (const user of [base, null]) await request(setup(user).app).post('/login').send({ email: base.email, password: 'wrong' }).expect(401);
  assert.equal(await verifyPassword('test', '00:bad'), false);
  assert.equal(await verifyPassword('test', await hashPassword('test')), true);
});
test('login and registration enforce rate limits', async () => {
  const { app } = setup();
  for (let i = 0; i < 20; i++) await request(app).post('/login').send({}).expect(400);
  await request(app).post('/login').send({}).expect(429);
  for (let i = 0; i < 10; i++) await request(app).post('/register').send({}).expect(400);
  await request(app).post('/register').send({}).expect(429);
});
test('body limits, JSON errors and database errors return safe responses', async () => {
  const { app } = setup(null, true);
  await request(app).post('/login').set('Content-Type', 'application/json').send('{').expect(400);
  await request(app).post('/login').send({ data: 'a'.repeat(17000) }).expect(413);
  const res = await request(app).get('/users').set('Authorization', bearer()).expect(500);
  assert.equal(JSON.stringify(res.body).includes('DATABASE_URL'), false);
  assert.equal(res.headers['x-powered-by'], undefined);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});
test('startup rejects missing and short JWT secrets', () => {
  const original = process.env.JWT_SECRET;
  try {
    delete process.env.JWT_SECRET;
    assert.throws(getJwtSecret);
    process.env.JWT_SECRET = 'short';
    assert.throws(getJwtSecret);
    process.env.JWT_SECRET = secret;
    assert.equal(getJwtSecret(), secret);
  } finally {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  }
});

test('LAN development keeps HTTP assets usable while production retains HTTPS upgrades', async () => {
  for (const mode of ['development', 'production']) {
    const previous = process.env.NODE_ENV;
    let app: ReturnType<typeof createApp>;
    try { process.env.NODE_ENV = mode; app = setup().app; }
    finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
    const response = await request(app!).get('/app/').expect(200);
    assert.equal(response.headers['content-security-policy'].includes('upgrade-insecure-requests'), mode === 'production');
    assert.match(response.headers['content-security-policy'], /script-src 'self'/);
  }
});
