import { setupHelpButton } from "@-/me.unduo.components.setup.help";
import { pluginLimits } from "@-/me.unduo.components.setup.limits";
import { a, div, footer, h1, header, main, nav, p, span } from "@-/me.unduo.lib.dom";
import type { SetupPage } from "#entities";

/**
 * The page around `host`, the `#setup` element: header, introduction, help and
 * footer. A file for no particular institution has an empty `schoolName`.
 */
export function setupLayout(page: SetupPage, schoolName: string, home: string, host: HTMLElement) {
  return div(
    { class: "page" },
    a(
      {
        id: "skip-to-setup",
        class: "skip-link",
        href: "#setup-card",
        onclick: (event: Event) => {
          event.preventDefault();
          page.focusStep();
        },
      },
      "Skip to setup",
    ),
    header(
      { class: "site-header" },
      a(
        {
          class: "logo",
          href: home,
          "aria-label": "unduo home",
        },
        "unduo",
        span({ class: "logo-dot", "aria-hidden": "true" }, "."),
      ),
      nav(
        { class: "site-nav", "aria-label": "Help and source" },
        setupHelpButton("guide"),
        a(
          {
            class: "nav-link",
            href: "https://github.com/UnDuoMe/unduo.me",
            target: "_blank",
            rel: "noreferrer",
            "aria-label": "Source code on GitHub",
          },
          "Source",
        ),
      ),
    ),
    main(
      div(
        { class: "hero" },
        schoolName && p({ class: "eyebrow" }, schoolName),
        h1({ class: "headline" }, "Use any authenticator app with Duo"),
        p(
          { class: "tagline" },
          "Turn the QR code from your Duo portal into a standard passcode for Google Authenticator, 2FAS, Aegis and other apps. It all happens in your browser.",
        ),
        p(
          { class: "disclaimer" },
          `unduo is an independent open-source tool. It isn't affiliated with ${schoolName || "your organization"}, Duo Security or Cisco.`,
        ),
      ),
      host,
    ),
    footer(
      {
        id: "setup-footer",
        class: "site-footer",
      },
      span({ class: "footer-item" }, "Runs in your browser. Your key is never sent to unduo."),
      span({ class: "footer-links" }, setupHelpButton("privacy"), setupHelpButton("terminal")),
      pluginLimits(page),
    ),
  );
}
