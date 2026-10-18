import { test, expect } from "@playwright/test";

test("system preference follows changes until user selects a persistent theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/app/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Koyu moda geç", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Hesap oluştur", exact: true }).click();
  await expect(page.getByLabel("Ad soyad")).toBeVisible();
  await page.getByLabel("Şifre", { exact: true }).fill("sample-password-123");
  await page.getByRole("button", { name: "Şifreyi göster", exact: true }).click();
  await expect(page.locator("#password")).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Açık moda geç", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await page.locator("#password").inputValue()).toBe("sample-password-123");
});

test("storage restrictions do not break theme selection or authentication form", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Storage unavailable", "SecurityError"); } });
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/app/");
  await page.getByRole("button", { name: "Açık moda geç", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Hesap oluştur", exact: true }).click();
  await expect(page.getByLabel("Ad soyad")).toBeVisible();
  expect(errors).toEqual([]);
});

test("theme is shared by login/dashboard/logout, and mobile controls fit", async ({ page }) => {
  await page.route("**/login", route => route.fulfill({ json: { token: "ui-test-token", user: { id: 1, name: "Deniz Yılmaz", email: "test@example.com", role: "MANAGER" } } }));
  await page.route("**/shifts/current", route => route.fulfill({ json: { currentShift: null } }));
  await page.route(/\/shifts\?/, route => route.fulfill({ json: { items: [{ id: 1, user: { id: 1, name: "Deniz Yılmaz" }, startTime: "2026-10-19T05:00:00Z", endTime: "2026-10-19T13:00:00Z", status: "COMPLETED" }], total: 1, page: 1, pageSize: 20 } }));
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/app/");
  await page.getByRole("button", { name: "Koyu moda geç", exact: true }).click();
  await page.getByLabel("E-posta adresi").fill("test@example.com");
  await page.getByLabel("Şifre", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: /Giriş yap/ }).click();
  await expect(page.locator("#shift-rows tr")).toHaveCount(1);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Açık moda geç", exact: true })).toBeVisible();
  await page.screenshot({ path: "../dark-mode-desktop.png", fullPage: true });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole("button", { name: "Açık moda geç", exact: true })).toBeVisible();
  }
  await page.screenshot({ path: "../dark-mode-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Açık moda geç", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Çıkış yap", exact: true }).click();
  await expect(page.getByRole("button", { name: "Koyu moda geç", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
