import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { scryptSync } from 'node:crypto';
import { createApp } from '../src/app.js';
import { getJwtSecret, getRegistrationCode } from '../src/config.js';
import { hashPassword, verifyPassword } from '../src/password.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
const secret = 'test-secret-'.repeat(4);
const registrationCode = 'unit-test-registration-only';
const base = { id: 1, email: 'worker@example.com', name: 'Worker', role: 'WORKER', password: 'invalid' };
function setup(user: typeof base | null = { ...base }, failure = false, code: string | null = null) {
  let listed = false;
  let created: any;
  let createCalls = 0;
  let owner: number | undefined;
  const db = { user: {
    findUnique: async () => { if (failure) throw new Error('DATABASE_URL=private'); return user; },
    findMany: async () => { listed = true; return []; },
    create: async ({ data }: any) => { createCalls++; created = data; return { ...base, ...data }; }
  }, shift: { findFirst: async ({ where }: any) => { owner = where.userId; return null; } } };
  return { app: createApp(db as unknown as PrismaClient, secret, { registrationCode: code }), db,
    listed: () => listed, created: () => created, createCalls: () => createCalls, owner: () => owner };
}
function noRegistrationCode(response: request.Response, code = registrationCode) {
  assert.equal(response.text.includes(code), false);
  assert.equal(response.text.includes('registrationCode'), false);
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
  const { app, createCalls } = setup(null, true, registrationCode);
  for (const body of [{}, { email: {}, password: [] }, { email: 'a@b.com', password: 123 }, { email: 'a@b.com', password: 'a'.repeat(257) }]) {
    await request(app).post('/login').send(body).expect(400);
  }
  const res = await request(app).post('/register').send({ email: 'a@b.com', password: 'short', name: 'A', registrationCode }).expect(400);
  assert.equal(createCalls(), 0);
  noRegistrationCode(res);
});
test('NUL credentials fail validation without database access', async () => {
  const { app, createCalls } = setup(null, true, registrationCode);
  await request(app).post('/login').send({ email: 'nul\0@example.invalid', password: 'long-password-123' }).expect(400);
  const body = { email: 'nul@example.invalid', name: 'Operator', password: 'long-password-123', registrationCode };
  await request(app).post('/register').send({ ...body, email: 'nul\0@example.invalid' }).expect(400);
  await request(app).post('/register').send({ ...body, name: 'Operator\0' }).expect(400);
  assert.equal(createCalls(), 0);
});
test('registration hashes passwords, forces WORKER and omits secrets', async () => {
  const { app, created, createCalls } = setup(undefined, false, registrationCode);
  const res = await request(app).post('/register').send({ email: 'a@b.com', name: ' A ', password: 'long-password-123', role: 'MANAGER', registrationCode }).expect(201);
  assert.equal(createCalls(), 1);
  assert.equal(created().role, 'WORKER');
  assert.equal(created().name, 'A');
  assert.equal(await verifyPassword('long-password-123', created().password), true);
  assert.equal('password' in res.body, false);
  assert.equal('registrationCode' in created(), false);
  noRegistrationCode(res);
});
test('registration is closed without an injected code, even if an environment code exists', async () => {
  const previous = process.env.REGISTRATION_CODE;
  try {
    process.env.REGISTRATION_CODE = registrationCode;
    for (const code of [undefined, null, '']) {
      const fixture = setup();
      const options = code === undefined ? undefined : { registrationCode: code };
      const app = createApp(fixture.db as unknown as PrismaClient, secret, options);
      const res = await request(app).post('/register').send({ registrationCode }).expect(403, { error: 'Kayıt kapalı.' });
      assert.equal(fixture.createCalls(), 0);
      noRegistrationCode(res);
    }
  } finally {
    if (previous === undefined) delete process.env.REGISTRATION_CODE; else process.env.REGISTRATION_CODE = previous;
  }
});
test('missing, malformed, incorrect and oversized registration codes fail before database creation', async () => {
  for (const code of [undefined, null, 42, true, [], {}, '', 'wrong-code-123', 'x'.repeat(129), registrationCode.toUpperCase(), ` ${registrationCode}`]) {
    const { app, createCalls } = setup(undefined, false, registrationCode);
    const res = await request(app).post('/register').send({ email: 'a@b.com', name: 'A', password: 'long-password-123', registrationCode: code })
      .expect(403, { error: 'Kayıt yapılamadı. Bilgileri kontrol edin veya ekip sorumlusuyla iletişime geçin.' });
    assert.equal(createCalls(), 0);
    noRegistrationCode(res);
    if (typeof code === 'string' && code) noRegistrationCode(res, code);
  }
  const fixture = setup(undefined, false, registrationCode);
  await request(fixture.app).post('/register').send({}).expect(403);
  assert.equal(fixture.createCalls(), 0);
});
test('registration accepts code boundaries and compares non-ASCII codes without length errors', async () => {
  for (const code of ['a'.repeat(12), 'b'.repeat(128), 'ekip-kodu-şifre-日本語']) {
    const { app, createCalls } = setup(undefined, false, code);
    const res = await request(app).post('/register').send({ email: 'a@b.com', name: 'A', password: 'long-password-123', registrationCode: code }).expect(201);
    assert.equal(createCalls(), 1);
    noRegistrationCode(res, code);
  }
});
test('valid registration codes preserve duplicate-email conflicts and safe database errors', async () => {
  for (const [code, status] of [['P2002', 409], ['OTHER', 500]] as const) {
    const fixture = setup(undefined, false, registrationCode);
    fixture.db.user.create = async () => { throw Object.assign(new Error(registrationCode), { code }); };
    const res = await request(fixture.app).post('/register').send({ email: 'a@b.com', name: 'A', password: 'long-password-123', registrationCode }).expect(status);
    assert.deepEqual(res.body, { error: status === 409 ? 'Bu email adresi zaten kullanımda.' : 'Sunucu hatası oluştu.' });
    noRegistrationCode(res);
  }
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
  const { app, createCalls } = setup(undefined, false, registrationCode);
  for (let i = 0; i < 20; i++) await request(app).post('/login').send({}).expect(400);
  await request(app).post('/login').send({}).expect(429);
  for (let i = 0; i < 10; i++) await request(app).post('/register').send({ registrationCode }).expect(400);
  const res = await request(app).post('/register').send({ registrationCode }).expect(429);
  noRegistrationCode(res);
  assert.equal(createCalls(), 0);
});
test('registration rate limits also count rejected codes and closed registration', async () => {
  for (const code of [null, registrationCode]) {
    const { app, createCalls } = setup(undefined, false, code);
    for (let i = 0; i < 10; i++) await request(app).post('/register').send({ registrationCode: 'wrong-test-code' }).expect(403);
    const res = await request(app).post('/register').send({ registrationCode }).expect(429);
    assert.equal(createCalls(), 0);
    noRegistrationCode(res);
  }
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

test('registration configuration defaults to closed and validates without exposing the value', () => {
  const previous = process.env.REGISTRATION_CODE;
  try {
    delete process.env.REGISTRATION_CODE;
    assert.equal(getRegistrationCode(), null);
    for (const value of ['', '   ']) { process.env.REGISTRATION_CODE = value; assert.equal(getRegistrationCode(), null); }
    for (const value of ['too-short', 's'.repeat(129)]) {
      process.env.REGISTRATION_CODE = value;
      assert.throws(getRegistrationCode, (error: unknown) => error instanceof Error && /REGISTRATION_CODE.*12.*128/.test(error.message) && !error.message.includes(value));
    }
    for (const value of ['t'.repeat(12), 't'.repeat(128), registrationCode]) {
      process.env.REGISTRATION_CODE = value;
      assert.equal(getRegistrationCode(), value);
    }
  } finally {
    if (previous === undefined) delete process.env.REGISTRATION_CODE; else process.env.REGISTRATION_CODE = previous;
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
