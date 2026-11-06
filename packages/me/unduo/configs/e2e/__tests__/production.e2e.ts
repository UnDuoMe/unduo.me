/**
 * A student's whole path on the live site, from a browser with nothing in it:
 * unduo.me's home page, the downloaded file, and a passcode that signs in.
 *
 * unduo.me and jsDelivr are real. The school's sign-in, Duo and the AI assistants
 * are mocks at their real host names, and any other request is refused, so this
 * never touches a real Duo account. Where the pages name what to click, the test
 * reads the name from the page, so it fails if an instruction stops matching.
 */
import { createPublicKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { expect, test as base } from "@playwright/test";
import type { BrowserContext, FrameLocator, Locator, Page } from "@playwright/test";
import { hotp, readOtpauth, totp } from "#authenticator";
import { copyImage, copyText, dropFile, pastedText, scanQrCode } from "#browser-actions";
import { mockAssistant } from "#mock-assistant";
import { duoHost, mockDuo, portalHost, signInHost, student } from "#mock-duo";
import { guardNetwork } from "#network-guard";
import { realHosts, site } from "#site";

const school = "University of Toronto";
const fileName = `UnDuo - ${school}.html`;
const portalUrl = `https://${portalHost}/`;
const assistants = {
  "chatgpt.com": "ChatGPT",
  "claude.ai": "Claude",
  "gemini.google.com": "Gemini",
};

const test = base.extend<{
  world: {
    duo: ReturnType<typeof mockDuo>;
    assistant: ReturnType<typeof mockAssistant>;
    network: Awaited<ReturnType<typeof guardNetwork>>;
  };
}>({
  // Automatic, so no test's browser runs without the guard and the mocks.
  world: [
    async ({ context }, use) => {
      const duo = mockDuo();
      const assistant = mockAssistant();
      const network = await guardNetwork(context, realHosts, {
        ...duo.routes,
        ...Object.fromEntries(Object.keys(assistants).map((host) => [host, assistant.respond])),
      });
      // A real browser lets the tab in front write to the clipboard after a click;
      // headless Chromium asks for a permission no one is there to give.
      await context.grantPermissions(["clipboard-write"]);
      await use({ duo, assistant, network });
      expect(network.refused, "Requests to hosts the page has no reason to reach").toEqual([]);
    },
    { auto: true },
  ],
});

const stepTitle = (page: Page) => page.locator("#step-title");

/** Runs an instruction, with a screenshot of where it ended in the test's report. */
async function instruction(name: string, page: Page, run: () => Promise<void>) {
  await test.step(name, async () => {
    await run();
    await test.info().attach(name, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });
}

/** The words a list of instructions puts in italics: the names of what to choose. */
const namesIn = async (instructions: Locator) =>
  (await instructions.locator("em").allTextContents()).map((name) => name.trim());

/** The home page's download link, from its direct link, as a fresh browser saves it. */
async function downloadFile(home: Page) {
  const [download] = await Promise.all([
    home.waitForEvent("download"),
    home.getByRole("link", { name: "Download UnDuo's webpage" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(fileName);
  const path = test.info().outputPath(fileName);
  await download.saveAs(path);
  return path;
}

/** Double-clicking the file: it opens from disk, which is the only place setup runs. */
async function openFile(context: BrowserContext, path: string) {
  const page = await context.newPage();
  await page.goto(pathToFileURL(path).href);
  await expect(stepTitle(page)).toHaveText("Open your Duo device portal");
  return page;
}

/** Opens the school's portal from the file's button: a separate window with no way back. */
async function openPortal(context: BrowserContext, setup: Page) {
  const [portal] = await Promise.all([
    context.waitForEvent("page"),
    setup.getByRole("link", { name: `Open ${school}'s Duo portal` }).click(),
  ]);
  await portal.waitForLoadState();
  expect(await portal.evaluate(() => window.opener)).toBeNull();
  return portal;
}

async function signIn(portal: Page) {
  await expect(portal).toHaveURL(/^https:\/\/idpz\.utorauth\.utoronto\.ca\//);
  await portal.getByLabel("UTORid / JOINid").fill(student.username);
  await portal.getByLabel("Password").fill(student.password);
  await portal.getByRole("button", { name: "log in" }).click();
}

/** Duo's frame in UTORMFA's enrollment page, where the prompt and the device pages are. */
const duoFrame = (portal: Page) => portal.frameLocator('iframe[title="Two-Factor Authentication"]');

/** UTORMFA asks for Duo again in its frame: a push to the device the student already has. */
async function approveWithExistingDevice(portal: Page) {
  await expect(
    portal.getByRole("heading", { name: "UTORMFA Enrollment and Device Management Portal" }),
  ).toBeVisible();
  const frame = duoFrame(portal);
  await frame.getByRole("button", { name: "Send Me a Push" }).click();
  await expect(frame.getByRole("heading", { name: "My Settings & Devices" })).toBeVisible();
}

/** Follows the file's "Add a device" instruction, name by name, to the Duo QR code. */
async function addDevice(frame: FrameLocator, names: string[]) {
  await frame.getByRole("link", { name: "Add another device" }).click();
  for (const name of names) {
    const radio = frame.getByRole("radio", { name, exact: false });
    const button = frame.getByRole("button", { name });
    await radio.or(button).waitFor();
    if (await radio.count()) {
      await radio.check();
      await frame.getByRole("button", { name: "Continue" }).click();
    } else await button.click();
  }
  const code = frame.getByAltText("QR code");
  await expect(code).toBeVisible();
  await expect
    .poll(() => code.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  return code;
}

/** Signs in again and gets past UTORMFA's Duo frame with the new authenticator's passcode. */
async function signInWithPasscode(portal: Page, choices: string[], passcode: string) {
  const frame = duoFrame(portal);
  // The file names the prompt's passcode option in a few ways; follow the one this prompt shows.
  const named = new RegExp(
    `^(${choices.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`,
    "i",
  );
  await frame.getByRole("button", { name: named }).click();
  await frame.getByLabel("Passcode").fill(passcode);
  await frame.getByRole("button", { name: "Log In" }).click();
}

/** From a new file to the Duo QR code in the portal, with the page on its QR step. */
async function toQrStep(context: BrowserContext, path: string) {
  const setup = await openFile(context, path);
  const portal = await openPortal(context, setup);
  await signIn(portal);
  await approveWithExistingDevice(portal);
  await setup.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(stepTitle(setup)).toHaveText("Authenticate with Duo");
  await setup.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(stepTitle(setup)).toHaveText("Copy the activation QR code");
  const names = await namesIn(setup.locator(".instructions li").first());
  const code = await addDevice(duoFrame(portal), names);
  return { setup, portal, code };
}

const pasteOnPage = async (page: Page) => {
  await page.bringToFront();
  await page.keyboard.press("ControlOrMeta+V");
};

const replyBox = (setup: Page) => setup.frameLocator('iframe[name="duo-reply"]').locator("body");

/** Copies Duo's reply out of the box and into the field under it, as the page's list says. */
async function copyReply(setup: Page) {
  // The page moves focus to the field as the form goes, which a person's click always follows.
  await expect(setup.locator("#duo-reply")).toBeFocused();
  // A click within milliseconds of the frame loading can leave Chromium's key presses on the
  // top page, which a person's click a moment later doesn't. So check what was selected.
  await expect(async () => {
    await replyBox(setup).click();
    await setup.keyboard.press("ControlOrMeta+A");
    expect(await replyBox(setup).evaluate(() => getSelection()?.toString())).toContain('"stat"');
  }).toPass();
  await setup.keyboard.press("ControlOrMeta+C");
  await setup.locator("#duo-reply").click();
  await setup.keyboard.press("ControlOrMeta+V");
}

test("from a blank browser to a passcode that signs in", async ({
  context,
  page: home,
  world: { duo, assistant, network },
}) => {
  let path = "";
  let prompt = "";

  await instruction("the home page says what UnDuo does", home, async () => {
    expect(await context.cookies()).toEqual([]);
    await home.goto(site);
    await expect(home.getByRole("heading", { name: "UnDuo", exact: true })).toBeVisible();
    await expect(home.getByRole("combobox", { name: "Select Your University" })).toBeVisible();
    await expect(home.getByRole("dialog")).toBeHidden();
    await expect(home.locator(".step-item")).toHaveCount(0);
  });

  await instruction("1. select your university, which opens its download", home, async () => {
    await home.getByRole("combobox", { name: "Select Your University" }).click();
    await home.getByRole("combobox", { name: "Select Your University" }).fill("toronto");
    await home
      .getByRole("option", { name: new RegExp(school) })
      .first()
      .click();
    await expect(home.getByRole("dialog")).toBeVisible();
    await expect(stepTitle(home)).toHaveText("Download");
    await expect(home).toHaveURL(/\?university=.+#step=download$/);
  });

  await instruction("2. download the file but don't open it", home, async () => {
    await expect(home.getByRole("dialog").getByText("but don't open it yet:")).toBeVisible();
    const before = home.url();
    path = await downloadFile(home);
    expect(home.url(), "Downloading leaves the page where it was").toBe(before);
    // The address behind the link downloads rather than runs: that's why setup is safe from the site.
    const served = await context.request.get(
      await home
        .getByRole("link", { name: "Download UnDuo's webpage" })
        .evaluate((link: HTMLAnchorElement) => link.href),
    );
    expect(served.headers()["content-type"]).toBe("application/octet-stream");
    expect((await served.body()).equals(await readFile(path))).toBe(true);
    await home.getByRole("button", { name: "Continue" }).click();
  });

  await instruction("3. verify it with your favorite AI", home, async () => {
    await expect(stepTitle(home)).toHaveText("Verify");
    await expect(home).toHaveURL(/\?university=.+#step=verify$/);
    await expect(home.getByRole("tab", { name: "ChatGPT", selected: true })).toBeVisible();
    await expect(home.getByText(`Drag and drop ${fileName} into ChatGPT`)).toBeVisible();
    prompt = await home.getByLabel("Prompt for the AI").inputValue();
    expect(prompt).toContain("“Safe: yes”");
    await home.getByRole("button", { name: "Copy prompt" }).click();
    await expect(home.getByRole("button", { name: "Copied" })).toBeVisible();

    for (const [host, name] of Object.entries(assistants)) {
      await home.getByRole("tab", { name }).click();
      const link = home.getByRole("link", { name: `Open ${name}` });
      await expect(link).toHaveAttribute("href", `https://${host}/`);
      await expect(link).toHaveAttribute("rel", /noopener/);
    }
    await home.getByRole("tab", { name: "ChatGPT" }).click();
    const [chat] = await Promise.all([
      context.waitForEvent("page"),
      home.getByRole("link", { name: "Open ChatGPT" }).click(),
    ]);
    await expect(chat).toHaveURL("https://chatgpt.com/");
    await dropFile(chat.locator("#drop"), fileName, "text/html", await readFile(path));
    await expect(chat.getByRole("status")).toHaveText(`Attached ${fileName}`);
    await chat.getByLabel("Message").click();
    await chat.keyboard.press("ControlOrMeta+V");
    await chat.getByRole("button", { name: "Send" }).click();
    await expect(chat.getByRole("log")).toContainText("Safe: yes");
    expect(assistant.conversations).toEqual([
      { file: await readFile(path, "utf8"), message: prompt },
    ]);
    await chat.close();
  });

  await instruction("4. continue: the home page says to open the file", home, async () => {
    await home.bringToFront();
    await home.getByRole("button", { name: "Continue" }).click();
    await expect(stepTitle(home)).toHaveText("Continue");
    await expect(home.getByText(`double click ${fileName}`)).toBeVisible();
    await expect(home.getByText("to open UnDuo's secure webpage")).toBeVisible();
    await expect(
      home.getByText("Never trust any website with your sensitive school login credentials"),
    ).toBeVisible();
    await home.getByRole("button", { name: "Done" }).click();
    await expect(home.getByRole("dialog")).toBeHidden();
  });

  const setup = await openFile(context, path);
  let portal: Page;

  await instruction("file 1. open the Duo portal and sign in", setup, async () => {
    expect(new URL(setup.url()).protocol).toBe("file:");
    await expect(setup.locator("main p").first()).toHaveText(school);
    await expect(setup.locator("#setup-progress li")).toHaveCount(5);
    await expect(setup.locator("#portal-url")).toHaveValue(portalUrl);
    await setup.getByRole("button", { name: "Copy", exact: true }).click();
    await expect(setup.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
    expect(await pastedText(context)).toBe(portalUrl);

    await setup.bringToFront();
    portal = await openPortal(context, setup);
    await signIn(portal);
    await setup.bringToFront();
    await setup.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(stepTitle(setup)).toHaveText("Authenticate with Duo");
  });

  await instruction(
    "file 2. authenticate with Duo until My Settings & Devices",
    setup,
    async () => {
      await expect(
        setup.getByText("Press Continue once you land on the My Settings & Devices page:"),
      ).toBeVisible();
      await approveWithExistingDevice(portal!);
      await setup.bringToFront();
      await setup.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(stepTitle(setup)).toHaveText("Copy the activation QR code");
    },
  );

  await instruction("file 3. add a device and copy its QR code", setup, async () => {
    const steps = setup.locator(".instructions li");
    const add = await namesIn(steps.first());
    expect(add).toEqual(["Tablet", "Android", "I have Duo Mobile installed"]);
    await setup.locator("#portal-screenshots summary").click();
    const examples = setup.getByRole("group", { name: "Duo portal example screenshots" });
    await expect(examples.locator("img")).toHaveCount(5);
    await expect
      .poll(() =>
        examples
          .locator("img")
          .evaluateAll((images: HTMLImageElement[]) =>
            images.every((image) => image.naturalWidth > 0),
          ),
      )
      .toBe(true);

    const code = await addDevice(duoFrame(portal!), add);
    expect(await namesIn(steps.nth(1))).toEqual(["Copy Image"]);
    await copyImage(code);
    await pasteOnPage(setup);
    await expect(stepTitle(setup)).toHaveText("Activate with Duo");
  });

  const { code, secret } = duo.activations.at(-1)!;

  await instruction("file 4. activate with Duo and copy its reply", setup, async () => {
    await expect(setup.getByText(`Sent straight from your browser to ${duoHost}.`)).toBeVisible();
    const form = setup.locator('form[target="duo-reply"]');
    const named = await form
      .locator('input[type="hidden"]')
      .evaluateAll((fields: HTMLInputElement[]) => fields.map(({ name, value }) => [name, value]));
    expect(duo.posts).toEqual([]);
    await setup.getByRole("button", { name: "Activate with Duo" }).click();
    await expect(replyBox(setup)).toContainText('"stat":"OK"');
    expect(duo.devices).toContain("Android tablet");

    const [post] = duo.posts;
    expect(post!.url).toBe(`https://${duoHost}/push/v2/activation/${code}?customer_protocol=1`);
    // Browsers send a form's line breaks as CRLF, so the key's arrive that way.
    const sent = [...post!.fields].map(([name, value]) => [name, value.replaceAll("\r\n", "\n")]);
    expect(sent, "The form Duo got is the form the page showed").toEqual(named);
    expect(post!.fields.get("platform")).toBe("Android");
    const key = createPublicKey(post!.fields.get("pubkey")!);
    expect(key.asymmetricKeyType).toBe("rsa");
    expect(key.asymmetricKeyDetails?.modulusLength).toBeGreaterThanOrEqual(2048);
    expect(post!.referer, "The page sends Duo no address").toBeUndefined();

    // Pasting a whole reply moves on by itself, with no need for "Create my authenticator".
    await copyReply(setup);
    await expect(stepTitle(setup)).toHaveText("Add it to your authenticator");
    await expect(
      setup.locator('iframe[name="duo-reply"]'),
      "The box goes with the reply",
    ).toHaveCount(0);
  });

  let counterLink = "";

  await instruction("file 5. scan the code with an authenticator", setup, async () => {
    await expect(setup.getByText(`Duo account for ${school}`)).toBeVisible();
    const qr = setup.locator(".qr-image");
    counterLink = await scanQrCode(qr);
    const link = readOtpauth(counterLink);
    expect(link).toMatchObject({
      type: "hotp",
      label: `Duo:${school}`,
      issuer: "Duo",
      algorithm: "SHA1",
      digits: "6",
      counter: "0",
    });
    expect(link.parameters).toEqual(["algorithm", "counter", "digits", "issuer", "secret"]);
    expect(link.secret.toString(), "The key the phone gets is the one Duo sent").toBe(secret);

    await setup.getByRole("button", { name: "Copy otpauth:// link" }).click();
    await expect(setup.getByRole("button", { name: "Link copied" })).toBeVisible();
    expect(await pastedText(context)).toBe(counterLink);

    const setupKey = counterLink.match(/secret=([A-Z2-7]+)/)![1]!;
    const shown = setupKey.match(/.{1,4}/g)!.join(" ");
    await expect(
      setup.locator(".setup-key"),
      "The key stays hidden until asked for",
    ).not.toHaveText(shown);
    await setup.getByRole("button", { name: "Show" }).click();
    await expect(setup.locator(".setup-key")).toHaveText(shown);
    await setup.getByRole("button", { name: "Copy key" }).click();
    await expect(setup.getByRole("button", { name: "Key copied" })).toBeVisible();
    expect(await pastedText(context)).toBe(setupKey);

    await setup.getByLabel("Time-based").check();
    await expect
      .poll(() => scanQrCode(qr).then((text) => text.startsWith("otpauth://totp/")))
      .toBe(true);
    const time = readOtpauth(await scanQrCode(qr));
    expect(time).toMatchObject({ type: "totp", period: "30" });
    expect(time.secret.toString()).toBe(secret);
    expect(totp(time.secret)).toMatch(/^\d{6}$/);
    await setup.getByLabel("Counter-based").check();
    await expect.poll(() => scanQrCode(qr)).toBe(counterLink);
  });

  await instruction("file 5. then test it: a passcode signs in", portal!, async () => {
    const choices = await namesIn(setup.locator(".next-test"));
    const key = readOtpauth(counterLink).secret;
    const frame = duoFrame(portal);

    duo.signOut();
    await portal.bringToFront();
    await portal.goto(portalUrl);
    await signIn(portal);
    await signInWithPasscode(portal, choices, "000000");
    await expect(frame.getByRole("alert")).toHaveText("Incorrect passcode. Try again.");

    await frame.getByLabel("Passcode").fill(hotp(key, 0));
    await frame.getByRole("button", { name: "Log In" }).click();
    await expect(frame.getByRole("heading", { name: "My Settings & Devices" })).toBeVisible();
    await expect(frame.locator("#devices")).toContainText("Android tablet");

    // "Tap refresh in the app whenever you need a new code."
    duo.signOut();
    await portal.goto(portalUrl);
    await signIn(portal);
    await signInWithPasscode(portal, choices, hotp(key, 0));
    await expect(frame.getByRole("alert"), "A used code doesn't work twice").toBeVisible();
    await frame.getByLabel("Passcode").fill(hotp(key, 1));
    await frame.getByRole("button", { name: "Log In" }).click();
    await expect(frame.getByRole("heading", { name: "My Settings & Devices" })).toBeVisible();
  });

  await test.step("the code and key went only to Duo and the phone", async () => {
    const setupKey = counterLink.match(/secret=([A-Z2-7]+)/)![1]!;
    const secrets = [code, secret, setupKey];
    const leaks = network.requests.filter(
      ({ url, body, headers }) =>
        new URL(url).hostname !== duoHost &&
        secrets.some((value) => `${url} ${body} ${JSON.stringify(headers)}`.includes(value)),
    );
    expect(leaks).toEqual([]);
    const toDuo = network.requests.filter(
      ({ url, method }) =>
        new URL(url).hostname === duoHost && url.includes(code) && method === "POST",
    );
    expect(toDuo, "One activation, for one click").toHaveLength(1);
    expect(
      network.requests.filter(({ body }) => body.includes(secret)),
      "Nothing ever sends the key back out",
    ).toEqual([]);
    const credentials = network.requests.filter(({ body }) => body.includes(student.password));
    expect(
      new Set(credentials.map(({ url }) => new URL(url).hostname)),
      "The password goes only to the school's own sign-in",
    ).toEqual(new Set(["idpz.utorauth.utoronto.ca"]));

    const kept = await setup.evaluate(() =>
      JSON.stringify([
        location.href,
        history.state,
        Object.entries(localStorage),
        Object.entries(sessionStorage),
      ]),
    );
    for (const value of secrets) expect(kept).not.toContain(value);
    expect(new URL(setup.url()).hash, "The file names no step in its address").toBe("");
    expect(await context.cookies(site), "unduo.me sets no cookies").toEqual([]);
  });

  await instruction("the file forgets the key on reload and on Start over", setup, async () => {
    await setup.bringToFront();
    await setup.getByRole("button", { name: "Start over" }).click();
    await expect(stepTitle(setup)).toHaveText("Open your Duo device portal");
    await expect(setup.locator("body")).not.toContainText(secret);

    const asked: string[] = [];
    setup.on("dialog", async (dialog) => {
      asked.push(dialog.type());
      await dialog.accept();
    });
    await setup.reload();
    await expect(stepTitle(setup)).toHaveText("Open your Duo device portal");
    await expect(setup.getByRole("button", { name: "Back" })).toBeHidden();
    expect(asked, "Nothing left to lose, so nothing to ask").toEqual([]);
  });
});

test("the browser can't reach the real school or Duo", async ({ browser }) => {
  // A new context has no routes: this is the host rule in playwright.config.ts on its own.
  const page = await (await browser.newContext()).newPage();
  for (const host of [portalHost, signInHost, duoHost, "api-12345678.duosecurity.com"])
    await expect(page.goto(`https://${host}/`)).rejects.toThrow(/ERR_NAME_NOT_RESOLVED/);
});

test.describe("what else the pages offer", () => {
  /** A school's shared link opens its dialog at the download. */
  async function fileFromSharedLink(home: Page) {
    await home.goto(new URL("?university=UofT", site).href);
    await expect(stepTitle(home)).toHaveText("Download");
    return downloadFile(home);
  }

  /**
   * A screenshot of the portal's window once the QR code is in view. The file opens the portal
   * in a window 480 wide, where the code can sit below the fold, so a person scrolls to it first.
   */
  async function screenshotShowing(code: Locator) {
    await code.scrollIntoViewIfNeeded();
    return code.page().screenshot();
  }

  const ways = {
    "Copy Image Address": async ({ code, setup }) => {
      await copyText(code.page(), await code.evaluate((image: HTMLImageElement) => image.src));
      await pasteOnPage(setup);
    },
    "an emailed activation link, pasted in the field": async ({ code, setup, duo }) => {
      const frame = duoFrame(code.page());
      await frame.getByRole("link", { name: "Email me an activation link instead." }).click();
      await frame.getByLabel("Email address").fill(student.email);
      await frame.getByRole("button", { name: "Send email" }).click();
      await expect(frame.getByRole("heading", { name: "Email sent" })).toBeVisible();
      const link = duo.mail.at(-1)!.body.match(/https:\/\/\S+/)![0];
      await setup.bringToFront();
      await setup.getByLabel("Paste the QR code here").fill(`Your link: ${link}`);
      await setup.getByRole("button", { name: "Continue" }).click();
    },
    "an uploaded screenshot": async ({ code, setup }) => {
      await setup.locator('input[type="file"]').setInputFiles({
        name: "screenshot.png",
        mimeType: "image/png",
        buffer: await screenshotShowing(code),
      });
    },
    "a dropped screenshot": async ({ code, setup }) => {
      await dropFile(
        setup.locator(".drop-zone"),
        "screenshot.png",
        "image/png",
        await screenshotShowing(code),
      );
    },
  } satisfies Record<
    string,
    (found: { code: Locator; setup: Page; duo: ReturnType<typeof mockDuo> }) => Promise<void>
  >;

  for (const [way, copy] of Object.entries(ways))
    test(`the QR step takes ${way}`, async ({ context, page: home, world: { duo } }) => {
      const path = await fileFromSharedLink(home);
      const { setup, code } = await toQrStep(context, path);
      await copy({ code, setup, duo });
      await expect(stepTitle(setup)).toHaveText("Activate with Duo");
      await expect(setup.locator('form[target="duo-reply"]')).toHaveAttribute(
        "action",
        `https://${duoHost}/push/v2/activation/${duo.activations.at(-1)!.code}?customer_protocol=1`,
      );
    });

  test("the QR step refuses a code that isn't Duo's", async ({
    context,
    page: home,
    world: { duo },
  }) => {
    const path = await fileFromSharedLink(home);
    const { setup } = await toQrStep(context, path);
    await setup.bringToFront();
    await setup
      .getByLabel("Paste the QR code here")
      .fill("https://example.com/activate/ABCDE12345");
    await setup.getByRole("button", { name: "Continue" }).click();
    await expect(setup.locator("#activation-error")).toContainText("That's not a Duo link");
    await expect(stepTitle(setup)).toHaveText("Copy the activation QR code");
    expect(duo.posts).toEqual([]);
  });

  test("a used QR code leads to a new one", async ({ context, page: home, world: { duo } }) => {
    const path = await fileFromSharedLink(home);
    const { setup, code } = await toQrStep(context, path);
    await copyImage(code);
    await pasteOnPage(setup);
    await setup.getByRole("button", { name: "Activate with Duo" }).click();
    await expect(replyBox(setup)).toContainText('"stat":"OK"');

    await setup.getByRole("button", { name: "Activate again" }).click();
    await setup.getByRole("button", { name: "Activate with Duo" }).click();
    await expect(replyBox(setup)).toContainText("Unknown activation code");
    expect(duo.posts).toHaveLength(2);

    await copyReply(setup);
    await expect(setup.locator("#reply-error")).toBeVisible();
    await setup.getByRole("button", { name: "Use a new QR code" }).click();
    await expect(stepTitle(setup)).toHaveText("Copy the activation QR code");
  });

  test("Duo's reply can open in a new tab instead", async ({
    context,
    page: home,
    world: { duo },
  }) => {
    const path = await fileFromSharedLink(home);
    const { setup, code } = await toQrStep(context, path);
    await copyImage(code);
    await pasteOnPage(setup);
    await expect(stepTitle(setup)).toHaveText("Activate with Duo");
    const [tab] = await Promise.all([
      context.waitForEvent("page"),
      setup.getByRole("button", { name: "Open Duo's reply in a new tab instead" }).click(),
    ]);
    await expect(tab.locator("body")).toContainText('"stat":"OK"');
    await tab.bringToFront();
    await tab.keyboard.press("ControlOrMeta+A");
    await tab.keyboard.press("ControlOrMeta+C");
    await setup.bringToFront();
    await setup.locator("#duo-reply").click();
    await setup.keyboard.press("ControlOrMeta+V");
    await expect(stepTitle(setup)).toHaveText("Add it to your authenticator");
    expect(readOtpauth(await scanQrCode(setup.locator(".qr-image"))).secret.toString()).toBe(
      duo.activations.at(-1)!.secret,
    );
  });

  test("leaving with a key in the page asks first, and forgets it", async ({
    context,
    page: home,
    world: { duo },
  }) => {
    const path = await fileFromSharedLink(home);
    const { setup, code } = await toQrStep(context, path);
    await copyImage(code);
    await pasteOnPage(setup);
    await setup.getByRole("button", { name: "Activate with Duo" }).click();
    await expect(replyBox(setup)).toContainText('"stat":"OK"');
    await copyReply(setup);
    await expect(stepTitle(setup)).toHaveText("Add it to your authenticator");

    const asked: string[] = [];
    setup.on("dialog", async (dialog) => {
      asked.push(dialog.type());
      await dialog.accept();
    });
    await setup.reload();
    expect(asked).toEqual(["beforeunload"]);
    await expect(stepTitle(setup)).not.toHaveText("Add it to your authenticator");
    await expect(setup.locator(".setup-key")).toHaveCount(0);
    await expect(setup.locator("body")).not.toContainText(duo.activations.at(-1)!.secret);
  });
});
