import { portalScreenshots, screenshotSet } from "@-/me.unduo.components.setup.portal/server";
import type { University } from "@-/me.unduo.data.universities.entities";
import { attributes } from "@-/me.unduo.lib.dom/server";

interface SetupMount {
  /** The institutions the file can be for; it names one when its file name does. */
  universities: readonly University[];
  /** The attributes that load a screenshot. */
  image: (file: string) => Record<string, string>;
}

/**
 * The HTML that `startSetupPage` mounts into: the empty `#setup` element, the
 * `#setup-schools` template, whose elements' data attributes hold each
 * institution's details, and the screenshots' templates. The file is the same
 * for every institution: the page picks one by its own file name, as the home
 * page saves it, and the first step can change it.
 */
export function setupMount({ universities, image }: SetupMount) {
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
  return `<div id="setup"></div>
      <template id="setup-schools">${schools.join("")}</template>
      ${portalScreenshots(image, sets)}`;
}
