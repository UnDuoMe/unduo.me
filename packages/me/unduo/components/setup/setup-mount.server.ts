import { screenshotList, screenshotSet } from "@-/me.unduo.components.setup.portal/server";
import type { University } from "@-/me.unduo.data.universities.entities";
import { attributes } from "@-/me.unduo.lib.dom/server";

/** A file published with the setup files' assets: its address and SHA-256, and jsDelivr's listing of it. */
export interface PublishedAsset {
  url: string;
  integrity: string;
  source: string;
  file: string;
}

interface SetupMount {
  /** The institutions the file can be for; it shows the one its file name names. */
  universities: readonly University[];
  /** A screenshot's file, relative to the screenshot list, and its SHA-256. */
  screenshot: (name: string) => { file: string; integrity: string };
  /** Publish `bytes` as `name` with the setup files' assets and say how the page loads it. */
  asset: (name: string, bytes: Buffer) => PublishedAsset;
}

/**
 * The HTML that `startSetupPage` mounts into: the `#setup` element, whose data
 * attributes pin the screenshot list by its SHA-256, and the `#setup-schools`
 * template, whose elements' data attributes hold each institution's details.
 * The file is the same for every institution: the page picks one by its own
 * file name, as the home page saves it, and the first step can change it.
 */
export function setupMount({ universities, screenshot, asset }: SetupMount) {
  const schools = universities.map(
    (university) =>
      `<div${attributes({
        "data-school-id": university.id,
        "data-school-name": university.name,
        "data-portal-url": university.portalUrl,
        "data-duo-prompt": university.duoPrompt,
        "data-school-note": university.note,
        "data-source-url": university.sourceUrl,
        "data-screenshots": screenshotSet(university),
      })}></div>`,
  );
  // Other, for a file name that names no institution, shows the screenshots without a logo.
  const sets = [...new Set(["generic" as const, ...universities.map(screenshotSet)])];
  const list = asset(
    "screenshots.json",
    Buffer.from(`${JSON.stringify(screenshotList(sets, screenshot), null, 1)}\n`),
  );
  const setup = attributes({
    id: "setup",
    "data-screenshots-url": list.url,
    "data-screenshots-integrity": list.integrity,
    "data-integrity-source": list.source,
    "data-integrity-file": list.file,
    "data-comment":
      "data-screenshots-url is the screenshot list: for each kind of Duo portal, its example screenshots' text, file names and SHA-256s. The script fetches it only if its SHA-256 matches data-screenshots-integrity, and fetches the screenshots of the institution shown from the same folder, each only if its SHA-256 matches the list's.",
  });
  return `<div${setup}></div>
      <template id="setup-schools">${schools.join("")}</template>`;
}
