import { portalScreenshots } from "@-/me.unduo.components.setup.portal/server";
import type { University } from "@-/me.unduo.data.universities.entities";
import { attributes } from "@-/me.unduo.lib.dom/server";

interface SetupMount {
  /** The institution the file is for. Without one, the file names none and links to no portal. */
  university?: University | undefined;
  /** The attributes that load a screenshot. */
  image: (file: string) => Record<string, string>;
}

/**
 * The HTML that `startSetupPage` mounts into: the `#setup` element, whose data
 * attributes hold what only the build knows, and the screenshots' template.
 */
export function setupMount({ university, image }: SetupMount) {
  const setup = attributes({
    id: "setup",
    "data-school-name": university?.name,
    "data-portal-url": university?.portalUrl,
    "data-duo-prompt": university?.duoPrompt,
    "data-school-note": university?.note,
    "data-source-url": university?.sourceUrl,
  });
  return `<div${setup}></div>
      ${portalScreenshots(image, !university ? "generic" : university.duoPrompt === "universal" ? "universal" : "traditional")}`;
}
