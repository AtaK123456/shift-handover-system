import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { navigate } from "./navigation.js";

const summary = { equipment: [], counts: { total: 0, important: 0, VALVE: 0, ATTENTION: 0, TASK: 0 }, openItems: [], important: [], recent: [], activeShiftId: null, receipt: null, revision: 1 };
async function setup(page: Page) {
  let account = 0;
  await page.route("**/login", route => route.fulfill({ json: { token: `feedback-${++account}`, user: { id: account, name: "Test Operator", role: "WORKER" } } }));
  await page.route("**/ai/status", route => route.fulfill({ json: { enabled: false } }));
  await page.route("**/shifts/current", route => route.fulfill({ json: { currentShift: null } }));
  await page.route(/\/shifts\?/, route => route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } }));
  await page.route("**/operations/**", route => route.fulfill({ json: route.request().url().endsWith("/summary") ? summary : { items: [], total: 0, page: 1, pageSize: 20 } }));
  await page.goto("/app/");
  await login(page);
}
async function login(page: Page) {
  await page.locator("#email").fill("feedback@example.com");
  await page.locator("#password").fill("feedback-test-password");
  await page.locator("#login-button").click();
  await expect(page.locator("#connection-status")).toHaveAttribute("data-state", "online");
}

for (const language of ["tr", "en"]) test(`inline validation retains native focus, hints and inputs (${language})`, async ({ page }) => {
  let submissions = 0;
  await page.route("**/register", route => { submissions++; return route.fulfill({ status: 403, json: { error: "Kayıt kapalı." } }); });
  await page.goto("/app/");
  await page.locator("#auth-view [data-language]").selectOption(language);
  await page.locator("#switch-auth").click();
  await page.locator("#name").fill("Test Operator"); await page.locator("#email").fill("invalid");
  await page.locator("#password").fill("short"); await page.locator("#login-button").click();
  await expect(page.locator("#email")).toBeFocused();
  await expect(page.locator("#email-error")).toHaveText(language === "tr" ? "Geçerli bir e-posta adresi gir." : "Enter a valid email address.");
  await expect(page.locator("#password-error")).toContainText("12");
  await expect(page.locator("#registration-code")).toHaveAttribute("aria-describedby", "registration-code-hint registration-code-error");
  expect(submissions).toBe(0);
  await page.locator("#email").fill("feedback@example.com"); await page.locator("#password").fill("feedback-test-password");
  await expect(page.locator("#email-error")).toHaveCount(0);
  await expect(page.locator("#email")).not.toHaveAttribute("aria-invalid");
  await page.locator("#login-button").click(); await expect(page.locator("#registration-code")).toBeFocused();
  await page.locator("#switch-auth").click();
  await expect(page.locator(".field-error")).toHaveCount(0);
  await expect(page.locator("#registration-code")).toHaveAttribute("aria-describedby", "registration-code-hint");
  await expect(page.locator("#email")).toHaveValue("feedback@example.com");
});

test("new-entry feedback preserves drafts on failure and uploads a smaller real photo on retry", async ({ page }) => {
  await setup(page); await navigate(page, "new-record");
  let attempts = 0, uploaded: Buffer | undefined;
  await page.route("**/operations/entries", async route => {
    attempts++;
    if (attempts === 1) return route.abort("failed");
    const request = route.request(), body = request.postDataBuffer()!;
    const boundary = request.headers()["content-type"]!.split("boundary=")[1]!;
    const start = body.indexOf('filename="camera.jpg"');
    expect(start).toBeGreaterThan(0);
    const contentStart = body.indexOf("\r\n\r\n", start) + 4;
    uploaded = body.subarray(contentStart, body.indexOf(`\r\n--${boundary}`, contentStart));
    return route.fulfill({ status: 201, json: { id: 9 } });
  });
  await page.locator("#entry-save").click();
  await expect(page.locator("#entry-title")).toBeFocused(); await expect(page.locator("#entry-title-error")).toBeVisible();
  expect(attempts).toBe(0);
  await page.locator("#entry-title").fill("GT1 kontrol sonucu"); await page.locator("#entry-description").fill("Kontrol bilgisi taslakta kalmalı.");
  await expect(page.locator(".field-error")).toHaveCount(0);
  const original = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: "#5079a9" } }).jpeg({ quality: 95 }).toBuffer();
  await page.locator("#entry-photos").setInputFiles({ name: "camera.jpg", mimeType: "image/jpeg", buffer: original });
  await page.locator("#entry-save").click();
  await expect(page.locator("#entry-message")).toHaveClass(/error/);
  await expect(page.locator("#entry-title")).toHaveValue("GT1 kontrol sonucu");
  await expect(page.locator("#photo-previews figure")).toHaveCount(1);
  await expect(page.locator("#entry-save")).toBeEnabled();
  await page.locator("#entry-save").click();
  await expect(page.locator("#entry-message")).toContainText("Kayıt eklendi.");
  expect(attempts).toBe(2); expect(uploaded).toBeDefined(); expect(uploaded!.length).toBeLessThan(original.length);
  const metadata = await sharp(uploaded!).metadata();
  expect(metadata.width).toBe(1600); expect(metadata.height).toBe(1200);
  await expect(page.locator("#entry-title")).toHaveValue(""); await expect(page.locator("#photo-previews figure")).toHaveCount(0);
});

test("connection warnings survive other successful requests, translate and recover without submitting drafts", async ({ page, context }) => {
  await setup(page);
  let writes = 0;
  page.on("request", request => { if (request.method() !== "GET") writes++; });
  await page.route("**/operations/summary", route => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await page.locator("#overview-refresh").click();
  await expect(page.locator("#connection-status")).toHaveAttribute("data-state", "warning");
  await expect(page.locator("#connection-time")).toContainText("Son sunucu yanıtı");
  await page.locator("#dashboard [data-language]").selectOption("en");
  await expect(page.locator("#connection-label")).toContainText("Data may be outdated");
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.route("**/operations/summary", route => route.fulfill({ json: summary }));
  await page.locator("#connection-retry").click();
  await expect(page.locator("#connection-status")).toHaveAttribute("data-state", "online");
  for (const name of ["handover", "history", "new-record"]) {
    await navigate(page, name); await expect(page.locator("#connection-status")).toBeVisible();
  }
  await page.locator("#entry-title").fill("Do not send automatically");
  await context.setOffline(true);
  await expect(page.locator("#connection-status")).toHaveAttribute("data-state", "offline");
  await expect(page.locator("#connection-retry")).toBeDisabled();
  await context.setOffline(false);
  await expect(page.locator("#connection-status")).toHaveAttribute("data-state", "online");
  await expect(page.locator("#entry-title")).toHaveValue("Do not send automatically"); expect(writes).toBe(0);
});

test("photo optimization keeps small and damaged files, preserves alpha and falls back without bitmap support", async ({ page }) => {
  await page.goto("/app/");
  const results = await page.evaluate(async () => {
    // @ts-expect-error Browser-served module is outside the TypeScript source tree.
    const { preparePhoto } = await import("/app/photo-upload.js");
    const damaged = new File(["damaged"], "broken.jpg", { type: "image/jpeg" });
    const brokenKept = await preparePhoto(damaged) === damaged;
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 2000;
    const context = canvas.getContext("2d")!; context.fillStyle = "rgba(100,150,200,0.5)"; context.fillRect(0, 0, 2000, 2000);
    const original = new File([await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), "image/png"))], "transparent.png", { type: "image/png" });
    const resized = await preparePhoto(original), bitmap = await createImageBitmap(resized);
    canvas.width = bitmap.width; canvas.height = bitmap.height; context.drawImage(bitmap, 0, 0);
    const alpha = context.getImageData(0, 0, 1, 1).data[3]; bitmap.close();
    const small = new File([await new Promise<Blob>(resolve => { canvas.width = canvas.height = 20; canvas.toBlob(blob => resolve(blob!), "image/png"); })], "small.png", { type: "image/png" });
    const smallKept = await preparePhoto(small) === small;
    const originalBitmap = window.createImageBitmap;
    Object.defineProperty(window, "createImageBitmap", { configurable: true, value: undefined });
    const unsupportedKept = await preparePhoto(original) === original;
    Object.defineProperty(window, "createImageBitmap", { configurable: true, value: originalBitmap });
    return { brokenKept, smallKept, unsupportedKept, width: canvas.width, resizedBytes: resized.size, originalBytes: original.size, alpha };
  });
  expect(results.brokenKept && results.smallKept && results.unsupportedKept).toBe(true);
  expect(results.resizedBytes).toBeLessThan(results.originalBytes); expect(results.alpha).toBeGreaterThan(120); expect(results.alpha).toBeLessThan(135);
});

test("logging out during image preparation cannot send or clear another account's draft", async ({ page }) => {
  await setup(page); await navigate(page, "new-record");
  let writes = 0; await page.route("**/operations/entries", route => { writes++; return route.fulfill({ status: 201, json: {} }); });
  await page.evaluate(() => {
    const original = window.createImageBitmap;
    const encode = HTMLCanvasElement.prototype.toBlob;
    (window as any).photoEncoded = new Promise(resolve => {
      HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
        return encode.call(this, blob => { callback(blob); resolve(true); }, ...args);
      };
    });
    window.createImageBitmap = (...args: Parameters<typeof createImageBitmap>) => new Promise(resolve => {
      (window as any).releasePhotoPreparation = async () => resolve(await (original as any)(...args));
    });
  });
  const buffer = await sharp({ create: { width: 1800, height: 1200, channels: 3, background: "#5079a9" } }).jpeg().toBuffer();
  await page.locator("#entry-title").fill("Old account draft"); await page.locator("#entry-description").fill("Must not be sent");
  await page.locator("#entry-photos").setInputFiles({ name: "old.jpg", mimeType: "image/jpeg", buffer });
  await page.locator("#entry-save").click(); await expect(page.locator("#entry-message")).toContainText("hazırlanıyor");
  page.once("dialog", dialog => dialog.accept()); await page.locator("#logout").click();
  await login(page); await navigate(page, "new-record");
  await page.locator("#entry-title").fill("New account draft");
  await page.evaluate(async () => {
    await (window as any).releasePhotoPreparation();
    await (window as any).photoEncoded;
    await new Promise(resolve => requestAnimationFrame(resolve));
  });
  await expect(page.locator("#entry-title")).toHaveValue("New account draft");
  await expect(page.locator("#entry-save")).toBeEnabled(); await expect(page.locator("#photo-previews figure")).toHaveCount(0);
  expect(writes).toBe(0);
});
