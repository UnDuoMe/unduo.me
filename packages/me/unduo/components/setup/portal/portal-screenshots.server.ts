import { attributes, escapeText } from "@-/me.unduo.lib.dom/server";

/** Example screenshots of Duo's pages, with only account text (device names and numbers) blurred. */
interface Screenshots {
  /** What Duo shows once the student is signed in, which `portalStep` copies. */
  signedIn: { file: string; caption?: string; label: string; size: "narrow" | "wide" }[];
  /** The page that lists the student's devices, which `authenticateStep` copies, with how to reach it. */
  settings: { file: string; caption?: string; label: string };
  /** Adding a device until its QR code shows, which `portalInstructions` copies. */
  steps: { file: string; label: string }[];
}

/**
 * UofT's Traditional Prompt: its sign-in prompt in a narrow window and a wide
 * one, and its My Settings & Devices page, with UofT's logo. The enrollment
 * steps show no logo.
 */
const traditional: Screenshots = {
  signedIn: [
    {
      file: "0-signed-in-narrow",
      caption: "In a narrow window",
      label: "Duo's sign-in prompt in a narrow window, with the device's name and number blurred",
      size: "narrow",
    },
    {
      file: "0-signed-in-wide",
      caption: "In a wide window",
      label: "Duo's sign-in prompt in a wide window, with the device's name and number blurred",
      size: "wide",
    },
  ],
  settings: {
    file: "0-settings-devices",
    label: "Duo's My Settings & Devices page, with the devices' names and numbers blurred",
  },
  steps: [
    { file: "1-add-device", label: "1. Choose “Add another device”" },
    { file: "2-tablet", label: "2. Choose Tablet" },
    { file: "3-android", label: "3. Choose Android" },
    { file: "4-duo-installed", label: "4. Choose “I have Duo Mobile installed”" },
    { file: "5-copy-qr-url", label: "5. Right-click the QR code and copy it" },
  ],
};

/** The same, with UofT's logo painted out (`-generic`), for the file that names no institution. */
const generic: Screenshots = {
  ...traditional,
  signedIn: traditional.signedIn.map((shot) => ({ ...shot, file: `${shot.file}-generic` })),
  settings: { ...traditional.settings, file: `${traditional.settings.file}-generic` },
};

/**
 * Waterloo's Universal Prompt and device management portal (`-universal`),
 * from its IT knowledge base, with Waterloo's logo. Duo's prompt looks the
 * same in a narrow window and a wide one.
 */
const universal: Screenshots = {
  signedIn: [
    {
      file: "0-signed-in-universal",
      label: "Duo's prompt for a verification code, with the device's name blurred",
      size: "narrow",
    },
  ],
  settings: {
    file: "0-settings-devices-universal",
    label:
      "Duo's device management page with Add a device, with the device's name and model blurred",
  },
  steps: [
    { file: "1-add-device-universal", label: "1. Choose “Add a device”" },
    { file: "2-duo-mobile-universal", label: "2. Choose Duo Mobile" },
    { file: "3-tablet-universal", label: "3. Choose “I have a tablet”" },
    { file: "4-next-universal", label: "4. Choose Next" },
    { file: "5-copy-qr-universal", label: "5. Right-click the QR code and copy it" },
  ],
};

/**
 * Western's Traditional Prompt: its own My Settings & Devices (`-western`, from
 * Western Technology Services' enrollment guide, keeping its red box around Add
 * another device), and UofT's examples without UofT's logo, since Western's
 * guides show no sign-in prompt.
 */
const western: Screenshots = {
  ...generic,
  settings: {
    file: "0-settings-devices-western",
    caption: "In Western Identity Manager: Security → Manage My MFA → Launch Duo Manager",
    label: "Duo's My Settings & Devices page at Western, with the device's name and number blurred",
  },
};

const sets = { traditional, generic, universal, western };

/** Which screenshots a file shows: UofT's, UofT's without its logo, Waterloo's or Western's. */
export type ScreenshotSet = keyof typeof sets;

/** Institutions with screenshots of their own portal, by WHED ID. */
const ownScreenshots: Record<string, ScreenshotSet> = { "IAU-020629": "western" };

/**
 * The screenshots for a file: none of an institution's for the file that names
 * none, an institution's own, Waterloo's for the Universal Prompt, or UofT's.
 */
export function screenshotSet(school?: { id: string; duoPrompt?: string }): ScreenshotSet {
  if (!school) return "generic";
  return (
    ownScreenshots[school.id] ?? (school.duoPrompt === "universal" ? "universal" : "traditional")
  );
}

/**
 * Each set's captions and pinned files, in `<template>`s named for the set:
 * the signed-in examples (`#portal-signed-in-<set>`), which `portalStep`
 * copies, the devices page (`#portal-settings-<set>`), which
 * `authenticateStep` copies, and the enrollment steps
 * (`#portal-screenshot-figures-<set>`), which `portalInstructions` copies.
 * `image` gives the attributes that load each file.
 */
export function portalScreenshots(
  image: (file: string) => Record<string, string>,
  sets: readonly ScreenshotSet[],
) {
  return sets.map((set) => screenshotTemplates(image, set)).join("\n      ");
}

/** One set's three templates. */
function screenshotTemplates(image: (file: string) => Record<string, string>, set: ScreenshotSet) {
  const { signedIn, settings, steps } = sets[set];
  const examples = signedIn.map(
    ({ file, caption, label, size }) => `
    <figure class="signed-in-${size}">${
      caption
        ? `
      <figcaption class="figure-caption">${escapeText(caption)}</figcaption>`
        : ""
    }
      <img class="screenshot"${attributes({ ...image(`setup-${file}`), alt: label })}>
    </figure>`,
  );
  const figures = steps.map(
    ({ file, label }) => `
    <figure>
      <figcaption class="figure-caption">${escapeText(label)}</figcaption>
      <img class="screenshot"${attributes({ ...image(`setup-${file}`), alt: label })}>
    </figure>`,
  );
  const settingsImage = `<img class="screenshot"${attributes({ ...image(`setup-${settings.file}`), alt: settings.label })}>`;
  const settingsPage = settings.caption
    ? `<figure><figcaption class="figure-caption">${escapeText(settings.caption)}</figcaption>${settingsImage}</figure>`
    : settingsImage;
  return `<template id="portal-signed-in-${set}">${examples.join("")}
  </template>
      <template id="portal-settings-${set}">${settingsPage}</template>
      <template id="portal-screenshot-figures-${set}">${figures.join("")}
  </template>`;
}
