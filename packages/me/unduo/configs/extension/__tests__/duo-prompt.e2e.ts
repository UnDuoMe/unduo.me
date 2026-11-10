/**
 * The built extension in Chromium, on a mock of Duo's Universal Prompt. Run
 * `vp run test:extension`, which builds the extension first.
 */
import { fileURLToPath } from "node:url";
import { expect, test as base } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { mockPrompt, promptUrl } from "#mock-prompt";

const extension = fileURLToPath(
  new URL("../../../../../../apps/unduo-extension/dist", import.meta.url),
);

type Fixture = { screens: string[]; focuses: { ignored: boolean }[] };

const test = base.extend<{ context: BrowserContext; page: Page }>({
  context: async ({ playwright }, use) => {
    const context = await playwright.chromium.launchPersistentContext("", {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        // Nothing resolves, so a request the mock misses fails instead of leaving the machine.
        "--host-resolver-rules=MAP * ~NOTFOUND",
      ],
    });
    await context.route("**/*", mockPrompt);
    await use(context);
    await context.close();
  },
  page: async ({ context }, use) => {
    await use(context.pages()[0] ?? (await context.newPage()));
  },
});

const fixture = (page: Page) =>
  page.evaluate(() => (window as unknown as { fixture: Fixture }).fixture);
const passcode = (page: Page) => page.locator("#passcode-input");

async function expectFillable(page: Page) {
  const input = passcode(page);
  await expect(input).toHaveAttribute("autocomplete", "one-time-code");
  await expect(input).not.toHaveAttribute("data-1p-ignore");
  await expect(input).not.toHaveAttribute("data-lpignore");
  await expect(input).toBeFocused();
  // 1Password looks at a field when it gets focus, so the last focus must find it fillable.
  await expect.poll(async () => (await fixture(page)).focuses.at(-1)?.ignored).toBe(false);
}

test("goes from Duo's push to the Duo Mobile passcode and lets 1Password fill it", async ({
  page,
}) => {
  await page.goto(promptUrl());
  await expect(page.getByRole("heading", { name: "Enter your passcode" })).toBeVisible();
  expect((await fixture(page)).screens).toEqual(["push", "methods", "passcode"]);
  await expectFillable(page);
});

test("only fixes the field when Duo opens on the passcode", async ({ page }) => {
  await page.goto(promptUrl({ first: "passcode" }));
  await expectFillable(page);
  expect((await fixture(page)).screens).toEqual(["passcode"]);
});

test("fixes the field again when Duo swaps it for a new one", async ({ page }) => {
  await page.goto(promptUrl({ first: "passcode" }));
  await expectFillable(page);
  await page.evaluate(() =>
    (window as unknown as { fixture: { remountPasscode(): void } }).fixture.remountPasscode(),
  );
  await expectFillable(page);
});

test("leaves the method list to you after you click Other options", async ({ page }) => {
  await page.goto(promptUrl());
  await expectFillable(page);
  await page.getByRole("button", { name: "Other options" }).click();
  await expect(page.getByText("Duo Mobile passcode")).toBeVisible();
  // Longer than the 160 ms the rows take, so a click from the extension would have happened.
  await page.waitForTimeout(1_000);
  await expect(page.getByRole("heading", { name: "Other options to log in" })).toBeVisible();
  expect((await fixture(page)).screens).toEqual(["push", "methods", "passcode", "methods"]);
});

test("stays on the method list when it has no Duo Mobile passcode", async ({ page }) => {
  await page.goto(promptUrl({ duoMobile: false }));
  await expect(page.getByText("Bypass code")).toBeVisible();
  await page.waitForTimeout(1_000);
  expect((await fixture(page)).screens).toEqual(["push", "methods"]);
});
