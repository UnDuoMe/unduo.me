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

/** What Duo shows once the student is signed in, copied from the page's `<template>`, which holds its URL and pin. */
function signedInExample({ screenshot }: SetupPage) {
  const example = (
    document.getElementById("portal-signed-in") as HTMLTemplateElement
  ).content.cloneNode(true) as DocumentFragment;
  example.querySelectorAll("img").forEach(screenshot);
  return example;
}

/**
 * The step that opens the Duo device portal, with the institution's link if it
 * has one, and what the portal shows once the student is signed in.
 */
export function portalStep(school: SetupSchool, page: SetupPage) {
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
            "We don't have a verified Duo portal link for this institution. It may use another MFA provider. Ask your IT help desk where to manage your Duo devices.",
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
    p({ class: "signed-in-text" }, "Press ", strong("Continue"), " when you see a page like this:"),
    div({ class: "signed-in-example" }, signedInExample(page)),
  );
}
