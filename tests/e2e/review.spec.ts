import { navigate } from "./navigation.js";
import { test, expect, type Page } from "@playwright/test";
test.setTimeout(60_000);
const unit = { code: "GT1", status: "UNKNOWN", note: "", version: 0, updatedAt: null, updatedBy: null };
const entry = (id: number) => ({ id, title: `Record ${id}`, description: "Inspection pending", kind: "TASK", priority: "HIGH", equipmentCode: "GT1", photos: [], author: { id: 1, name: "Operator" }, createdAt: "2026-10-19T06:00:00Z", closedAt: null });
const overview = { revision: 1, equipment: [unit], counts: { total: 1, important: 1, VALVE: 0, ATTENTION: 0, TASK: 1 }, important: [], recent: [], activeShiftId: null, receipt: null };
async function setup(page: Page) {
  await page.route("**/login", r => r.fulfill({ json: { token: "review-token", user: { id: 1, name: "Operator", role: "WORKER" } } }));
  await page.route("**/ai/status", r => r.fulfill({ json: { enabled: true } }));
  await page.route("**/shifts/current", r => r.fulfill({ json: { currentShift: null } }));
  await page.route(/\/shifts\?/, r => r.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } }));
  await page.route("**/operations/**", r => r.fulfill({ json: r.request().url().endsWith("summary") ? overview : { items: [entry(1)], total: 1, page: 1, pageSize: 20 } }));
}
async function login(page: Page) {
  await page.goto("/app/"); await page.locator("#email").fill("review@example.com");
  await page.locator("#password").fill("test-password-123"); await page.locator("#login-button").click();
  await expect(page.locator("#dashboard")).toBeVisible();
}

test("older current-shift responses cannot overwrite newer state", async ({ page }) => {
  await setup(page); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); let requests = 0;
  await page.route("**/shifts/current", async r => {
    if (++requests === 1) { await gate; await r.fulfill({ json: { currentShift: null } }); }
    else await r.fulfill({ json: { currentShift: { id: 1, shiftDate: "2026-10-19", scheduledStart: "08:00", scheduledEnd: "16:00", startTime: "2026-10-19T05:00:00Z" } } });
  });
  await login(page); await navigate(page, "handover"); await page.locator("#shift-button").click();
  await expect(page.locator("#shift-badge")).toHaveText("Vardiya aktif");
  release(); await expect(page.locator("#login-button")).toBeEnabled();
  await expect(page.locator("#shift-badge")).toHaveText("Vardiya aktif");
});

test("history returns to a valid page after records disappear from the last page", async ({ page }) => {
  await setup(page); let shrink = false;
  await page.route(/\/operations\/entries\?/, r => {
    const params = new URL(r.request().url()).searchParams, pageNo = Number(params.get("page"));
    const isHistory = params.get("view") === "history";
    return r.fulfill({ json: { items: isHistory ? shrink ? pageNo === 1 ? [entry(1)] : [] : pageNo === 1 ? Array.from({length:20},(_,i)=>entry(i+1)) : [entry(21)] : [], total: isHistory ? shrink ? 1 : 21 : 0, page: pageNo, pageSize: 20 } });
  });
  await login(page); await navigate(page, "history"); await page.locator("#operation-next").click();
  await expect(page.locator("#operation-page")).toContainText("21–21");
  shrink = true; await navigate(page, "handover"); await page.locator("#refresh-operations").click(); await navigate(page, "history");
  await expect(page.locator("#operation-entries .entry-card")).toHaveCount(1);
  await expect(page.locator("#operation-page")).toContainText("1–1 / 1");
  await expect(page.locator("#operation-previous")).toBeDisabled();
});

test("failed page requests retain the displayed page and its rows", async ({ page }) => {
  await setup(page);
  await page.route(/\/operations\/entries\?/, r => {
    const p = new URL(r.request().url()).searchParams;
    if (p.get("view") === "history" && p.get("page") === "2") return r.fulfill({ status: 503, json: { error: "Unavailable" } });
    return r.fulfill({ json: { items: Array.from({length:20},(_,i)=>entry(i+1)), total: 21, page: 1, pageSize: 20 } });
  });
  await login(page); await navigate(page, "history"); await page.locator("#operation-next").click();
  await expect(page.locator("#dashboard-message")).not.toBeEmpty();
  await expect(page.locator("#operation-page")).toContainText("1–20 / 21");
  await expect(page.locator("#operation-previous")).toBeDisabled();
});

test("failed closure retains the open dialog and operator note", async ({ page }) => {
  await setup(page); await page.route("**/operations/entries/1/close", r => r.fulfill({ status: 503, json: { error: "Temporary failure" } }));
  await login(page); await navigate(page, "handover"); await page.locator("#board-entries button").click();
  await page.locator("#close-note").fill("Important closure explanation"); await page.locator("#close-save").click();
  await expect(page.locator("#close-dialog")).toBeVisible();
  await expect(page.locator("#close-note")).toHaveValue("Important closure explanation");
  await expect(page.locator("#close-message")).not.toBeEmpty();
});

test("failed equipment update retains status and note in its dialog", async ({ page }) => {
  await setup(page); await page.route("**/operations/equipment/GT1", r => r.fulfill({ status: 503, json: { error: "Temporary failure" } }));
  await login(page); await navigate(page, "handover"); await page.locator("#equipment-grid button").click();
  await page.locator("#equipment-status").selectOption("MAINTENANCE"); await page.locator("#equipment-note").fill("Awaiting inspection");
  await page.locator("#equipment-save").click();
  await expect(page.locator("#equipment-dialog")).toBeVisible();
  await expect(page.locator("#equipment-status")).toHaveValue("MAINTENANCE");
  await expect(page.locator("#equipment-note")).toHaveValue("Awaiting inspection");
  await expect(page.locator("#equipment-message")).not.toBeEmpty();
});

test("typing the same text again during analysis does not erase the new message", async ({ page }) => {
  await setup(page); let release!: () => void, received!: () => void;
  const gate = new Promise<void>(resolve=>{release=resolve;}), arrived = new Promise<void>(resolve=>{received=resolve;});
  await page.route("**/ai/analyze", async r => { received(); await gate; await r.fulfill({ json: { analysis: {
    equipment: "GT1", category: "VIBRATION", kind: "ATTENTION", priority: "HIGH", rationale: "Review vibration.", uncertainty: "No measured value.", evidence: ["GT1 vibration increased."], questions: []
  } } }); });
  await login(page); await page.locator("#ai-launcher").click();
  await page.locator("#ai-chat-input").fill("GT1 vibration increased."); await page.locator("#ai-analyze").click(); await arrived;
  await page.locator("#ai-chat-input").fill(""); await page.locator("#ai-chat-input").fill("GT1 vibration increased.");
  release(); await expect(page.locator("#ai-result")).toBeVisible();
  await expect(page.locator("#ai-chat-input")).toHaveValue("GT1 vibration increased.");
});

test("ending an old shift resets the next shift date instead of carrying it forward", async ({ page }) => {
  await setup(page); let ended = false;
  await page.route("**/shifts/current", r => r.fulfill({ json: { currentShift: ended ? null : { id: 1, shiftDate: "2020-01-01", scheduledStart: "16:00", scheduledEnd: "00:00", startTime: "2020-01-01T13:00:00Z" } } }));
  await page.route("**/shifts/end", r => { ended=true; return r.fulfill({ json: {} }); });
  await login(page); await navigate(page, "handover"); await expect(page.locator("#shift-date")).toHaveValue("2020-01-01");
  await page.locator("#shift-button").click(); await expect(page.locator("#shift-badge")).toHaveText("Vardiya kapalı");
  const today = await page.evaluate(()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Istanbul"}).format(new Date()));
  await expect(page.locator("#shift-date")).toHaveValue(today);
});

test("logout clears the prior handover overview before another login", async ({ page }) => {
  await setup(page); await login(page);
  await expect(page.locator("#summary-units .unit-status")).toHaveCount(1);
  await page.locator("#logout").click(); await expect(page.locator("#auth-view")).toBeVisible();
  await expect(page.locator("#summary-units")).toBeEmpty();
  await expect(page.locator("#summary-counts")).toBeEmpty();
  await expect(page.locator("#summary-important")).toBeEmpty();
  await expect(page.locator("#summary-recent")).toBeEmpty();
});
