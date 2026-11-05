import { button, li, nav, ol, span } from "@-/me.unduo.lib.dom";
import type { State } from "@-/me.unduo.lib.dom";
import type { StepperStep } from "@-/me.unduo.components.stepper.entities";

interface Stepper {
  id: string;
  /** Names the navigation for screen readers. */
  label: string;
  /** The steps right now. How many there are doesn't change once the stepper is built. */
  steps: State<readonly StepperStep[]>;
  select: (index: number) => void;
}

const targetClass = "step-target";

/** One numbered step, which links to its step once it can be reached and isn't open. */
function stepItem({ steps, select }: Stepper, position: number) {
  const step = () => steps.val[position];
  const linked = van.derive(() => !!step()?.reachable && step()?.state !== "active");
  const label = () => [
    span(
      {
        class: "step-number",
        "aria-hidden": "true",
      },
      van.derive(() => (step()?.state === "complete" ? "✓" : (step()?.number ?? ""))),
    ),
    span(
      { class: "step-label" },
      van.derive(() => step()?.label ?? ""),
    ),
    span(
      { class: "sr-only" },
      van.derive(() => step()?.description ?? ""),
    ),
  ];
  return li(
    {
      class: "step-item",
      "data-state": () => step()?.state ?? "",
      "data-finished": () => String(!!step()?.finished),
      "aria-current": () => (step()?.state === "active" ? "step" : "false"),
    },
    () =>
      linked.val
        ? button(
            {
              type: "button",
              class: `${targetClass} step-link`,
              onclick: () => select(step()!.index),
            },
            label(),
          )
        : span({ class: targetClass }, label()),
  );
}

/** The numbered row of steps above a page's step card. */
export function stepper(props: Stepper) {
  return nav(
    { class: "step-progress", id: props.id, "aria-label": props.label },
    ol(
      { class: "step-list" },
      props.steps.rawVal.map((_, position) => stepItem(props, position)),
    ),
  );
}
