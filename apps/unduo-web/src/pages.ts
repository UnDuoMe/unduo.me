import { homeMount } from "@-/me.unduo.components.home/server";
import { setupMount } from "@-/me.unduo.components.setup/server";
import type { SitePage } from "@-/me.unduo.configs.web";
import { getBuildUniversities } from "@-/me.unduo.configs.web/universities";
import { pageLayout } from "./page-layout";

/**
 * Every document the site publishes: the home page, and each institution's setup
 * file, named by its WHED number without `IAU-`. A file has no extension, so the
 * site serves it as a download and never runs it: setup happens only from a file
 * on the student's computer, not on a website.
 */
export function sitePages(): SitePage[] {
  return [
    {
      path: "index.html",
      entry: "home",
      render: (resources) =>
        pageLayout(
          {
            title: "UnDuo — A secure way to use any 2FA app for your school login",
            entry: "home",
            resources,
          },
          homeMount({ image: resources.image }),
        ),
    },
    ...getBuildUniversities().map((university) => {
      if (!/^IAU-\d{6}(?:-\d{6})*$/.test(university.id))
        throw new Error(`Invalid WHED folder: ${university.id}`);
      return {
        path: `files/${university.id.slice(4)}`,
        entry: "setup",
        render: (resources) =>
          pageLayout(
            { title: `Duo setup for ${university.name} — unduo`, entry: "setup", resources },
            setupMount({ university, image: resources.image }),
          ),
      } satisfies SitePage;
    }),
  ];
}
