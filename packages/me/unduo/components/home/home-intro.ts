import {
  a,
  div,
  em,
  footer,
  h1,
  h3,
  header,
  li,
  ol,
  p,
  path,
  strong,
  svg,
} from "@-/me.unduo.lib.dom";

/** How UnDuo works, in the three steps the user wrote. */
export const steps = [
  "Get a new QR code from Duo.",
  "UnDuo converts it to a 2FA QR Code.",
  "Scan this 2FA QR Code with your favorite 2FA app.",
];

/** The page's name, what it's for, and that it's built to be secure. */
export function homeHeader() {
  return header(
    { class: "home-header" },
    h1({ class: "home-title" }, "UnDuo"),
    p(
      { class: "home-tagline" },
      "A ",
      strong("secure"),
      " way to use ",
      em("any"),
      " 2FA app for your school login.",
    ),
    p(
      { class: "home-subtext" },
      "UnDuo is a secure, single file that you can audit and use locally.",
    ),
  );
}

/** Where a student starts: a card holding the line that says so and the search for their university. */
export function homeStart(picker: HTMLElement) {
  return div(
    { class: "home-start" },
    p({ class: "home-start-text" }, "Select your university below to get started:"),
    picker,
  );
}

/** The page's footer: an email link to contact UnDuo, and a link to the source on GitHub. */
export function homeFooter() {
  return footer(
    { class: "home-footer" },
    a(
      { class: "home-contact", href: "mailto:contact@unduo.me" },
      svg(
        { class: "home-footer-icon", viewBox: "0 0 16 16", "aria-hidden": "true" },
        path({
          d: "M2.5 3.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1ZM2 4.5l6 4.5 6-4.5",
          fill: "none",
          stroke: "currentColor",
          "stroke-width": "1.4",
          "stroke-linejoin": "round",
        }),
      ),
      "contact@unduo.me",
    ),
    a(
      {
        class: "home-source",
        href: "https://github.com/UnDuoMe/unduo.me",
        target: "_blank",
        rel: "noreferrer",
        "aria-label": "Source on GitHub",
        title: "Source on GitHub",
      },
      svg(
        { class: "home-footer-icon", viewBox: "0 0 16 16", "aria-hidden": "true" },
        path({
          fill: "currentColor",
          d: "M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z",
        }),
      ),
      "GitHub",
    ),
  );
}

/**
 * The dialog's first step: how UnDuo works, in the three steps a student needs
 * to know before starting, and that the next step lets them check it.
 */
export function overviewStep() {
  return div(
    h3({ class: "home-heading" }, "How UnDuo Works:"),
    ol(
      { class: "instructions" },
      steps.map((text) => li({ class: "instruction" }, text)),
    ),
    p(
      { class: "home-secure" },
      "UnDuo is fully secure. Don't take our word for it. On the next step, you'll get to check for yourself (or with the help of AI).",
    ),
  );
}
