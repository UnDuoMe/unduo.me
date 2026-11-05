import { defineConfig } from "@playwright/test";
import { realHosts } from "#site";

export default defineConfig({
  testDir: "__tests__",
  // `.e2e.ts`, so plain `vp test` doesn't run these against production.
  testMatch: "*.e2e.ts",
  outputDir: ".output/results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: ".output/report", open: "never" }]],
  use: {
    browserName: "chromium",
    headless: true,
    locale: "en-CA",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    launchOptions: {
      // Routes don't see every request: Playwright lets a redirect's next request
      // through unrouted. No other host resolves, so a gap in the mocks fails
      // here instead of reaching the real school or Duo.
      args: [
        `--host-resolver-rules=MAP * ~NOTFOUND, ${realHosts.map((host) => `EXCLUDE ${host}`).join(", ")}`,
      ],
    },
  },
});
