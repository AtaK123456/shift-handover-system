import assert from "node:assert/strict";
import OpenAI from "openai";
import { test } from "node:test";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { aiFailure, createOpenAiAnalyzer, validateAnalysis, type Analyzer, type AnalysisInput } from "../src/services/ai-analysis.js";
import type { PrismaClient } from "../src/generated/prisma/client.js";
const secret = "ai-test-secret-".repeat(4);
const input: AnalysisInput = { title: "GT1 vibration", description: "GT1 vibration increased. Maintenance review requested.", language: "en" };
const proposal = { equipment: "GT1", category: "VIBRATION", kind: "ATTENTION", priority: "HIGH",
  rationale: "A reported abnormal condition needs review.", uncertainty: "No measured value or plant limits provided.",
  evidence: ["GT1 vibration increased."], questions: ["What was the measured vibration?"] } as const;
function setup(analyzer: Analyzer | null) {
  const db = { user: { findUnique: async ({ where }: any) => where.id === 2 ? null : { id: where.id, role: "WORKER" } } } as unknown as PrismaClient;
  return createApp(db, secret, { analyzer });
}
const bearer = (id = 1) => `Bearer ${jwt.sign({ id }, secret, { expiresIn: "1h" })}`;
const send = (app: ReturnType<typeof createApp>, body: unknown = input, id = 1) => request(app).post("/ai/analyze").set("Authorization", bearer(id)).send(body);
const analyzer: Analyzer = async () => structuredClone(proposal) as any;

test("AI endpoints require a current authenticated account", async () => {
  let called = false; const app = setup(async () => { called = true; return analyzer(input); });
  await request(app).get("/ai/status").expect(401);
  await request(app).post("/ai/analyze").send(input).expect(401);
  await send(app, input, 2).expect(401);
  assert.equal(called, false);
});
test("AI stays optional when unconfigured", async () => {
  const app = setup(null);
  await request(app).get("/ai/status").set("Authorization", bearer()).expect(200, { enabled: false });
  await send(app).expect(503, { error: "AI_DISABLED" });
  assert.equal(createOpenAiAnalyzer({ AI_ENABLED: "false", OPENAI_API_KEY: "not-a-real-key" }), null);
  assert.equal(createOpenAiAnalyzer({ AI_ENABLED: "true" }), null);
});
test("AI input is bounded and rejects extra fields before calling the provider", async () => {
  let calls = 0; const app = setup(async () => { calls++; return analyzer(input); });
  for (const body of [{}, { ...input, description: " " }, { ...input, title: "x".repeat(161) },
    { ...input, description: "x".repeat(4001) }, { ...input, language: "jp" },
    { ...input, photos: ["photo"] }, { ...input, userId: 999 }, { ...input, title: [] }]) {
    await send(app, body).expect(400, { error: "AI_INVALID_INPUT" });
  }
  assert.equal(calls, 0);
});
test("analysis returns proposals without writing operations or equipment", async () => {
  let received: AnalysisInput | undefined;
  const app = setup(async value => { received = value; return analyzer(value); });
  await send(app).expect(200, { analysis: proposal });
  assert.deepEqual(received, input);
});
test("provider errors, fabricated evidence, and malformed results fail safely", async () => {
  const bad = [async () => { throw new Error("secret-provider-key and private-plant-record"); },
    async () => ({ ...proposal, equipment: "GT9" }), async () => ({ ...proposal, evidence: ["Invented reading 99"] }),
    async () => ({ ...proposal, command: "shutdown" }), async () => ({ ...proposal, questions: Array(6).fill("Question?") })];
  for (const badAnalyzer of bad) await send(setup(badAnalyzer as Analyzer)).expect(502, { error: "AI_UNAVAILABLE" });
});
test("rate limits are per authenticated user and cannot be bypassed by body identity", async () => {
  const app = setup(analyzer);
  for (let i = 0; i < 10; i++) await send(app).expect(200);
  await send(app).expect(429, { error: "AI_RATE_LIMIT" });
  await send(app, input, 3).expect(200);
});
test("simultaneous upstream calls are bounded and release capacity", async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let count = 0;
  const app = setup(async value => { count++; await gate; return analyzer(value); });
  const active = [1,3,4].map(id => send(app,input,id).then(response => response));
  try {
    for (let i = 0; i < 100 && count < 3; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(count, 3);
    await send(app,input,5).expect(503, { error: "AI_BUSY" });
  } finally { release(); }
  for (const result of await Promise.all(active)) assert.equal(result.status, 200);
  await send(app,input,5).expect(200);
});
test("unknown suggestions are supported but evidence must come from the operator record", () => {
  assert.equal(validateAnalysis({ ...proposal, equipment: "UNKNOWN", priority: "UNKNOWN" }, input).priority, "UNKNOWN");
  assert.throws(() => validateAnalysis({ ...proposal, rationale: "" }, input));
});

test("OpenAI adapter uses strict output, no storage, and only submitted text", async () => {
  let sent: any;
  const adapter = createOpenAiAnalyzer({ AI_ENABLED: "true", OPENAI_API_KEY: "not-a-real-key", OPENAI_MODEL: "configured-model" }, async (_url, options) => {
    sent = JSON.parse(String(options?.body));
    return new Response(JSON.stringify({ id: "resp_test", object: "response", status: "completed", output: [
      { id: "msg_test", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(proposal), annotations: [] }] }
    ] }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  assert.ok(adapter);
  assert.deepEqual(await adapter(input), proposal);
  assert.equal(sent.model, "configured-model");
  assert.equal(sent.store, false);
  assert.equal(sent.text.format.strict, true);
  assert.equal(sent.text.format.schema.properties.rationale.minLength, undefined);
  assert.equal(sent.text.format.schema.properties.rationale.maxLength, undefined);
  assert.equal(sent.max_output_tokens, 1800);
  assert.deepEqual(JSON.parse(sent.input[1].content), input);
  assert.match(sent.input[0].content, /untrusted JSON record/);
});

test("OpenAI adapter rejects incomplete output and does not retry provider errors", async () => {
  const incomplete = createOpenAiAnalyzer({ AI_ENABLED: "true", OPENAI_API_KEY: "not-a-real-key" }, async () =>
    new Response(JSON.stringify({ id: "resp_test", object: "response", status: "incomplete", output: [] }), { headers: { "Content-Type": "application/json" } }));
  await assert.rejects(incomplete!(input));
  let calls = 0;
  const unavailable = createOpenAiAnalyzer({ AI_ENABLED: "true", OPENAI_API_KEY: "not-a-real-key" }, async () => {
    calls++; return new Response(JSON.stringify({ error: { message: "Provider unavailable" } }), { status: 429, headers: { "Content-Type": "application/json" } });
  });
  await assert.rejects(unavailable!(input)); assert.equal(calls, 1);
});

test("provider failures have safe actionable codes without expiring the operator session", async () => {
  for (const [status, code, expected] of [
    [401, "invalid_api_key", "AI_KEY_INVALID"], [403, "permission_denied", "AI_ACCESS_DENIED"],
    [429, "insufficient_quota", "AI_QUOTA"], [429, "rate_limit_exceeded", "AI_PROVIDER_RATE_LIMIT"],
    [404, "model_not_found", "AI_MODEL_UNAVAILABLE"], [400, "invalid_json_schema", "AI_CONFIGURATION"]
  ] as const) {
    const adapter = createOpenAiAnalyzer({ AI_ENABLED: "true", OPENAI_API_KEY: "private-key" }, async () =>
      new Response(JSON.stringify({ error: { code, message: "private-key private-plant-text" } }), { status, headers: { "Content-Type": "application/json" } }));
    const app = setup(adapter);
    await send(app).expect(503, { error: expected });
    await request(app).get("/ai/status").set("Authorization", bearer()).expect(200, { enabled: true });
  }
});

test("incomplete, refused, and invalid provider responses remain distinct and never become suggestions", async () => {
  for (const [status, content, expected, http] of [
    ["incomplete", [], "AI_INCOMPLETE", 502],
    ["completed", [{ type: "refusal", refusal: "private refusal text" }], "AI_REFUSED", 422],
    ["completed", [{ type: "output_text", text: "not json", annotations: [] }], "AI_INVALID_RESPONSE", 502],
    ["completed", [{ type: "output_text", text: JSON.stringify({ ...proposal, evidence: ["invented"] }), annotations: [] }], "AI_INVALID_RESPONSE", 502]
  ] as const) {
    const adapter = createOpenAiAnalyzer({ AI_ENABLED: "true", OPENAI_API_KEY: "private-key" }, async () =>
      new Response(JSON.stringify({ id: "resp_test", object: "response", status, output: [{ type: "message", role: "assistant", content }] }), { headers: { "Content-Type": "application/json" } }));
    await send(setup(adapter)).expect(http, { error: expected });
  }
});


test("connection and timeout errors use safe codes", () => {
  assert.deepEqual(aiFailure(new OpenAI.APIConnectionTimeoutError()), { error: "AI_TIMEOUT", status: 504 });
  assert.deepEqual(aiFailure(new OpenAI.APIConnectionError({ message: "private connection detail" })), { error: "AI_CONNECTION", status: 503 });
});
