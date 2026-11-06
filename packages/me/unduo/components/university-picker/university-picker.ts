import { universities } from "@-/me.unduo.data.universities";
import type { University } from "@-/me.unduo.data.universities.entities";
import { div, input, label, li, p, path, span, svg, ul } from "@-/me.unduo.lib.dom";
import { searchUniversities } from "@-/me.unduo.lib.universities";

const optionId = (index: number) => `university-option-${index}`;
const place = (school: University) =>
  [school.stateProvince, school.country].filter(Boolean).join(", ") +
  (school.portalUrl ? " · Portal link available" : "");

/**
 * A searchable dropdown of the published institutions. Typing in the field
 * filters the list under it, the arrow keys move through the list, and Enter
 * or a click chooses one. Escape, Tab or a click elsewhere closes it.
 */
export function universityPicker(choose: (school: University) => void) {
  const query = van.state("");
  const open = van.state(false);
  const active = van.state(0);
  const choices = van.derive(() => searchUniversities(query.val));
  const count = universities.length.toLocaleString("en-US");

  const pick = (school: University | undefined) => {
    if (!school) return;
    open.val = false;
    query.val = "";
    choose(school);
  };
  /** Move the highlight by `step`, wrapping around, and keep it in view. */
  const move = (step: number) => {
    const length = choices.val.length;
    if (!length) return;
    active.val = (active.val + step + length) % length;
    setTimeout(() =>
      document.getElementById(optionId(active.val))?.scrollIntoView({ block: "nearest" }),
    );
  };

  const field = input({
    id: "university",
    class: "picker-input",
    type: "text",
    role: "combobox",
    placeholder: "Search for your university...",
    autocomplete: "off",
    spellcheck: false,
    "aria-autocomplete": "list",
    "aria-expanded": () => String(open.val),
    "aria-controls": "university-choices",
    "aria-describedby": "university-description",
    "aria-activedescendant": () => (open.val && choices.val.length > 0 ? optionId(active.val) : ""),
    value: query,
    oninput: (event: Event) => {
      query.val = (event.target as HTMLInputElement).value;
      active.val = 0;
      open.val = true;
    },
    onclick: () => {
      open.val = true;
    },
    onkeydown: (event: KeyboardEvent) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (open.val) move(event.key === "ArrowDown" ? 1 : -1);
        else {
          active.val = event.key === "ArrowDown" ? 0 : Math.max(0, choices.val.length - 1);
          open.val = true;
        }
      } else if (event.key === "Enter" && open.val) {
        event.preventDefault();
        pick(choices.val[active.val]);
      } else if (event.key === "Escape") {
        if (open.val) open.val = false;
        else query.val = "";
      } else if (event.key === "Tab") open.val = false;
    },
  });

  const picker = div(
    {
      id: "university-picker",
      class: "picker",
      "data-open": () => String(open.val),
      // Leaving the field and its list, by Tab or a click elsewhere, closes the list.
      onfocusout: (event: FocusEvent) => {
        if (!picker.contains(event.relatedTarget as Node | null)) open.val = false;
      },
    },
    label({ for: "university", class: "sr-only" }, "Select Your University"),
    div(
      {
        class: "picker-field",
        // A click on the icons opens or closes the list and keeps the cursor in the field.
        onmousedown: (event: MouseEvent) => {
          if (event.target === field) return;
          event.preventDefault();
          field.focus();
          open.val = !open.val;
        },
      },
      svg(
        { class: "picker-icon", viewBox: "0 0 20 20", "aria-hidden": "true" },
        path({
          d: "M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM16.5 16.5l-3.6-3.6",
          fill: "none",
          stroke: "currentColor",
          "stroke-width": "1.6",
          "stroke-linecap": "round",
        }),
      ),
      field,
      svg(
        { class: "picker-chevron", viewBox: "0 0 20 20", "aria-hidden": "true" },
        path({
          d: "M5.5 8l4.5 4.5L14.5 8",
          fill: "none",
          stroke: "currentColor",
          "stroke-width": "1.6",
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        }),
      ),
    ),
    div(
      { id: "university-dropdown", class: "picker-panel", hidden: () => !open.val },
      // The options rebuild only when the matches change; the highlight follows `active`.
      () =>
        ul(
          {
            id: "university-choices",
            class: "picker-list",
            role: "listbox",
            "aria-label": "Universities",
          },
          choices.val.map((school, index) =>
            li(
              {
                id: optionId(index),
                class: "picker-option",
                role: "option",
                "aria-selected": () => String(open.val && index === active.val),
                // Choosing keeps focus in the field until the dialog takes it.
                onmousedown: (event: MouseEvent) => event.preventDefault(),
                onmousemove: () => {
                  if (active.val !== index) active.val = index;
                },
                onclick: () => pick(school),
              },
              span({ class: "picker-name" }, school.name),
              span({ class: "picker-place" }, place(school)),
            ),
          ),
        ),
      p(
        { class: "picker-empty", role: "status", hidden: () => choices.val.length > 0 },
        "No matching university. Try another name or acronym.",
      ),
      p(
        { id: "university-description", class: "picker-hint" },
        `${count}${count === "1" ? " institution. " : " institutions. "}Directory inclusion does not confirm Duo use.`,
      ),
    ),
  );
  return picker;
}
