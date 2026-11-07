import { authenticatorResult } from "@-/me.unduo.components.result";
import { activateStep } from "@-/me.unduo.components.setup.activate";
import { linkStep } from "@-/me.unduo.components.setup.link";
import type { PluginLimits, SetupPlugin } from "@-/me.unduo.components.setup.plugin";
import { authenticateStep, portalStep } from "@-/me.unduo.components.setup.portal";
import { stepper } from "@-/me.unduo.components.stepper";
import { button, div, h2, p, section } from "@-/me.unduo.lib.dom";
import { setupLayout } from "#setup-layout";
import { createSetupPage } from "#setup-page";
import type { SetupPage, SetupSchool } from "#entities";

const primary = "uk-button uk-button-primary btn-accent at-end";
/** Where the page's links go home: it runs only as a file, so never a relative address. */
const home = "https://unduo.me/";

/** The stepper and the card for the current step, with Back, Next and Start over. */
function setupCard(page: SetupPage, school: SetupSchool) {
  const { view, send } = page;
  // The step's elements rebuild only when the step changes, not on every view.
  const current = van.derive(() => view.val.current);
  const steps = [
    () => portalStep(school, page),
    () => authenticateStep(school, page),
    () => linkStep(page, school),
    () => "",
    () => authenticatorResult(page),
  ];
  const activation = van.derive(
    () => view.val.current === 3 || (page.activated.val && view.val.current < 3),
  );
  return div(
    stepper({
      id: "setup-progress",
      label: "Setup progress",
      steps: van.derive(() => view.val.progress),
      select: (step) => send({ type: "goTo", step }),
    }),
    div(
      {
        class: "uk-card uk-card-default step-card",
        id: "setup-card",
      },
      section(
        { "aria-labelledby": "step-title" },
        h2(
          { class: "step-title", id: "step-title", tabindex: "-1" },
          van.derive(() => view.val.title),
        ),
        () => steps[current.val]?.() ?? "",
        // Removing a frame discards what it shows, so once Duo's reply may be in its frame,
        // this step stays in the page, hidden, through earlier steps.
        () =>
          activation.val ? div({ hidden: () => view.val.current !== 3 }, activateStep(page)) : "",
        div(
          { class: "step-nav" },
          button(
            {
              type: "button",
              class: "uk-button uk-button-text btn",
              hidden: () => view.val.current === 0,
              onclick: () => send({ type: "goTo", step: view.val.current - 1 }),
            },
            "Back",
          ),
          button(
            {
              type: "button",
              class: "uk-button uk-button-text btn at-end",
              hidden: () => view.val.current !== 4,
              onclick: () => send({ type: "startOver", step: 0 }),
            },
            "Start over",
          ),
          button(
            {
              type: "button",
              class: primary,
              hidden: () => !(view.val.current < 4 && view.val.furthest > view.val.current),
              onclick: () => send({ type: "goTo", step: view.val.current + 1 }),
            },
            van.derive(() => (view.val.current < 2 ? "Continue" : "Next")),
          ),
        ),
      ),
    ),
  );
}

/**
 * Start setup on a page the build wrote with `setupMount`. Its `#setup` element
 * holds the institution's details as data attributes and gets the alerts,
 * stepper and step card, and the rest of the page is built around it.
 */
export function startSetupPage(load: (limits: PluginLimits) => Promise<SetupPlugin>) {
  const host = document.getElementById("setup")!;
  const { schoolName = "", portalUrl, duoPrompt, schoolNote: note, sourceUrl = "" } = host.dataset;
  const school = { name: schoolName, portalUrl, duoPrompt, note, sourceUrl };
  const page = createSetupPage(load);
  const alert = "uk-alert-danger page-alert";
  van.add(
    host,
    p(
      { class: alert, role: "alert", hidden: () => !page.unenforced.val },
      "This browser doesn't enforce the page's security policy, so unduo won't start in it. Use a current version of Chrome, Edge, Firefox or Safari.",
    ),
    p(
      { class: alert, role: "alert", hidden: () => !page.failed.val },
      "unduo couldn't load its setup code, or it went over its limits. Check your connection, then reload the page, or change the limits under Advanced.",
    ),
    () => (page.started.val ? setupCard(page, school) : ""),
  );
  van.add(document.getElementById("root")!, setupLayout(page, schoolName, home, host));
}
