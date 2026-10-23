import { test, expect } from "@playwright/test";
import { registrationCode } from "./registration-code.js";

for (const language of ["tr", "en"]) {
  test(`registration gate has required private input, safe errors and an unchanged login payload (${language})`, async ({ page }) => {
    let attempts = 0, error = "Kayıt kapalı.";
    await page.route("**/register", route => { attempts++; return route.fulfill({ status: 403, json: { error } }); });
    await page.route("**/login", route => route.fulfill({ status: 401, json: { error: "Email veya şifre hatalı" } }));
    await page.goto("/app/");
    await page.locator("#auth-view [data-language]").selectOption(language);
    await expect(page.locator("#registration-code-field")).toBeHidden();
    await page.locator("#switch-auth").click();
    const code = page.getByLabel(language === "tr" ? "Kayıt kodu" : "Registration code", { exact: true });
    await expect(code).toBeVisible();
    await expect(code).toHaveAttribute("type", "password");
    await expect(code).toHaveAttribute("autocomplete", "off");
    await expect(code).toHaveAttribute("maxlength", "128");
    await expect(code).toHaveJSProperty("required", true);
    await page.locator("#name").fill("Registration Tester");
    await page.locator("#email").fill("gate@example.com");
    await page.locator("#password").fill("browser-test-password");
    await page.locator("#login-button").click();
    await expect(code).toBeFocused();
    expect(attempts).toBe(0);
    await code.fill(registrationCode);
    await page.locator("#login-button").click();
    await expect(page.locator("#auth-message")).toHaveText(language === "tr" ? "Kayıt kapalı." : "Registration is closed. Contact your team lead.");
    await expect(page.locator("#auth-view")).toBeVisible();
    error = "Kayıt yapılamadı. Bilgileri kontrol edin veya ekip sorumlusuyla iletişime geçin.";
    await page.locator("#login-button").click();
    await expect(page.locator("#auth-message")).toHaveText(language === "tr" ? error : "Unable to register. Check your details or contact your team lead.");
    expect(attempts).toBe(2);
    await expect(page.locator("#auth-message")).not.toContainText(registrationCode);
    await page.locator("#switch-auth").click();
    await expect(page.locator("#registration-code-field")).toBeHidden();
    await expect(code).toHaveValue("");
    await expect(code).toBeDisabled();
    const login = page.waitForRequest(r => r.url().endsWith("/login"));
    await page.locator("#login-button").click();
    expect((await login).postDataJSON()).toEqual({ email: "gate@example.com", password: "browser-test-password" });
    expect(await page.evaluate(value => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(item => String(item).includes(value)), registrationCode)).toBe(false);
    await page.locator("#switch-auth").click();
    await expect(code).toHaveValue("");
  });
}
