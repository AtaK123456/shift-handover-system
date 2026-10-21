import { test, expect, type Page } from "@playwright/test";
import { navigate } from "./navigation.js";
test.setTimeout(60_000);
const record = (id: number, kind: string, title: string) => ({ id, kind, title, description: "Kontrol sonucu bekleniyor. Sonraki vardiya takip etmeli.", priority: "HIGH", equipmentCode: "GT1", createdAt: "2026-10-20T06:00:00Z" });
const task = record(1, "TASK", "GT1 titreşim kontrolü"), valve = { ...record(2, "VALVE", "V-102 aktif vana"), priority: "NORMAL" };
const equipment = ["GT1", "GT2", "ST"].map((code, i) => ({ code, status: i === 0 ? "ACTIVE" : i === 1 ? "INACTIVE" : "MAINTENANCE", note: i ? "Planlı duruş" : "Bakım kontrolü bekleniyor", updatedAt: "2026-10-20T06:00:00Z", updatedBy: { name: "Operatör" }, version: 1 }));
const attention = { ...record(4, "ATTENTION", "ST yağ seviyesi takip edilecek"), equipmentCode: "ST", priority: "NORMAL" };
const summary = { revision: 1, equipment, counts: { total: 8, important: 1, VALVE: 1, ATTENTION: 1, TASK: 6 }, openItems: [task, valve, attention], attention: [attention], important: [task], tasks: [task], valves: [valve], recent: [{ ...record(3, "NOTE", "Vardiya gözlemi"), priority: "NORMAL" }], activeShiftId: null, receipt: null };
async function login(page: Page, role = "WORKER") {
  await page.route("**/login", r => r.fulfill({ json: { token: "workspace-test", user: { id: 1, name: "Deniz Yılmaz", role } } }));
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
  await expect(page.locator("#overview-important")).toContainText("3 / 8");
  await expect(page.locator("#overview-important")).toContainText(valve.title);
  await expect(page.locator("#overview-updated")).toContainText("Son veri kontrolü");
  await page.locator("#overview-important .observation-card").first().click();
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


test("plant workflow retains four pages and fixed turbine choices without catalog administration", async ({ page }) => {
  await login(page, "MANAGER");
  await expect(page.locator("[data-nav]")).toHaveCount(4);
  await navigate(page, "handover");
  await expect(page.locator("#catalog-add")).toHaveCount(0); await expect(page.locator(".catalog-rename")).toHaveCount(0);
  await expect(page.locator("#equipment-grid .equipment-card")).toHaveCount(3);
  await expect(page.locator("[data-i18n=equipmentHint]")).toContainText("gaz türbini");
  await navigate(page, "new-record");
  expect(await page.locator("#entry-unit option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(["", "GT1", "GT2", "ST"]);
  await page.locator("#entry-unit").selectOption("GT2"); await page.locator("#entry-title").fill("GT2 vardiya notu");
  await navigate(page, "overview"); await navigate(page, "new-record");
  await expect(page.locator("#entry-unit")).toHaveValue("GT2"); await expect(page.locator("#entry-title")).toHaveValue("GT2 vardiya notu");
});


test("overview lists entries once with honest totals and read-only details", async ({ page }) => {
  await login(page);
  await expect(page.locator("#overview-important")).toContainText(attention.title);
  await expect(page.locator(`#overview-important [data-entry-id="${task.id}"]`)).toHaveCount(1);
  await expect(page.locator("#overview-important .observation-card")).toHaveCount(3);
  await expect(page.locator("#overview-counts strong")).toHaveText(["8", "1", "6", "1"]);
  await expect(page.locator("#overview-important")).toContainText("Açılış:");
  await page.locator(`#overview-important [data-entry-id="${attention.id}"]`).click();
  await expect(page.locator("#overview-detail-description")).toHaveText(task.description);
  await page.keyboard.press("Escape");
  await page.locator("#dashboard [data-language]").selectOption("en");
  await expect(page.locator("#overview-open-title")).toHaveText("Open Work & Alerts");
  await expect(page.locator("#overview-important")).toContainText("Opened:");
  await page.route("**/operations/summary", r => r.fulfill({ json: { ...summary, counts: { total: 0, important: 0, TASK: 0, ATTENTION: 0, VALVE: 0 }, openItems: [], tasks: [], important: [], attention: [], valves: [] } }));
  await page.locator("#overview-refresh").click();
  await expect(page.locator("#overview-counts strong")).toHaveText(["0", "0", "0", "0"]);
  await expect(page.locator("#overview-important button")).toHaveCount(0);
});

test("overview avoids hidden lists and unchanged refreshes retain card identity and focus", async ({ page }) => {
  const reads: string[] = [];
  page.on("request", r => { if (r.method() === "GET") reads.push(new URL(r.url()).pathname + new URL(r.url()).search); });
  await login(page);
  expect(reads.filter(path => path.startsWith("/shifts?") || path.startsWith("/operations/entries?"))).toEqual([]);
  await page.locator("#overview-important button").first().evaluate(el => { (window as any).retainedCard = el; (el as HTMLElement).focus(); });
  await page.locator("#overview-refresh").evaluate(el => (el as HTMLButtonElement).click());
  await expect(page.locator("#overview-refresh")).toBeEnabled();
  expect(await page.locator("#overview-important button").first().evaluate(el => el === (window as any).retainedCard)).toBe(true);
  await expect(page.locator("#overview-important button").first()).toBeFocused();
  reads.length = 0;
  await navigate(page, "new-record");
  await page.locator("#entry-title").fill("Draft stays intact");
  expect(reads.filter(path => path.startsWith("/operations/") || path.startsWith("/shifts"))).toEqual([]);
  await navigate(page, "history");
  await expect(page.locator("#table-loading")).toBeHidden();
  expect(reads.some(path => path.startsWith("/shifts?"))).toBe(true);
  expect(reads.some(path => path.startsWith("/operations/entries?") && path.includes("view=history"))).toBe(true);
  await navigate(page, "new-record"); await expect(page.locator("#entry-title")).toHaveValue("Draft stays intact");
});

test("live refresh pauses in hidden tabs and resumes once on returning to the overview", async ({ page }) => {
  await page.clock.install();
  await login(page); await expect(page.locator("#login-button")).toBeEnabled();
  let summaries = 0;
  page.on("request", r => { if (new URL(r.url()).pathname === "/operations/summary") summaries++; });
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.clock.runFor(60_000);
  expect(summaries).toBe(0);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(() => summaries).toBe(1);
  await expect(page.locator("#overview-updated")).toContainText("Son veri kontrolü");
});

test("visible text meets WCAG AA contrast on all four pages in both themes", async ({ page }) => {
  await login(page);
  await page.evaluate(() => { const message = document.getElementById("dashboard-message")!; message.textContent = "Bağlantı hatası / Connection error"; message.classList.add("error"); });
  for (const theme of ["light", "dark"]) {
    if (await page.locator("html").getAttribute("data-theme") !== theme) await page.locator("#dashboard [data-theme-toggle]").click();
    for (const section of ["overview", "new-record", "handover", "history"] as const) {
      await navigate(page, section);
      const failures = await page.evaluate(() => {
        const rgb = (s: string) => (s.match(/[\d.]+/g) || []).map(Number);
        const luminance = (color: number[]) => color.slice(0,3).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((n,c,i) => n + c * [.2126,.7152,.0722][i]!,0);
        const failures: string[] = [];
        for (const element of document.querySelectorAll<HTMLElement>("#dashboard *")) {
          if (!element.getClientRects().length || element.closest(":disabled") || ![...element.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())) continue;
          if (getComputedStyle(element).visibility === "hidden") continue;
          const style = getComputedStyle(element), foreground = rgb(style.color);
          let parent: HTMLElement | null = element, background = [255,255,255];
          while (parent) { const color = rgb(getComputedStyle(parent).backgroundColor); if ((color[3] ?? 1) === 1) { background = color; break; } parent = parent.parentElement; }
          const a = luminance(foreground), b = luminance(background), ratio = (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
          const size = parseFloat(style.fontSize), large = size >= 24 || size >= 18.66 && Number(style.fontWeight) >= 700;
          if (ratio < (large ? 3 : 4.5)) failures.push(`${element.tagName}.${element.className}: ${element.textContent?.trim().slice(0,35)} (${ratio.toFixed(2)})`);
        }
        return failures;
      });
      expect(failures, `${theme} ${section}`).toEqual([]);
    }
  }
});

test("handover filters cover the full list and persist through pagination, navigation and failures", async ({ page }) => {
  const requests: URLSearchParams[] = [];
  await login(page);
  await page.route(/\/operations\/entries\?/, r => {
    const params = new URL(r.request().url()).searchParams;
    if (params.get("view") !== "open") return r.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } });
    requests.push(params);
    if (params.get("equipment") === "GT2") return r.fulfill({ status: 503, json: { error: "Unavailable" } });
    const filtered = params.get("kind") === "TASK" && params.get("equipment") === "GT1" && params.get("priority") === "HIGH", pageNo = Number(params.get("page"));
    const items = (filtered && pageNo === 1 ? Array.from({ length: 20 }, (_,i) => i+1) : [filtered ? 21 : 1]).map(id => ({ ...record(id, "TASK", `Filtered work ${id}`), author: { name: "Operator" }, photos: [], closedAt: null }));
    return r.fulfill({ json: { items, total: filtered ? 21 : 1, page: pageNo, pageSize: 20 } });
  });
  await navigate(page, "handover");
  await page.locator("#board-kind").selectOption("TASK"); await page.locator("#board-unit").selectOption("GT1"); await page.locator("#board-priority").selectOption("HIGH");
  await page.locator("#board-apply").click();
  await expect(page.locator("#board-count")).toHaveText("21"); await page.locator("#board-next").click();
  await expect(page.locator("#board-page")).toContainText("21–21 / 21");
  expect(requests.at(-1)?.get("priority")).toBe("HIGH"); expect(requests.at(-1)?.get("equipment")).toBe("GT1");
  await navigate(page, "overview"); await navigate(page, "handover");
  await expect(page.locator("#board-unit")).toHaveValue("GT1"); await expect(page.locator("#board-page")).toContainText("21–21 / 21");
  await page.locator("#board-unit").selectOption("GT2"); await page.locator("#board-apply").click();
  await expect(page.locator("#board-apply")).toBeEnabled();
  await expect(page.locator("#board-unit")).toHaveValue("GT1"); await expect(page.locator("#board-page")).toContainText("21–21 / 21");
  await page.locator("#board-clear").click();
  await expect(page.locator("#board-count")).toHaveText("1"); await expect(page.locator("#board-unit")).toHaveValue("");
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator("#board-apply")).toBeVisible();
  }
  await page.screenshot({ path: "../clear-handover-mobile.png", fullPage: true });
});
