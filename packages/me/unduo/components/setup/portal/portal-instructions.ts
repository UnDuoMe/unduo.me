import type { SetupPage, SetupSchool } from "@-/me.unduo.components.setup.entities";
import { div, em, li, ol, span, strong } from "@-/me.unduo.lib.dom";

const instruction = "instruction";

/** The institution's example screenshots, copied from its set's `<template>`, which holds their URLs and pins. */
function screenshotFigures(set: string, { screenshot }: SetupPage) {
  const figures = (
    document.getElementById(`portal-screenshot-figures-${set}`) as HTMLTemplateElement
  ).content.cloneNode(true) as DocumentFragment;
  figures.querySelectorAll("img").forEach(screenshot);
  return figures;
}

/** What to choose in the portal until it shows a Duo Mobile QR code, in each design of Duo's pages. */
const choices = {
  traditional: ["Tablet", "Android", "I have Duo Mobile installed"],
  universal: ["Add a device", "Duo Mobile", "I have a tablet", "Next"],
};

/** How to add a device in the Duo portal and copy its QR code, with example screenshots. */
export function portalInstructions(school: SetupSchool, page: SetupPage) {
  const universal = school.duoPrompt === "universal";
  return div(
    ol(
      {
        class: "instructions",
      },
      li(
        { class: instruction },
        strong("Add a device:"),
        " choose ",
        ...(universal ? choices.universal : choices.traditional).flatMap((choice, index) =>
          index ? [" → ", em(choice)] : [em(choice)],
        ),
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
          universal
            ? "A screenshot works too, as does an activation link from “Get an activation link instead”."
            : "Copy Image Address works too, as does a screenshot or an emailed activation link.",
        ),
      ),
    ),
    div(
      {
        class: "screenshot-list",
        role: "group",
        "aria-label": "Duo portal example screenshots",
      },
      screenshotFigures(school.screenshots, page),
    ),
  );
}
