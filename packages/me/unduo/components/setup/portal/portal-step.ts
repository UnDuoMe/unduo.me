import type { SetupPage, SetupSchool } from "@-/me.unduo.components.setup.entities";
import {
  a,
  button,
  div,
  em,
  input,
  label,
  li,
  p,
  span,
  strong,
  ul,
  van,
} from "@-/me.unduo.lib.dom";

/** The institution's portal link, with a field and button to copy it. */
function schoolPortal({ view, copy, popup }: SetupPage, name: string, portalUrl: string) {
  return [
    a(
      {
        class: "uk-button uk-button-primary btn",
        href: portalUrl,
        target: "_blank",
        rel: "noopener noreferrer",
        onclick: popup,
      },
      `Open ${name}'s Duo portal`,
    ),
    p(
      { class: "school-note" },
      "It opens in a small window beside this one, so you can keep these steps in view.",
    ),
    label({ for: "portal-url", class: "portal-label" }, "Or paste this link into a new window"),
    div(
      { class: "portal-row" },
      input({
        class: "uk-input field grow mono",
        id: "portal-url",
        readOnly: true,
        value: portalUrl,
        onfocus: (event: FocusEvent) => (event.target as HTMLInputElement).select(),
        autocomplete: "off",
        spellcheck: false,
      }),
      button(
        {
          type: "button",
          class: "uk-button uk-button-default btn",
          onclick: () => copy("portal"),
        },
        van.derive(() => (view.val.copied === "portal" ? "Copied" : "Copy")),
      ),
    ),
    p(
      {
        class: "copied-note",
        role: "alert",
        hidden: () => !view.val.copyError,
      },
      "Clipboard access isn't available. Select the link above to copy it.",
    ),
    span(
      { class: "sr-only", role: "status" },
      van.derive(() => (view.val.copied === "portal" ? "Portal link copied." : "")),
    ),
  ];
}

/** The step that opens the Duo device portal, with the institution's link if it has one. */
export function portalStep(school: SetupSchool, home: string, page: SetupPage) {
  return div(
    p(
      { class: "intro" },
      "Sign in to your organization's Duo device portal, where you manage the phones and tablets on your account. You'll add unduo there as a new device next.",
    ),
    div(
      { class: "school-card" },
      school.portalUrl
        ? schoolPortal(page, school.name, school.portalUrl)
        : p(
            { class: "note" },
            "We don't have a verified Duo portal link for this institution. It may use another MFA provider. Follow the guidance below or ask your IT help desk.",
          ),
      school.note && p({ class: "school-note" }, school.note),
      a(
        {
          class: "uk-link school-link",
          href: school.sourceUrl,
          target: "_blank",
          rel: "noreferrer",
        },
        "Source",
      ),
    ),
    ul(
      {
        class: "portal-steps",
      },
      li(
        strong("From a Duo sign-in prompt:"),
        " choose ",
        em("Other options"),
        " → ",
        em("Manage devices"),
        ".",
      ),
      li(
        strong("From your organization:"),
        " look for “Duo”, “two-factor” or “MFA” on its IT help pages.",
      ),
    ),
    a({ class: "uk-link other-school", href: home }, "Choose a different university"),
  );
}
