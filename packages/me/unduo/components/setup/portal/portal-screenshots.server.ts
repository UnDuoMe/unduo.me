import { attributes, escapeText } from "@-/me.unduo.lib.dom/server";

/**
 * What Duo shows once the student is signed in, in a narrow window and a wide
 * one: blurred, but for the school's logo and, where it has one, the Settings button.
 */
const signedIn = [
  {
    file: "0-signed-in-narrow",
    caption: "In a narrow window",
    label:
      "Duo's sign-in prompt in a narrow window, blurred except for the school's logo and its Settings button",
    size: "narrow",
  },
  {
    file: "0-signed-in-wide",
    caption: "In a wide window",
    label: "Duo's sign-in prompt in a wide window, blurred except for the school's logo",
    size: "wide",
  },
];

/** Duo's My Settings & Devices page, where signing in lands: blurred, but for the school's logo and the page's heading. */
const settings = {
  file: "0-settings-devices",
  label:
    "Duo's My Settings & Devices page, blurred except for the school's logo and the page's heading",
};

const screenshots = [
  { file: "1-add-device", label: "1. Choose “Add another device”" },
  { file: "2-tablet", label: "2. Choose Tablet" },
  { file: "3-android", label: "3. Choose Android" },
  { file: "4-duo-installed", label: "4. Choose “I have Duo Mobile installed”" },
  { file: "5-copy-qr-url", label: "5. Right-click the QR code and copy it" },
];

/**
 * The screenshots' captions and pinned files, in `<template>`s: the signed-in
 * examples, which `portalStep` copies, the settings page, which
 * `authenticateStep` copies, and the enrollment steps, which
 * `portalInstructions` copies. `image` gives the attributes that load each file.
 */
export function portalScreenshots(image: (file: string) => Record<string, string>) {
  const examples = signedIn.map(
    ({ file, caption, label, size }) => `
    <figure class="signed-in-${size}">
      <figcaption class="figure-caption">${escapeText(caption)}</figcaption>
      <img class="screenshot"${attributes({ ...image(`setup-${file}`), alt: label })}>
    </figure>`,
  );
  const figures = screenshots.map(
    ({ file, label }) => `
    <figure>
      <figcaption class="figure-caption">${escapeText(label)}</figcaption>
      <img class="screenshot"${attributes({ ...image(`setup-${file}`), alt: label })}>
    </figure>`,
  );
  const settingsPage = `<img class="screenshot"${attributes({ ...image(`setup-${settings.file}`), alt: settings.label })}>`;
  return `<template id="portal-signed-in">${examples.join("")}
  </template>
      <template id="portal-settings">${settingsPage}</template>
      <template id="portal-screenshot-figures">${figures.join("")}
  </template>`;
}
