import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { createPrismaClient } from "../../src/database.js";
import { hashPassword } from "../../src/password.js";
import { navigate } from "./navigation.js";
const db = createPrismaClient(process.env.TEST_DATABASE_URL), suffix = randomUUID(), password = "work-tracking-browser-password";
const emails = [`work-a-${suffix}@example.com`, `work-b-${suffix}@example.com`], users: number[] = [], entries: number[] = [];
test.setTimeout(90_000);
test.beforeAll(async () => {
  const hash = await hashPassword(password);
  for (let i=0; i<2; i++) users.push((await db.user.create({ data: { name: i ? "Ece Kaya" : "Deniz Yılmaz", email: emails[i]!, password: hash } })).id);
});
test.afterAll(async () => {
  await db.operationEntry.deleteMany({ where: { id: { in: entries } } });
  await db.user.deleteMany({ where: { id: { in: users } } }); await db.$disconnect();
});
async function entry() {
  const item = await db.operationEntry.create({ data: { authorId: users[0]!, kind: "TASK", title: `GT1 work ${randomUUID()}`, description: "Original inspection request", equipmentCode: "GT1", priority: "HIGH" } });
  entries.push(item.id); return item;
}
async function login(page: Page, who=0) {
  await page.locator("#email").fill(emails[who]!); await page.locator("#password").fill(password); await page.locator("#login-button").click();
  await expect(page.locator("#dashboard")).toBeVisible(); await expect(page.locator("#login-button")).toBeEnabled();
}
async function openWork(page: Page, id: number) {
  await navigate(page, "handover"); await page.locator(`[data-work-for="${id}"]`).click();
  await expect(page.locator("#work-save")).toBeVisible(); await expect(page.locator("#work-save")).toBeEnabled();
}
const auth = () => ({ Authorization: `Bearer ${jwt.sign({ id: users[1] }, "browser-test-only-secret-".repeat(3), { expiresIn: "1h" })}` });

test("creation, work updates, read-only overview and closed history preserve tracking details", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/app/"); await login(page); await navigate(page, "new-record");
  await expect(page.locator("#entry-work-fields")).toBeHidden();
  await page.locator("#entry-kind").selectOption("TASK"); await expect(page.locator("#entry-work-fields")).toBeVisible();
  const title = `New tracked work ${suffix}`;
  await page.locator("#entry-title").fill(title); await page.locator("#entry-description").fill("Check GT1 bearing");
  await page.locator("#entry-unit").selectOption("GT1"); await page.locator("#entry-work-status").selectOption("WAITING");
  await page.locator("#entry-work-team").fill("Mekanik bakım"); await page.locator("#entry-work-next").fill("Parça beklenecek");
  await page.locator("#entry-save").click(); await expect(page.locator("#entry-title")).toHaveValue("");
  const item = await db.operationEntry.findFirstOrThrow({ where: { title, authorId: users[0]! } }); entries.push(item.id);
  expect(item.workStatus).toBe("WAITING"); expect(item.responsibleTeam).toBe("Mekanik bakım");
  await openWork(page, item.id); await expect(page.locator("#work-status")).toHaveValue("WAITING");
  await page.locator("#work-status").selectOption("IN_PROGRESS"); await page.locator("#work-next").fill("Ölçüm sonucu değerlendirilecek"); await page.locator("#work-save").click();
  await expect(page.locator("#work-message")).toHaveText("İş takibi kaydedildi.");
  await expect(page.locator("#work-history")).toContainText("Deniz Yılmaz"); await expect(page.locator("#work-history")).toContainText("İşlemde");
  await page.locator("#work-close").click(); await navigate(page, "overview");
  await expect(page.locator(`#overview-important [data-entry-id="${item.id}"]`)).toContainText("Ölçüm sonucu değerlendirilecek");
  await expect(page.locator("#changes-list")).toContainText("İş takibi güncellendi");
  await page.locator('#changes-list [data-change-type="WORK_DETAILS"]').click();
  await expect(page.locator("#overview-detail-description")).toContainText("Ölçüm sonucu değerlendirilecek");
  await page.keyboard.press("Escape");
  await page.locator(`#overview-important [data-entry-id="${item.id}"]`).click(); await page.locator("#overview-detail-work").click();
  await expect(page.locator("#work-team")).toHaveValue("Mekanik bakım"); await expect(page.locator("#work-save")).toBeHidden(); await expect(page.locator("#work-team")).toHaveAttribute("readonly", "");
  await page.locator("#work-close").click(); await navigate(page, "handover");
  await page.locator("#board-entries article").filter({ hasText: title }).getByRole("button", { name: "Kaydı kapat", exact: true }).click();
  await page.locator("#close-note").fill("İş tamamlandı"); await page.locator("#close-save").click(); await expect(page.locator("#close-dialog")).toBeHidden();
  await navigate(page, "history"); await page.locator(`[data-work-for="${item.id}"]`).click();
  await expect(page.locator("#work-status")).toHaveValue("CLOSED"); await expect(page.locator("#work-save")).toBeHidden();
  await expect(page.locator("#work-next")).toHaveValue("Ölçüm sonucu değerlendirilecek"); await expect(page.locator("#work-history")).toContainText("Parça beklenecek");
  await page.locator("#work-close").click(); expect(errors).toEqual([]);
});

test("lost responses retry without duplication; concurrent edits and closure retain unsent drafts", async ({ page }) => {
  const item = await entry(), errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/app/"); await login(page); await openWork(page, item.id);
  await page.route(`**/operations/entries/${item.id}/work`, async route => { await route.fetch(); await route.abort("failed"); }, { times: 1 });
  await page.locator("#work-team").fill("Mechanical"); await page.locator("#work-next").fill("Inspect bearing"); await page.locator("#work-save").click();
  await expect(page.locator("#work-message")).toHaveClass(/error/); await expect(page.locator("#work-next")).toHaveValue("Inspect bearing");
  await expect.poll(() => db.workDetailChange.count({ where: { entryId: item.id } })).toBe(1);
  await page.locator("#work-save").click(); await expect(page.locator("#work-message")).toHaveText("İş takibi kaydedildi.");
  expect(await db.workDetailChange.count({ where: { entryId: item.id } })).toBe(1);
  const other = await page.request.patch(`/operations/entries/${item.id}/work`, { headers: auth(), data: { version: 1, workStatus: "WAITING", responsibleTeam: "Electrical", nextStep: "Await power check" } }); expect(other.status()).toBe(200);
  await page.locator("#work-next").fill("My stale next step"); await page.locator("#work-save").click();
  await expect(page.locator("#work-message")).toContainText("Başka biri"); await expect(page.locator("#work-next")).toHaveValue("My stale next step");
  page.once("dialog", d => d.dismiss()); await page.locator("#work-reload").click(); await expect(page.locator("#work-next")).toHaveValue("My stale next step");
  page.once("dialog", d => d.accept()); await page.locator("#work-reload").click(); await expect(page.locator("#work-next")).toHaveValue("Await power check");
  await page.locator("#work-next").fill("Draft after reload");
  const closed = await page.request.post(`/operations/entries/${item.id}/close`, { headers: auth(), data: { closeNote: "Completed by next shift" } }); expect(closed.status()).toBe(200);
  await page.locator("#work-save").click(); await expect(page.locator("#work-message")).toContainText("Kayıt kapatılmış");
  await expect(page.locator("#work-save")).toBeHidden(); await expect(page.locator("#work-draft")).toBeVisible(); await expect(page.locator("#work-next")).toHaveValue("Draft after reload");
  expect(await db.workDetailChange.count({ where: { entryId: item.id } })).toBe(2); expect(errors).toEqual([]);
});

test("tracking drafts survive expiry only for the same account and are cleared on explicit logout", async ({ page }) => {
  const item = await entry(); await page.goto("/app/"); await login(page); await openWork(page, item.id);
  await page.locator("#work-team").fill("Unsent team"); await page.locator("#work-close").click(); await openWork(page, item.id);
  await expect(page.locator("#work-team")).toHaveValue("Unsent team");
  await page.route(`**/operations/entries/${item.id}/work`, r => r.fulfill({ status: 401, json: { error: "Expired" } }), { times: 1 });
  await page.locator("#work-save").click(); await expect(page.locator("#auth-view")).toBeVisible();
  await login(page); await openWork(page, item.id); await expect(page.locator("#work-team")).toHaveValue("Unsent team");
  await page.locator("#work-close").click(); page.once("dialog", d => d.dismiss()); await page.locator("#logout").click(); await expect(page.locator("#dashboard")).toBeVisible();
  page.once("dialog", d => d.accept()); await page.locator("#logout").click(); await login(page, 1); await openWork(page, item.id);
  await expect(page.locator("#work-team")).toHaveValue("");
  await page.locator("#work-team").fill("Different account draft");
  await page.route(`**/operations/entries/${item.id}/work`, r => r.fulfill({ status: 401, json: { error: "Expired" } }), { times: 1 });
  await page.locator("#work-save").click(); await expect(page.locator("#auth-view")).toBeVisible();
  await login(page, 0); await openWork(page, item.id); await expect(page.locator("#work-team")).toHaveValue("");
});

test("tracking history pagination retains drafts, renders text safely and fits both themes on mobile", async ({ page }) => {
  const item = await entry();
  await db.workDetailChange.createMany({ data: Array.from({ length: 23 }, (_,i) => ({ entryId: item.id, authorId: users[0]!, version: i+1, workStatus: "WAITING" as const, responsibleTeam: "<img src=x onerror=alert(1)>", nextStep: `History step ${i+1}` })) });
  await page.goto("/app/"); await login(page); await openWork(page, item.id);
  await expect(page.locator("#work-history li")).toHaveCount(20); await expect(page.locator("#work-history img")).toHaveCount(0);
  await page.locator("#work-next").fill("Unsent next step"); await page.locator("#work-next-page").click();
  await expect(page.locator("#work-history li")).toHaveCount(3); await expect(page.locator("#work-next")).toHaveValue("Unsent next step");
  await page.locator("#work-previous").click(); await expect(page.locator("#work-history li")).toHaveCount(20);
  await page.locator("#work-close").click(); await page.locator("#dashboard [data-language]").selectOption("en"); await openWork(page, item.id);
  await expect(page.locator("#work-title")).toContainText("Work tracking"); await expect(page.locator("#work-next")).toHaveValue("Unsent next step");
  for (const theme of ["light", "dark"]) {
    await page.locator("#work-close").click();
    if (await page.locator("html").getAttribute("data-theme") !== theme) await page.locator("#dashboard [data-theme-toggle]").click();
    await openWork(page, item.id);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator("#work-dialog").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
  }
  await page.screenshot({ path: "../work-tracking-mobile.png", fullPage: true });
});
