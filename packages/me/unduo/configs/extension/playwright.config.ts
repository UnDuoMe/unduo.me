import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "__tests__",
  // `.e2e.ts`, so plain `vp test` doesn't run these: they need Chromium and the built extension.
  testMatch: "*.e2e.ts",
  outputDir: ".output/results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
});
