import { homeMount } from "@-/me.unduo.components.home/server";
import { setupMount } from "@-/me.unduo.components.setup/server";
import type { SitePage } from "@-/me.unduo.configs.web";
import { getBuildUniversities } from "@-/me.unduo.configs.web/universities";
import { pageLayout } from "./page-layout";

/**
 * Every document the site publishes: the home page and `files/unduo`, the one
 * setup file for every institution. The home page saves it as
 * `UnDuo - <institution>.html`, and the file shows the institution its name
 * names. It has no extension, so the site serves it as a download and never
 * runs it: setup happens only from a file on the student's computer, not on a
 * website.
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
    {
      path: "files/unduo",
      entry: "setup",
      render: (resources) =>
        pageLayout(
          { title: "Duo setup — unduo", entry: "setup", resources },
          setupMount({
            universities: getBuildUniversities(),
            screenshot: resources.screenshot,
            asset: resources.asset,
          }),
        ),
    },
  ];
}
