import type { SetupPage, SetupSchool } from "@-/me.unduo.components.setup.entities";
import { a, button, div, input, label, p, span, strong } from "@-/me.unduo.lib.dom";

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

/** Example screenshots, copied from the page's `<template>` with this `id`, which holds their URLs and pins. */
function examples(id: string, { screenshot }: SetupPage) {
  const copy = (document.getElementById(id) as HTMLTemplateElement).content.cloneNode(
    true,
  ) as DocumentFragment;
  copy.querySelectorAll("img").forEach(screenshot);
  return copy;
}

/**
 * The step that opens the Duo device portal, with the institution's link if it
 * has one, and what the portal shows once the student is signed in. A file for
 * no particular institution has no name, link or source.
 */
export function portalStep(school: SetupSchool, page: SetupPage) {
  return div(
    p(
      { class: "intro" },
      "Sign in to your organization's Duo device portal, where you manage the phones and tablets on your account. You'll add unduo there as a new device.",
    ),
    div(
      { class: "school-card" },
      school.portalUrl
        ? schoolPortal(page, school.name, school.portalUrl)
        : p(
            { class: "note" },
            school.name
              ? "We don't have a verified Duo portal link for this institution. It may use another MFA provider. Ask your IT help desk where to manage your Duo devices."
              : "Open it in a new window, so you can keep these steps in view. If you don't know its address, ask your IT help desk where to manage your Duo devices.",
          ),
      school.note && p({ class: "school-note" }, school.note),
      school.sourceUrl &&
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
    p({ class: "signed-in-text" }, "Press ", strong("Continue"), " when you see a page like this:"),
    div({ class: "signed-in-example" }, examples("portal-signed-in", page)),
  );
}

/**
 * The step where the student authenticates with Duo as usual, until it lists
 * their devices: My Settings & Devices, or with the Universal Prompt, a page
 * with Add a device.
 */
export function authenticateStep(school: SetupSchool, page: SetupPage) {
  return div(
    p(
      { class: "intro" },
      "Authenticate with Duo as you normally would, with either a passcode or a push.",
    ),
    school.duoPrompt === "universal"
      ? p(
          { class: "signed-in-text" },
          "Press ",
          strong("Continue"),
          " once you land on the page with ",
          strong("Add a device"),
          ":",
        )
      : p(
          { class: "signed-in-text" },
          "Press ",
          strong("Continue"),
          " once you land on the ",
          strong("My Settings & Devices"),
          " page:",
        ),
    div({ class: "signed-in-example" }, examples("portal-settings", page)),
  );
}
