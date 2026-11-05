import type { SetupPage } from "@-/me.unduo.components.setup.entities";
import { defaultPluginLimits } from "@-/me.unduo.components.setup.plugin";
import { button, details, div, input, label, p, summary } from "@-/me.unduo.lib.dom";

const { maxPages, timeoutMs } = defaultPluginLimits;

/** The Advanced panel: limits for the setup code, which apply when setup restarts. */
export function pluginLimits({ limits, restart }: SetupPage) {
  const fields = [
    {
      key: "maxPages",
      value: limits.maxPages,
      name: "Memory pages",
      hint: `64 KiB each. Default ${maxPages} (${(maxPages * 64) / 1024} MiB).`,
    },
    {
      key: "timeoutMs",
      value: limits.timeoutMs,
      name: "Time per call (ms)",
      hint: `Default ${timeoutMs} (${timeoutMs / 1000} seconds).`,
    },
  ];
  return details(
    { class: "wide", id: "plugin-limits" },
    summary({ class: "summary-label" }, "Advanced"),
    div(
      {
        class: "limits-panel",
        role: "group",
        "aria-labelledby": "plugin-limits-note",
      },
      p(
        { class: "limits-note", id: "plugin-limits-note" },
        "Limits for unduo's setup code. Each call that goes over one stops setup. Applying new limits restarts setup and clears anything in progress.",
      ),
      div(
        { class: "limits-grid" },
        fields.map(({ key, value, name, hint }) =>
          div(
            { class: "limit" },
            label({ class: "medium", for: `limit-${key}` }, name),
            input({
              class: "uk-input field",
              id: `limit-${key}`,
              type: "number",
              min: "1",
              step: "1",
              required: true,
              value,
              oninput: (event: Event) => {
                value.val = (event.target as HTMLInputElement).value;
              },
              "aria-describedby": `limit-${key}-hint`,
            }),
            p({ class: "hint", id: `limit-${key}-hint` }, hint),
          ),
        ),
      ),
      div(
        button(
          {
            type: "button",
            class: "uk-button uk-button-default btn",
            onclick: restart,
            disabled: () => !(Number(limits.maxPages.val) > 0 && Number(limits.timeoutMs.val) > 0),
          },
          "Apply and restart",
        ),
      ),
    ),
  );
}
