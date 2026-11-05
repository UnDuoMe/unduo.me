import { attributes, escapeText } from "@-/me.unduo.lib.dom/server";

const screenshots = [
  { file: "1-add-device", label: "1. Choose “Add another device”" },
  { file: "2-tablet", label: "2. Choose Tablet" },
  { file: "3-android", label: "3. Choose Android" },
  { file: "4-duo-installed", label: "4. Choose “I have Duo Mobile installed”" },
  { file: "5-copy-qr-url", label: "5. Right-click the QR code and copy it" },
];

/**
 * The screenshots' captions and pinned files, in a `<template>` that
 * `portalInstructions` copies. `image` gives the attributes that load each file.
 */
export function portalScreenshots(image: (file: string) => Record<string, string>) {
  const figures = screenshots.map(
    ({ file, label }) => `
    <figure>
      <figcaption class="figure-caption">${escapeText(label)}</figcaption>
      <img class="screenshot"${attributes({ ...image(`setup-${file}`), alt: label })}>
    </figure>`,
  );
  return `<template id="portal-screenshot-figures">${figures.join("")}
  </template>`;
}
