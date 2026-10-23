import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../src/database.js";
import { hashPassword } from "../../src/password.js";
import { navigate } from "./navigation.js";

test("stored markup stays inert across observation, details, updates and handover; logout clears private UI", async ({ page }) => {
  const db = createPrismaClient(process.env.TEST_DATABASE_URL);
  const email = `${randomUUID()}@example.invalid`, password = "browser-security-test-password";
  const markup = '<img data-assessment-xss src=x onerror="window.__assessmentXss=1">';
  const user = await db.user.create({ data: { email, name: markup, password: await hashPassword(password) } });
  const dialogs: string[] = [];
  page.on("dialog", dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
  try {
    await page.goto("/app/");
    await page.locator("#email").fill(email); await page.locator("#password").fill(password);
    const loginResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/login" && response.request().method() === "POST");
    await page.locator("#login-button").click();
    const { token } = await (await loginResponse).json();
    await expect(page.locator("#dashboard")).toBeVisible();
    await expect(page.locator("#account-name")).toHaveText(markup);
    const headers = { Authorization: `Bearer ${token}` };
    const response = await page.request.post("/operations/entries", { headers, data: {
      kind: "TASK", priority: "HIGH", title: markup, description: markup, responsibleTeam: markup, nextStep: markup
    } });
    expect(response.status()).toBe(201);
    const entry = await response.json();
    const update = await page.request.post(`/operations/entries/${entry.id}/updates`, { headers, data: { body: markup, requestId: randomUUID() } });
    expect(update.status()).toBe(201);
    await page.locator("#overview-refresh").click();
    const card = page.locator("#overview-important .observation-card").filter({ hasText: markup });
    await expect(card).toHaveCount(1); await card.click();
    await expect(page.locator("#overview-detail-description")).toHaveText(markup);
    await expect(page.locator("#overview-detail-work-summary")).toContainText(markup);
    await page.locator("#overview-detail-updates").click();
    await expect(page.locator("#updates-list")).toContainText(markup);
    await page.locator("#updates-close").click();
    await navigate(page, "handover");
    await expect(page.locator("#board-entries")).toContainText(markup);
    await expect(page.locator("[data-assessment-xss]")).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__assessmentXss)).toBeUndefined(); expect(dialogs).toEqual([]);
    const persisted = await page.evaluate(value => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(item => item.includes(value)), token);
    expect(persisted).toBe(false);
    await page.locator("#logout").click(); await expect(page.locator("#auth-view")).toBeVisible();
    await expect(page.locator("#account-name")).toBeEmpty(); await expect(page.locator("#overview-important")).not.toContainText(markup);
    await expect(page.locator("#overview-important .observation-card")).toHaveCount(0);
    await expect(page.locator("#board-entries")).toBeEmpty(); await expect(page.locator("#overview-detail-description")).toBeEmpty();
    // Observation only: do not codify acceptance of a stolen token as a desired
    // security guarantee. This attachment can also record a future 401 after revocation.
    const replay = await page.request.get("/shifts/current", { headers });
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    const observation = { replayAfterBrowserLogout: replay.status(), tokenLifetimeSeconds: payload.exp - payload.iat };
    await test.info().attach("session-revocation-observation", { body: JSON.stringify(observation), contentType: "application/json" });
    console.info("Session assessment (no token included):", JSON.stringify(observation));
  } finally {
    await db.operationEntry.deleteMany({ where: { authorId: user.id } });
    await db.user.delete({ where: { id: user.id } });
    await db.$disconnect();
  }
});
