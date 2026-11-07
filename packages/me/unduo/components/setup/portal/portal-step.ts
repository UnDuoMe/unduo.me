import type {
  Screenshot,
  ScreenshotSet,
  SetupPage,
  SetupSchool,
} from "@-/me.unduo.components.setup.entities";
import {
  a,
  button,
  div,
  figcaption,
  figure,
  img,
  input,
  label,
  option,
  p,
  select,
  span,
  strong,
  type State,
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

/** A screenshot from the page's list, which shows once it's fetched and checked. */
export function screenshotImage(shot: Screenshot, page: SetupPage) {
  const image = img({ class: "screenshot", alt: shot.label });
  page.screenshot(image, shot);
  return image;
}

/** The institution's set in the page's screenshot list, once the list is loaded. */
export function screenshotsOf(school: SetupSchool, page: SetupPage): ScreenshotSet | undefined {
  return page.screenshots.val?.sets[school.screenshots];
}

/** A screenshot under its caption, if it has one. */
function captioned(shot: Screenshot, page: SetupPage, props: Record<string, string> = {}) {
  return figure(
    props,
    shot.caption ? figcaption({ class: "figure-caption" }, shot.caption) : null,
    screenshotImage(shot, page),
  );
}

/**
 * The institution the page shows, which the file's name picked: one of
 * `choices`, the last of which is Other.
 */
function schoolPicker(school: State<SetupSchool>, choices: readonly SetupSchool[]) {
  return div(
    { class: "school-picker" },
    label({ for: "school", class: "portal-label" }, "Your school"),
    select(
      {
        id: "school",
        class: "uk-select field",
        onchange: (event: Event) => {
          const id = (event.target as HTMLSelectElement).value;
          school.val = choices.find((choice) => choice.id === id) ?? school.val;
        },
      },
      choices.map((choice) =>
        option(
          { value: choice.id, selected: choice.id === school.rawVal.id },
          choice.name || "Other school or company",
        ),
      ),
    ),
  );
}

/**
 * The step that opens the Duo device portal: the institution, which the
 * student can change, its link if it has one, and what the portal shows once
 * the student is signed in. Other has no name, link or source.
 */
export function portalStep(
  school: State<SetupSchool>,
  choices: readonly SetupSchool[],
  page: SetupPage,
) {
  return div(
    p(
      { class: "intro" },
      "Sign in to your organization's Duo device portal, where you manage the phones and tablets on your account. You'll add unduo there as a new device.",
    ),
    schoolPicker(school, choices),
    () => schoolCard(school.val, page),
    p({ class: "signed-in-text" }, "Press ", strong("Continue"), " when you see a page like this:"),
    () =>
      div(
        { class: "signed-in-example" },
        (screenshotsOf(school.val, page)?.signedIn ?? []).map((shot) =>
          captioned(shot, page, {
            class: shot.size === "wide" ? "signed-in-wide" : "signed-in-narrow",
          }),
        ),
      ),
  );
}

/** The institution's portal link, note and source, or what to do without one. */
function schoolCard(school: SetupSchool, page: SetupPage) {
  return div(
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
    () => {
      const settings = screenshotsOf(school, page)?.settings;
      return div(
        { class: "signed-in-example" },
        !settings
          ? null
          : settings.caption
            ? captioned(settings, page)
            : screenshotImage(settings, page),
      );
    },
  );
}
