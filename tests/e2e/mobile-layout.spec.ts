import { test, expect, type Page } from "@playwright/test";
import { navigate } from "./navigation.js";
test.setTimeout(90_000);
const item = { id: 1, kind: "TASK", priority: "HIGH", title: "GT1 bakım kontrolü " + "x".repeat(100), description: "Sonraki vardiya kontrol sonucunu takip etmeli.", equipmentCode: "GT1", author: { id: 1, name: "Deniz Yılmaz" }, photos: [], closedAt: null, createdAt: "2026-10-22T05:00:00Z", workStatus: "WAITING", responsibleTeam: "Mekanik bakım", nextStep: "Ölçüm bekleniyor", workVersion: 0 };
async function setup(page: Page) {
  await page.route("**/login", r => r.fulfill({ json: { token: "mobile-test", user: { id: 1, name: "Deniz Yılmaz", role: "WORKER" } } }));
  await page.route("**/ai/status", r => r.fulfill({ json: { enabled: true } }));
  await page.route("**/shifts/current", r => r.fulfill({ json: { currentShift: null } }));
  await page.route(/\/shifts\?/, r => r.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } }));
  await page.route("**/operations/**", r => {
    const url = new URL(r.request().url());
    if (url.pathname.endsWith("/summary")) return r.fulfill({ json: { revision: 1, equipment: ["GT1", "GT2", "ST"].map(code => ({ code, status: "MAINTENANCE", note: "Kontrol sonucu bekleniyor" })), counts: { total: 1, important: 1, TASK: 1, ATTENTION: 0, VALVE: 0 }, openItems: [item], important: [item], recent: [], activeShiftId: null, receipt: null } });
    if (url.pathname.endsWith("/work")) return r.fulfill({ json: { entry: item, items: Array.from({ length: 20 }, (_,i) => ({ ...item, id: i+1, version: 20-i, author: item.author })), total: 23, page: 1, pageSize: 20, canWrite: true } });
    return r.fulfill({ json: { items: [item], total: 1, page: 1, pageSize: 20 } });
  });
}
async function login(page: Page) {
  await page.locator("#email").fill("mobile@example.com"); await page.locator("#password").fill("mobile-password-123"); await page.locator("#login-button").click();
  await expect(page.locator("#overview-important")).toContainText("GT1 bakım");
}
async function targets(page: Page) {
  const failures = await page.evaluate(() => {
    const failures: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('button,.button,.text-button,[data-language],[data-nav]')) {
      if (!el.getClientRects().length || el.closest(":disabled") || getComputedStyle(el).visibility === "hidden") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 43.9 || rect.height < 43.9) failures.push(`${el.id || el.className}: ${rect.width}×${rect.height}`);
    }
    return failures;
  });
  expect(failures).toEqual([]);
}
async function fakeViewport(page: Page) {
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    (window as any).resizeVisibleArea = (height: number, offsetTop = 0, scale = 1) => { Object.assign(viewport, { height, offsetTop, scale }); viewport.dispatchEvent(new Event("resize")); };
  });
}

test("phone pages have readable fields, large targets and no horizontal overflow in both languages and themes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await setup(page); await page.goto("/app/"); await targets(page); await login(page);
  for (const [language, theme] of [["tr", "light"], ["en", "dark"]]) {
    await page.locator("#dashboard [data-language]").selectOption(language!);
    if (await page.locator("html").getAttribute("data-theme") !== theme) await page.locator("#dashboard [data-theme-toggle]").click();
    for (const width of [320, 360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      for (const section of ["overview", "new-record", "handover", "history"] as const) {
        await navigate(page, section); await targets(page);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const smallFields = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('input:not([type=checkbox]):not([type=file]),select,textarea')].filter(el => el.getClientRects().length && parseFloat(getComputedStyle(el).fontSize) < 16).map(el => el.id));
        expect(smallFields).toEqual([]);
      }
    }
  }
  await navigate(page, "overview"); await page.screenshot({ path: "../phone-overview.png", fullPage: true });
});

test("landscape phones retain bottom navigation and forms without changing desktop layout", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 }); await setup(page); await page.goto("/app/"); await login(page);
  const nav = await page.locator(".workspace-nav").boundingBox(); expect(nav!.width).toBe(844); expect(nav!.y + nav!.height).toBeLessThanOrEqual(391);
  await navigate(page, "new-record"); await page.locator("#entry-kind").selectOption("TASK"); await page.locator("#entry-work-next").fill("Telefon taslağı");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await targets(page);
  await page.locator("#ai-launcher").click();
  await page.locator("#ai-chat-input").fill("Yatay telefonda AI taslağı");
  await page.locator("#ai-analyze").scrollIntoViewIfNeeded();
  const send = await page.locator("#ai-analyze").boundingBox();
  expect(send!.y).toBeGreaterThanOrEqual(0); expect(send!.y + send!.height).toBeLessThanOrEqual(nav!.y);
  await page.locator("#ai-chat-close").click();
  await page.setViewportSize({ width: 1280, height: 900 });
  expect((await page.locator(".workspace-nav").boundingBox())!.width).toBeLessThan(300);
  await expect(page.locator("#entry-work-next")).toHaveValue("Telefon taslağı");
});

test("keyboard-sized visual viewports keep dialog editors reachable and preserve unsent work", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await fakeViewport(page); await setup(page); await page.goto("/app/"); await login(page);
  await navigate(page, "handover"); await page.locator('[data-work-for="1"]').click(); await expect(page.locator("#work-next")).toHaveValue(item.nextStep);
  await page.locator("#work-next").fill("Kaydedilmemiş mobil taslak");
  await page.evaluate(() => (window as any).resizeVisibleArea(360, 60));
  await expect(page.locator("html")).toHaveClass(/keyboard-open/);
  const box = await page.locator("#work-dialog").boundingBox(); expect(box!.y).toBeGreaterThanOrEqual(60); expect(box!.y + box!.height).toBeLessThanOrEqual(420);
  await expect.poll(async () => {
    const header = await page.locator("#work-dialog > .section-title").boundingBox(), editor = await page.locator("#work-next").boundingBox();
    return editor!.y >= header!.y + header!.height && editor!.y + editor!.height <= box!.y + box!.height;
  }).toBe(true);
  await expect(page.locator("#work-next")).toBeFocused(); await expect(page.locator(".workspace-nav")).toBeHidden();
  await targets(page);
  await page.screenshot({ path: "../phone-keyboard-dialog.png" });
  await page.evaluate(() => (window as any).resizeVisibleArea(844)); await expect(page.locator("html")).not.toHaveClass(/keyboard-open/);
  await page.locator("#work-close").click(); await expect(page.locator(".workspace-nav")).toBeVisible();
  await page.locator('[data-work-for="1"]').click(); await expect(page.locator("#work-next")).toHaveValue("Kaydedilmemiş mobil taslak");
});

test("phone AI composer fits above the keyboard and pinch zoom does not hide navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await fakeViewport(page); await setup(page); await page.goto("/app/"); await login(page);
  await page.locator("#ai-launcher").click(); await page.locator("#ai-chat-input").fill("GT1 için kontrol notu yazıyorum");
  await page.evaluate(() => (window as any).resizeVisibleArea(330)); await expect(page.locator("html")).toHaveClass(/keyboard-open/);
  const chat = await page.locator("#ai-chat").boundingBox(); expect(chat!.y).toBeGreaterThanOrEqual(0); expect(chat!.y + chat!.height).toBeLessThanOrEqual(330);
  await targets(page); await expect(page.locator("#ai-chat-input")).toHaveValue("GT1 için kontrol notu yazıyorum");
  await page.evaluate(() => (window as any).resizeVisibleArea(844)); await page.locator("#ai-chat-close").click();
  await page.locator("#ai-launcher").click(); await expect(page.locator("#ai-chat-input")).toHaveValue("GT1 için kontrol notu yazıyorum");
  await page.evaluate(() => (window as any).resizeVisibleArea(400, 0, 2)); await expect(page.locator("html")).not.toHaveClass(/keyboard-open/); await expect(page.locator(".workspace-nav")).toBeVisible();
});

test("mobile layout remains usable without the visual viewport API", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.addInitScript(() => Object.defineProperty(window, "visualViewport", { value: undefined }));
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await setup(page); await page.goto("/app/"); await login(page); await navigate(page, "new-record");
  await page.locator("#entry-title").fill("Yedek görünüm"); await page.setViewportSize({ width: 640, height: 360 });
  await expect(page.locator("#entry-title")).toHaveValue("Yedek görünüm"); await targets(page); expect(errors).toEqual([]);
});
