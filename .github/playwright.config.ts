import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import base from "../playwright.config.js";

const server = base.webServer;
if (!server || Array.isArray(server)) throw new Error("CI expects one application server per suite.");

export default defineConfig({
  ...base,
  // Imported config paths are resolved relative to this config's directory.
  testDir: fileURLToPath(new URL("../tests/e2e", import.meta.url)),
  outputDir: fileURLToPath(new URL("../test-results", import.meta.url)),
  // Measure settled theme colors, rather than an intermediate transition frame.
  // Keep the normal local config and the contrast assertions unchanged.
  use: { ...base.use, reducedMotion: "reduce" },
  webServer: { ...server, cwd: fileURLToPath(new URL("../", import.meta.url)) }
});
