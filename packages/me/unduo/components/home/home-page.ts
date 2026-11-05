import { universityPicker } from "@-/me.unduo.components.university-picker";
import type { University } from "@-/me.unduo.data.universities.entities";
import { button, dialog, div, h2, main, p, path, section, svg } from "@-/me.unduo.lib.dom";
import { findUniversity } from "@-/me.unduo.lib.universities";
import { homeHeader, homeSource, overviewStep } from "#home-intro";
import { aiTestimonials, getStarted, howItWorks } from "#home-landing";
import { continueStep, verifyStep } from "#home-steps";

/** The dialog's steps once an institution is chosen. `id` names a step in the URL. */
const steps = [
  { id: "overview", title: "Overview" },
  { id: "verify", title: "Verify" },
  { id: "continue", title: "Continue" },
];

/** Steps that earlier versions of the page named in links, and where they lead now. */
const renamed: Record<string, string> = {
  university: "overview",
  download: "verify",
  check: "verify",
  open: "continue",
  safe: "continue",
};

/**
 * What the URL names: `?university=` holds the institution, whose dialog is open,
 * and `#step=` the dialog's step, the overview when it names none. Without a
 * published institution the dialog is closed.
 */
function fromUrl() {
  const school = findUniversity(
    new URLSearchParams(window.location.search).get("university") ?? undefined,
  );
  const named = new URLSearchParams(window.location.hash.slice(1)).get("step") ?? "";
  const index = steps.findIndex(({ id }) => id === (renamed[named] ?? named));
  return { school, current: school && index >= 0 ? index : 0 };
}

/**
 * Build the home page in its `#root`, a landing page: the name, what UnDuo is
 * for and a searchable dropdown of institutions, filling the first screen; then
 * what ChatGPT, Claude and Gemini said about a file, how UnDuo works, a way back
 * to the search, and a link to the source. Choosing an institution opens a
 * dialog that takes it from an overview to opening its file, which has its own
 * stepper for setup.
 */
export function startHomePage() {
  const homeTitle = document.title;
  const start = fromUrl();
  const selected = van.state<University | undefined>(start.school);
  const current = van.state(start.current);
  /** The search field, which takes focus back when the dialog closes. */
  const focusSearch = () => document.getElementById("university")?.focus();
  /** Bring the search back into view from further down the page, then focus it. */
  const toSearch = () => {
    const field = document.getElementById("university");
    field?.scrollIntoView({ block: "center" });
    field?.focus({ preventScroll: true });
  };

  /** After the step's elements update, as the setup file does. */
  const focusStep = () => setTimeout(() => document.getElementById("step-title")?.focus());
  const showUrl = () => {
    const { school, current: step } = fromUrl();
    selected.val = school;
    current.val = step;
    document.title = school ? `Download UnDuo for ${school.name}` : homeTitle;
    if (school && !homeDialog.open) {
      homeDialog.showModal();
      focusStep();
    } else if (!school && homeDialog.open) homeDialog.close();
  };
  /** A new address: an institution's dialog at a step, or the page with the dialog closed. */
  const navigate = (address: string) => {
    window.history.pushState(null, "", address);
    showUrl();
  };
  const goTo = (index: number, school = selected.val) => {
    if (!school) return;
    navigate(`?university=${school.id}#step=${steps[index]!.id}`);
    focusStep();
  };
  /** Choosing an institution opens its dialog at the overview. */
  const choose = (school: University) => goTo(0, school);

  const homeDialog = dialog(
    {
      id: "home-dialog",
      class: "dialog",
      "aria-labelledby": "step-title",
      // Escape, the close button and Done all leave the dialog for the page, and the address follows.
      onclose: () => {
        if (fromUrl().school) navigate(window.location.pathname);
        focusSearch();
      },
    },
    button(
      {
        type: "button",
        class: "uk-modal-close-default uk-close",
        "aria-label": "Close",
        onclick: () => homeDialog.close(),
      },
      svg(
        { width: "14", height: "14", viewBox: "0 0 14 14", "aria-hidden": "true" },
        path({ d: "M1 1l12 12M13 1L1 13", stroke: "currentColor", "stroke-width": "1.4" }),
      ),
    ),
    p({ class: "dialog-school" }, () => selected.val?.name ?? ""),
    h2(
      { class: "dialog-title step-title", id: "step-title", tabindex: "-1" },
      van.derive(() => steps[current.val]!.title),
    ),
    // A step's elements rebuild only when the step or the institution changes.
    () => {
      const school = selected.val;
      if (!school || current.val === 0) return overviewStep();
      return current.val === 1 ? verifyStep(school) : continueStep(school);
    },
    div(
      { class: "step-nav" },
      button(
        {
          type: "button",
          class: "uk-button uk-button-text btn",
          hidden: () => current.val === 0,
          onclick: () => goTo(current.val - 1),
        },
        "Back",
      ),
      button(
        {
          type: "button",
          // Downloading is the Verify step's main action, not moving on.
          class: () =>
            current.val === 1
              ? "uk-button uk-button-default btn at-end"
              : "uk-button uk-button-primary btn-accent at-end",
          onclick: () =>
            current.val === steps.length - 1 ? homeDialog.close() : goTo(current.val + 1),
        },
        van.derive(() => (current.val === steps.length - 1 ? "Done" : "Continue")),
      ),
    ),
  );

  window.addEventListener("popstate", () => {
    showUrl();
    focusStep();
  });

  van.add(
    document.getElementById("root")!,
    div(
      { class: "home-page" },
      main(
        { class: "home-landing" },
        section(
          { class: "home-hero" },
          div(
            { class: "home-center" },
            homeHeader(),
            div({ class: "home-main" }, universityPicker(choose)),
          ),
        ),
        aiTestimonials(),
        howItWorks(),
        getStarted(toSearch),
      ),
      homeSource(),
      homeDialog,
    ),
  );
  showUrl();
}
