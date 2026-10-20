import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../src/database.js";
import { hashPassword } from "../../src/password.js";
import { navigate } from "./navigation.js";
test.setTimeout(90_000);
const db = createPrismaClient(process.env.TEST_DATABASE_URL), suffix = randomUUID().slice(0,8), code = `AREA-${suffix.toUpperCase()}`;
const password = "catalog-browser-password", users: number[] = [];
const emails = [`catalog-manager-${suffix}@example.com`, `catalog-worker-${suffix}@example.com`];
test.beforeAll(async () => {
  const hash = await hashPassword(password);
  for (const [index, email] of emails.entries()) users.push((await db.user.create({ data: { email, name: "Catalog Tester", password: hash, role: index ? "WORKER" : "MANAGER" } })).id);
});
test.afterAll(async () => {
  await db.operationEntry.deleteMany({ where: { authorId: { in: users } } });
  await db.equipmentChange.deleteMany({ where: { userId: { in: users } } });
  await db.equipment.deleteMany({ where: { code } });
  await db.user.deleteMany({ where: { id: { in: users } } }); await db.$disconnect();
});
async function login(page: Page, index = 0) {
  await page.goto("/app/"); await page.locator("#email").fill(emails[index]!); await page.locator("#password").fill(password); await page.locator("#login-button").click();
  await expect(page.locator("#dashboard")).toBeVisible(); await navigate(page, "handover");
  await expect(page.locator("#equipment-grid .equipment-card")).toHaveCount(index ? 4 : 3);
}

test("manager defines a work area, duplicate errors retain inputs, and renamed areas keep draft and historical links", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await login(page);
  await page.locator("#catalog-add").click(); await page.locator("#catalog-code").fill(code.toLowerCase()); await page.locator("#catalog-name").fill("Depot A");
  await expect(page.locator("#catalog-code")).toHaveValue(code); await page.locator("#catalog-save").click();
  const card = page.locator("#equipment-grid .equipment-card").filter({ hasText: code });
  await expect(card).toContainText("Depot A");
  await page.locator("#catalog-add").click(); await page.locator("#catalog-code").fill(code); await page.locator("#catalog-name").fill("Duplicate name"); await page.locator("#catalog-save").click();
  await expect(page.locator("#catalog-message")).toContainText("zaten var"); await expect(page.locator("#catalog-name")).toHaveValue("Duplicate name");
  await page.locator('[data-close="catalog-dialog"]').click();
  await navigate(page, "new-record"); await page.locator("#entry-unit").selectOption(code); await page.locator("#entry-kind").selectOption("NOTE");
  await page.locator("#entry-title").fill(`Area record ${suffix}`); await page.locator("#entry-description").fill("Keep the reference after renaming."); await page.locator("#entry-save").click();
  await expect(page.locator("#entry-title")).toHaveValue("");
  await page.locator("#entry-unit").selectOption(code); await page.locator("#entry-title").fill("Preserved draft"); await page.locator("#entry-description").fill("Unsaved work.");
  await page.locator("#entry-photos").setInputFiles({ name: "preview.png", mimeType: "image/png", buffer: Buffer.from("preview") });
  await navigate(page, "handover"); await card.getByRole("button", { name: "Adı düzenle", exact: true }).click();
  await expect(page.locator("#catalog-code")).toHaveAttribute("readonly", ""); await page.locator("#catalog-name").fill("Warehouse A"); await page.locator("#catalog-save").click();
  await expect(card).toContainText("Warehouse A"); await navigate(page, "new-record");
  await expect(page.locator("#entry-unit")).toHaveValue(code); await expect(page.locator("#entry-title")).toHaveValue("Preserved draft"); await expect(page.locator("#photo-previews figure")).toHaveCount(1);
  await expect(page.locator(`#entry-unit option[value="${code}"]`)).toContainText("Warehouse A");
  await navigate(page, "history"); await page.locator("#operations-unit").selectOption(code); await page.locator("#operations-q").fill(`Area record ${suffix}`); await page.locator('#operations-filter button[type="submit"]').click();
  await expect(page.locator("#operation-entries .entry-card")).toHaveCount(1); await expect(page.locator("#operation-entries")).toContainText("Warehouse A");
  await page.locator("#dashboard [data-language]").selectOption("en");
  await navigate(page, "handover"); await expect(page.locator("#catalog-add")).toHaveText("Add equipment / area");
  await page.setViewportSize({ width: 320, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await card.getByRole("button", { name: "Edit name", exact: true }).click();
  await page.locator("#catalog-name").fill('<img src=x onerror="window.catalogXss=true">'); await page.locator("#catalog-save").click();
  await expect(card.locator(".equipment-name")).toHaveText('<img src=x onerror="window.catalogXss=true">'); await expect(card.locator("img")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).catalogXss)).toBeUndefined(); expect(errors).toEqual([]);
});

test("worker can record custom work-area status but cannot administer definitions", async ({ page }) => {
  await login(page, 1); await expect(page.locator("#catalog-add")).toBeHidden(); await expect(page.locator(".catalog-rename")).toHaveCount(0);
  const card = page.locator("#equipment-grid .equipment-card").filter({ hasText: code });
  await card.getByRole("button", { name: "Güncelle", exact: true }).click(); await page.locator("#equipment-status").selectOption("ACTIVE"); await page.locator("#equipment-note").fill("Area ready for review"); await page.locator("#equipment-save").click();
  await expect(card.getByText("Devrede", { exact: true })).toBeVisible(); await navigate(page, "overview");
  await expect(page.locator("#overview-equipment")).toContainText("Area ready for review");
});
