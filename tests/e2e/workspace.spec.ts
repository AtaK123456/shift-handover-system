import { test, expect, type Page } from "@playwright/test";
import { navigate } from "./navigation.js";
test.setTimeout(60_000);
const record = (id: number, kind: string, title: string) => ({ id, kind, title, description: "Kontrol sonucu bekleniyor. Sonraki vardiya takip etmeli.", priority: "HIGH", equipmentCode: "GT1", createdAt: "2026-10-20T06:00:00Z" });
const task = record(1, "TASK", "GT1 titreşim kontrolü"), valve = record(2, "VALVE", "V-102 aktif vana");
const equipment = ["GT1", "GT2", "ST"].map((code, i) => ({ code, status: i ? "INACTIVE" : "ACTIVE", note: i ? "Planlı duruş" : "Bakım kontrolü bekleniyor", updatedAt: "2026-10-20T06:00:00Z", updatedBy: { name: "Operatör" }, version: 1 }));
const summary = { revision: 1, equipment, counts: { total: 8, important: 1, VALVE: 1, ATTENTION: 0, TASK: 7 }, important: [task], tasks: [task], valves: [valve], recent: [record(3, "NOTE", "Vardiya gözlemi")], activeShiftId: null, receipt: null };
async function login(page: Page) {
  await page.route("**/login", r => r.fulfill({ json: { token: "workspace-test", user: { id: 1, name: "Deniz Yılmaz", role: "WORKER" } } }));
  await page.route("**/ai/status", r => r.fulfill({ json: { enabled: false } }));
  await page.route("**/shifts/current", r => r.fulfill({ json: { currentShift: null } }));
  await page.route(/\/shifts\?/, r => r.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } }));
  await page.route("**/operations/**", r => r.fulfill({ json: r.request().url().endsWith("/summary") ? summary : { items: [], total: 0, page: 1, pageSize: 20 } }));
  await page.goto("/app/");
  await page.locator("#email").fill("workspace@example.com"); await page.locator("#password").fill("workspace-password-123"); await page.locator("#login-button").click();
  await expect(page.locator("#overview-important")).toContainText(task.title);
}

test("landing page observes current work; actions stay on dedicated pages and record details are readable", async ({ page }) => {
  const errors: string[] = [], writes: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("request", r => { if (!["GET", "HEAD"].includes(r.method()) && !r.url().endsWith("/login")) writes.push(r.url()); });
  await login(page);
  await expect(page.locator('[data-nav="overview"]')).toHaveAttribute("aria-current", "page");
  await expect(page.locator("#entry-form")).toBeHidden(); await expect(page.locator("#shift-button")).toBeHidden(); await expect(page.locator("#summary-read")).toBeHidden();
  await expect(page.locator("#overview-equipment .equipment-card")).toHaveCount(3);
  await expect(page.locator("#overview-tasks")).toContainText("1 / 7");
  await expect(page.locator("#overview-valves")).toContainText(valve.title);
  await expect(page.locator("#overview-updated")).toContainText("Son veri kontrolü");
  await page.locator("#overview-important .observation-card").click();
  await expect(page.locator("#overview-dialog")).toBeVisible();
  await expect(page.locator("#overview-detail-description")).toHaveText(task.description);
  await page.locator("#overview-detail-board").click();
  await expect(page.locator("#page-handover")).toBeVisible();
  await expect(page.locator("#shift-button")).toBeVisible(); await expect(page.locator("#summary-read")).toBeVisible();
  await page.goBack(); await expect(page.locator("#page-overview")).toBeVisible();
  await page.goForward(); await expect(page.locator("#page-handover")).toBeVisible();
  await navigate(page, "history"); await expect(page.locator("#export-button")).toBeVisible();
  await navigate(page, "overview");
  await page.screenshot({ path: "../workspace-overview-desktop.png", fullPage: true });
  expect(writes).toEqual([]); expect(errors).toEqual([]);
});

test("page navigation preserves draft text and photos; logout clears it and the observation snapshot", async ({ page }) => {
  await login(page); await navigate(page, "new-record");
  await page.locator('[data-quick-kind="NOTE"]').click();
  await page.locator("#entry-title").fill("Kaydedilmemiş not"); await page.locator("#entry-description").fill("Kayıt metni korunmalı");
  await page.locator("#entry-photos").setInputFiles({ name: "preview.png", mimeType: "image/png", buffer: Buffer.from("preview") });
  await navigate(page, "history"); await navigate(page, "overview"); await navigate(page, "new-record");
  await expect(page.locator("#entry-title")).toHaveValue("Kaydedilmemiş not"); await expect(page.locator("#entry-kind")).toHaveValue("NOTE");
  await expect(page.locator("#photo-previews figure")).toHaveCount(1);
  page.once("dialog", dialog => dialog.dismiss()); await page.locator("#logout").click(); await expect(page.locator("#dashboard")).toBeVisible();
  page.once("dialog", dialog => dialog.accept()); await page.locator("#logout").click();
  await expect(page.locator("#auth-view")).toBeVisible(); await expect(page.locator("#overview-important")).not.toContainText(task.title);
  await expect(page.locator("#entry-title")).toHaveValue("");
  await expect(page.locator("#overview-detail-description")).toBeEmpty();
});

test("observation marks refresh failures, supports both languages and keeps mobile navigation clear of AI", async ({ page }) => {
  await login(page);
  await page.route("**/operations/summary", r => r.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await page.locator("#overview-refresh").click();
  await expect(page.locator("#overview-updated")).toContainText("güncel olmayabilir");
  await expect(page.locator("#overview-important")).toContainText(task.title);
  await page.locator("#dashboard [data-language]").selectOption("en");
  await expect(page.locator("#page-title")).toHaveText("Overview"); await expect(page.locator("#overview-updated")).toContainText("outdated");
  await page.locator("#dashboard [data-theme-toggle]").click();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const nav = await page.locator(".workspace-nav").boundingBox(), ai = await page.locator("#ai-launcher").boundingBox();
    expect(ai!.y + ai!.height).toBeLessThanOrEqual(nav!.y);
    await navigate(page, "new-record"); await expect(page.locator("#entry-form")).toBeVisible();
    await navigate(page, "overview");
  }
  await page.screenshot({ path: "../workspace-overview-mobile.png", fullPage: true });
});


test("unknown shift status is not presented as an inactive shift; recent notes link to history", async ({ page }) => {
  await login(page);
  await page.route("**/shifts/current", r => r.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await page.locator("#overview-refresh").click();
  await expect(page.locator("#overview-updated")).toContainText("güncel olmayabilir");
  await page.locator("#overview-recent .observation-card").click();
  await expect(page.locator("#overview-detail-board")).toHaveText("Geçmişe git");
  await page.locator("#overview-detail-board").click();
  await expect(page.locator("#page-history")).toBeVisible();
  await page.locator("#logout").click();
  await page.locator("#email").fill("workspace@example.com"); await page.locator("#password").fill("workspace-password-123"); await page.locator("#login-button").click();
  await expect(page.locator("#overview-updated")).toContainText("güncel olmayabilir");
  await expect(page.locator("#overview-shift-status")).not.toHaveText("Vardiya kapalı");
  await expect(page.locator("#overview-shift-hours")).not.toContainText("Aktif vardiyan bulunmuyor");
});
