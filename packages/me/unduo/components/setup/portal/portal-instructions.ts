import type { SetupPage } from "@-/me.unduo.components.setup.entities";
import { div, em, li, ol, span, strong } from "@-/me.unduo.lib.dom";

const instruction = "instruction";

/** The example screenshots, copied from the page's `<template>`, which holds their URLs and pins. */
function screenshotFigures({ screenshot }: SetupPage) {
  const figures = (
    document.getElementById("portal-screenshot-figures") as HTMLTemplateElement
  ).content.cloneNode(true) as DocumentFragment;
  figures.querySelectorAll("img").forEach(screenshot);
  return figures;
}

/** How to add a device in the Duo portal and copy its QR code, with example screenshots. */
export function portalInstructions(page: SetupPage) {
  return div(
    ol(
      {
        class: "instructions",
      },
      li(
        { class: instruction },
        strong("Add a device:"),
        " choose ",
        em("Tablet"),
        " → ",
        em("Android"),
        " → ",
        em("I have Duo Mobile installed"),
        ".",
        span(
          { class: "instruction-note" },
          "Labels vary; any option that shows a Duo Mobile QR code works.",
        ),
      ),
      li(
        { class: instruction },
        strong("Copy the QR code:"),
        " right-click it and choose ",
        em("Copy Image"),
        ".",
        span(
          { class: "instruction-note" },
          "Copy Image Address works too, as does a screenshot or an emailed activation link.",
        ),
      ),
    ),
    div(
      {
        class: "screenshot-list",
        role: "group",
        "aria-label": "Duo portal example screenshots",
      },
      screenshotFigures(page),
    ),
  );
}
