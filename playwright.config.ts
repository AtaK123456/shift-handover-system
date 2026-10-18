import { defineConfig } from "@playwright/test";
if (!process.env.TEST_DATABASE_URL) throw new Error("Set TEST_DATABASE_URL to a disposable database with migrations applied.");
export default defineConfig({
  testDir: "./tests/e2e", workers: 1, timeout: 30000,
  outputDir: "test-results", reporter: "list",
  use: { baseURL: "http://127.0.0.1:3000", headless: true, launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}, trace: "retain-on-failure" },
  webServer: {
    command: "npm start", url: "http://127.0.0.1:3000/app/", reuseExistingServer: false,
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL, JWT_SECRET: "browser-test-only-secret-".repeat(3) }
  }
});
