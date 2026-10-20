import { navigate } from "./navigation.js";
import { test, expect, type Page } from "@playwright/test";
// Multi-step chat flows also run on resource-constrained CI workers.
test.setTimeout(60_000);
const proposal = { equipment: "GT1", category: "VIBRATION", kind: "ATTENTION", priority: "HIGH",
  rationale: "Titreşim artışı ve bakım kontrolü isteği var.", uncertainty: "Ölçüm değeri ve tesis limiti belirtilmemiş.",
  evidence: ["GT1 ünitesinde titreşim artışı gözlendi."], questions: ["Ölçülen titreşim değeri nedir?"] };
async function signIn(page: Page, enabled = true) {
  await page.route("**/ai/status", route => route.fulfill({ json: { enabled } }));
  await page.route("**/operations/**", route => route.fulfill({ json: route.request().url().endsWith("/summary") ? {
    revision: 0, equipment: ["GT1", "GT2", "ST"].map(code => ({ code, name: code, status: "UNKNOWN", version: 0 })), counts: { total: 0, important: 0, VALVE: 0, ATTENTION: 0, TASK: 0 }, important: [], recent: [], activeShiftId: null, receipt: null
  } : { items: [], total: 0, page: 1, pageSize: 20 } }));
  await page.route("**/login", route => route.fulfill({ json: { token: "ui-test-token", user: { id: 1, name: "Deniz", email: "test@example.com", role: "WORKER" } } }));
  await page.route("**/shifts/current", route => route.fulfill({ json: { currentShift: null } }));
  await page.route(/\/shifts\?/, route => route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } }));
  await page.goto("/app/");
  await page.locator("#email").fill("test@example.com");
  await page.locator("#password").fill("test-password-123");
  await page.locator("#login-button").click();
  await expect(page.locator("#dashboard")).toBeVisible();
  await expect(page.locator("#ai-status")).not.toHaveText("AI kullanılabilirliği kontrol ediliyor…");
}
async function fillEntry(page: Page) {
  await navigate(page, "new-record");
  await page.locator("#entry-title").fill("Titreşim gözlemi");
  await page.locator("#entry-description").fill("GT1 ünitesinde titreşim artışı gözlendi. Bakım ekibinin kontrol etmesi gerekiyor.");
  if (await page.locator("#ai-chat").isHidden()) await page.locator("#ai-launcher").click();
  await page.locator("#ai-import").click();
}

test("AI suggestions require explicit field selection and do not save or change source text", async ({ page }) => {
  const requests: any[] = []; let saves = 0;
  await page.route("**/ai/analyze", route => { requests.push(route.request().postDataJSON()); return route.fulfill({ json: { analysis: proposal } }); });
  await signIn(page); await fillEntry(page);
  await page.route("**/operations/entries", route => { saves++; return route.fulfill({ status: 201, json: {} }); });
  await page.locator("#entry-unit").selectOption("ST");
  await page.locator("#ai-analyze").click();
  await expect(page.locator("#ai-result")).toBeVisible();
  await expect(page.locator("#ai-details")).toContainText(proposal.questions[0]);
  await expect(page.locator("#entry-unit")).toHaveValue("ST");
  await expect(page.locator("#entry-priority")).toHaveValue("NORMAL");
  expect(Object.keys(requests[0]).sort()).toEqual(["description", "language", "title"]);
  expect(requests[0].language).toBe("tr");
  await page.locator("#ai-use-unit").uncheck();
  await page.locator("#ai-apply").click();
  await expect(page.locator("#entry-unit")).toHaveValue("ST");
  await expect(page.locator("#entry-kind")).toHaveValue("ATTENTION");
  await expect(page.locator("#entry-priority")).toHaveValue("HIGH");
  await expect(page.locator("#entry-description")).toHaveValue(requests[0].description);
  expect(saves).toBe(0);
  await page.locator("#ai-chat-input").fill("Kontrol sonucu bekleniyor.");
  if (await page.locator("#ai-chat").isVisible()) await page.locator("#ai-chat-close").click();
  await page.locator("#entry-save").click(); await expect.poll(() => saves).toBe(1);
  await page.locator("#ai-launcher").click();
  await expect(page.locator("#ai-messages .ai-bubble-user")).toHaveCount(1);
  await expect(page.locator("#ai-chat-input")).toHaveValue("Kontrol sonucu bekleniyor.");
});

test("edits invalidate pending analysis, discard late results, and permit manual saving", async ({ page }) => {
  let release!: () => void, received!: () => void;
  const arrived = new Promise<void>(resolve => { received = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/ai/analyze", async route => { received(); await gate; await route.fulfill({ json: { analysis: proposal } }); });
  await signIn(page); await fillEntry(page);
  await page.locator("#ai-analyze").click(); await arrived;
  await page.locator("#entry-description").fill("GT2 için yeni gözlem.");
  const finished = page.waitForResponse("**/ai/analyze"); release(); await finished;
  await expect(page.locator("#ai-result")).toBeHidden();
  await expect(page.locator("#ai-status")).toContainText("yeniden analiz et");
  await expect(page.locator("#entry-unit")).toHaveValue("");
  await expect(page.locator("#entry-save")).toBeEnabled();
});

test("analysis failure preserves text and photos and manual save works when AI is disabled", async ({ page }) => {
  await page.route("**/ai/analyze", route => route.fulfill({ status: 502, json: { error: "AI_UNAVAILABLE" } }));
  await signIn(page); await fillEntry(page);
  await page.locator("#entry-photos").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from("preview-fixture") });
  await page.locator("#ai-analyze").click();
  await expect(page.locator("#ai-status")).toContainText("tamamlanamadı");
  await expect(page.locator("#entry-title")).toHaveValue("Titreşim gözlemi");
  await expect(page.locator("#photo-previews figure")).toHaveCount(1);
  await expect(page.locator("#entry-save")).toBeEnabled();
  page.on("dialog", dialog => dialog.accept());
  await page.locator("#ai-chat-close").click();
  await page.locator("#logout").click();
  await page.route("**/ai/status", route => route.fulfill({ json: { enabled: false } }));
  await page.locator("#email").fill("test@example.com"); await page.locator("#password").fill("test-password-123"); await page.locator("#login-button").click();
  await expect(page.locator("#ai-analyze")).toBeDisabled();
  await fillEntry(page);
  let saved = false;
  await page.route("**/operations/entries", route => { saved = true; return route.fulfill({ status: 201, json: {} }); });
  if (await page.locator("#ai-chat").isVisible()) await page.locator("#ai-chat-close").click();
  await page.locator("#entry-save").click();
  await expect(page.locator("#entry-title")).toHaveValue(""); expect(saved).toBe(true);
});

test("unknown fields are not applied; results render as text and dismissal keeps operator choices", async ({ page }) => {
  await page.route("**/ai/analyze", route => route.fulfill({ json: { analysis: { ...proposal, equipment: "UNKNOWN", priority: "UNKNOWN", rationale: '<img src=x onerror="window.aiXss=true">' } } }));
  await signIn(page); await fillEntry(page);
  await page.locator("#entry-unit").selectOption("GT2"); await page.locator("#entry-priority").selectOption("HIGH");
  await page.locator("#ai-analyze").click();
  await expect(page.locator("#ai-use-unit")).toBeDisabled(); await expect(page.locator("#ai-use-priority")).toBeDisabled();
  await expect(page.locator("#ai-details img")).toHaveCount(0);
  await expect(page.locator("#ai-details")).toContainText("<img src=x");
  await page.locator("#ai-dismiss").click();
  await expect(page.locator("#entry-unit")).toHaveValue("GT2"); await expect(page.locator("#entry-priority")).toHaveValue("HIGH");
});

test("bilingual AI controls fit mobile dark mode and language changes invalidate results", async ({ page }) => {
  await page.route("**/ai/analyze", route => route.fulfill({ json: { analysis: route.request().postDataJSON().language === "en" ? {
    ...proposal, rationale: "Increased vibration and a request for maintenance review were reported.", uncertainty: "No measured value or plant limit was provided.", questions: ["What was the measured vibration?"]
  } : proposal } }));
  await signIn(page); await fillEntry(page); await page.locator("#ai-analyze").click();
  await expect(page.locator("#ai-result")).toBeVisible();
  await page.locator("#dashboard [data-language]").selectOption("en");
  await expect(page.locator("#ai-result")).toBeHidden();
  await expect(page.locator("#ai-analyze")).toHaveText("Send");
  await page.locator("#dashboard [data-theme-toggle]").click();
  await page.locator("#ai-analyze").click(); await expect(page.locator("#ai-result")).toBeVisible();
  for (const width of [320,390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  const chatBounds = await page.locator("#ai-chat").boundingBox();
  expect(chatBounds!.x).toBeGreaterThanOrEqual(0);
  expect(chatBounds!.y).toBeGreaterThanOrEqual(0);
  expect(chatBounds!.y + chatBounds!.height).toBeLessThanOrEqual(844);
  await page.locator(".ai-assistant").screenshot({ path: "../ai-assistant-mobile.png" });
});

test("expired AI session clears proposals and restores the draft only after signing in", async ({ page }) => {
  await page.route("**/ai/analyze", route => route.fulfill({ status: 401, json: { error: "Unauthorized" } }));
  await signIn(page); await fillEntry(page);
  await page.locator("#ai-analyze").click();
  await expect(page.locator("#auth-view")).toBeVisible();
  await expect(page.locator("#ai-result")).toBeHidden();
  await expect(page.locator("#entry-title")).toHaveValue("");
  await page.locator("#email").fill("test@example.com"); await page.locator("#password").fill("test-password-123"); await page.locator("#login-button").click();
  await expect(page.locator("#entry-title")).toHaveValue("Titreşim gözlemi");
  await expect(page.locator("#ai-result")).toBeHidden();
  await expect(page.locator("#entry-unit")).toHaveValue("");
});

test("floating chat accepts follow-up details, preserves them on close, and requires text approval", async ({ page }) => {
  const inputs: any[] = [];
  await page.route("**/ai/analyze", route => { inputs.push(route.request().postDataJSON()); return route.fulfill({ json: { analysis: proposal } }); });
  await signIn(page);
  await expect(page.locator("#ai-chat")).toBeHidden();
  const launcher = page.locator("#ai-launcher");
  await expect(launcher).toHaveCSS("position", "fixed");
  await launcher.click(); await expect(launcher).toHaveAttribute("aria-expanded", "true");
  await page.locator("#ai-chat-input").fill("GT1 ünitesinde titreşim artışı gözlendi.");
  await page.locator("#ai-chat-input").press("Control+Enter");
  await expect(page.locator("#ai-result")).toBeVisible();
  await expect(page.locator("#entry-description")).toHaveValue("");
  await page.locator("#ai-chat-input").fill("Ölçülen değer 6 mm/s, saat 08:15.");
  await expect(page.locator("#ai-apply")).toBeDisabled();
  await page.locator("#ai-analyze").click();
  await expect(page.locator("#ai-chat-input")).toHaveValue("");
  expect(inputs[1].description).toContain("GT1 ünitesinde"); expect(inputs[1].description).toContain("6 mm/s");
  await page.locator("#ai-chat-close").click(); await launcher.click();
  await expect(page.locator("#ai-messages .ai-bubble-user")).toHaveCount(2);
  await page.locator("#ai-use-text").uncheck(); await expect(page.locator("#ai-apply")).toBeDisabled();
  await page.locator("#ai-use-text").check(); await page.locator("#ai-apply").click();
  await expect(page.locator("#entry-description")).toHaveValue(inputs[1].description);
  await expect(page.locator("#entry-priority")).toHaveValue("HIGH");
  await page.keyboard.press("Escape"); await expect(page.locator("#ai-chat")).toBeHidden(); await expect(launcher).toBeFocused();
});

test("floating launcher stays on screen and chat resets between accounts", async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const bounds = await page.locator("#ai-launcher").boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(640);
  await page.locator("#ai-launcher").click();
  await page.locator("#ai-chat-input").fill("Private draft for the first account.");
  await page.locator("#ai-chat-close").click();
  page.on("dialog", dialog => dialog.accept()); await page.locator("#logout").click();
  await expect(page.locator("#ai-launcher")).toBeHidden();
  await page.route("**/login", route => route.fulfill({ json: { token: "another-token", user: { id: 3, name: "Other", role: "WORKER" } } }));
  await page.locator("#email").fill("other@example.com"); await page.locator("#password").fill("test-password-123"); await page.locator("#login-button").click();
  await page.locator("#ai-launcher").click();
  await expect(page.locator("#ai-chat-input")).toHaveValue(""); await expect(page.locator("#ai-messages")).toBeEmpty();
});


test("API quota failures explain billing in both languages and preserve login and typed text", async ({ page }) => {
  await page.route("**/ai/analyze", route => route.fulfill({ status: 503, json: { error: "AI_QUOTA" } }));
  await signIn(page);
  await page.locator("#ai-launcher").click();
  await page.locator("#ai-chat-input").fill("GT1 titreşimi arttı.");
  await page.locator("#ai-analyze").click();
  await expect(page.locator("#ai-status")).toContainText("API bakiyesi");
  await expect(page.locator("#ai-chat-input")).toHaveValue("GT1 titreşimi arttı.");
  await expect(page.locator("#dashboard")).toBeVisible();
  await page.locator("#dashboard [data-language]").selectOption("en");
  await expect(page.locator("#ai-status")).toContainText("API credit");
  await expect(page.locator("#ai-analyze")).toBeEnabled();
});
