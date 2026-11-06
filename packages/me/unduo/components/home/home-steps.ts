import type { University } from "@-/me.unduo.data.universities.entities";
import {
  a,
  button,
  div,
  em,
  label,
  p,
  path,
  span,
  strong,
  svg,
  textarea,
} from "@-/me.unduo.lib.dom";
import { aiPrompt } from "#ai-prompt";
import { type AiChoice, downloadArt, dragArt, openArt } from "#how-art";

/** The Verify step's tabs, ChatGPT first and selected; `Other` has no link. */
const assistants: { id: AiChoice; name: string; href?: string }[] = [
  { id: "chatgpt", name: "ChatGPT", href: "https://chatgpt.com/" },
  { id: "claude", name: "Claude", href: "https://claude.ai/" },
  { id: "gemini", name: "Gemini", href: "https://gemini.google.com/" },
  { id: "other", name: "Other" },
];

/** An arrow out of a box: the link opens in a new tab. */
const newTabIcon = () =>
  svg(
    { class: "new-tab-icon", viewBox: "0 0 16 16", "aria-hidden": "true" },
    path({
      d: "M9.5 2.5h4v4M13.5 2.5 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.5",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }),
  );

/**
 * A file's name in a sentence, as a badge with a document icon so it reads as
 * a file. The icon keeps to the name's first word when the line wraps.
 */
const fileBadge = (name: string) => {
  const [first, ...rest] = name.split(" ");
  return span(
    { class: "file-badge" },
    span(
      { class: "file-badge-start" },
      svg(
        { class: "file-badge-icon", viewBox: "0 0 12 14", "aria-hidden": "true" },
        path({
          d: "M2 .75h5.25L10.25 3.75v8.5a1 1 0 0 1-1 1h-7.25a1 1 0 0 1-1-1V1.75a1 1 0 0 1 1-1ZM7 .75v3.25h3.25",
          fill: "none",
          stroke: "currentColor",
          "stroke-width": "1.2",
          "stroke-linejoin": "round",
        }),
      ),
      first,
    ),
    rest.length ? ` ${rest.join(" ")}` : "",
  );
};

/** The name a browser saves an institution's file under: `UnDuo - <name>.html`. */
const fileName = (school: University) =>
  `UnDuo - ${school.name.replace(/[\\/:*?"<>|]+/g, "-")}.html`;

/**
 * Step 1: the institution's file, which the student downloads but mustn't open
 * yet, because the next step has them audit it first. A drawing beside the
 * text shows where the browser lists the download.
 */
export function downloadStep(school: University) {
  return div(
    { class: "dialog-layout" },
    downloadArt(fileName(school)),
    div(
      { class: "dialog-copy" },
      p(
        { class: "home-step-text" },
        "Click the link below to download UnDuo's secure webpage, ",
        fileBadge(fileName(school)),
        ", ",
        em("but don't open it yet:"),
      ),
      // The link is the file's name, on a line of its own.
      p(
        { class: "home-step-text" },
        a(
          {
            class: "home-download",
            href: `./files/${school.id.slice(4)}`,
            download: fileName(school),
          },
          fileName(school),
        ),
      ),
      p({ class: "home-step-text" }, "Next, we'll show you how to verify it's safe to use."),
    ),
  );
}

/**
 * Step 2: the downloaded file goes to an AI with the prompt, which a button
 * copies. Tabs choose the AI, ChatGPT first: a drawing of dragging the file
 * from the browser's downloads into that AI sits beside the text, and a link
 * opens it.
 */
export function verifyStep(school: University) {
  const selected = van.state(0);
  const assistant = van.derive(() => assistants[selected.val]!);
  const copied = van.state(false);
  const copyFailed = van.state(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(aiPrompt);
      copyFailed.val = false;
      copied.val = true;
      setTimeout(() => {
        copied.val = false;
      }, 2500);
    } catch {
      copyFailed.val = true;
    }
  };
  const tabs: HTMLButtonElement[] = assistants.map((choice, index) =>
    button(
      {
        type: "button",
        role: "tab",
        id: `ai-tab-${choice.id}`,
        class: "ai-tab",
        "aria-controls": "ai-panel",
        "aria-selected": () => String(selected.val === index),
        tabindex: () => (selected.val === index ? "0" : "-1"),
        onclick: () => (selected.val = index),
        // Arrow keys, Home and End move between the tabs, as in any tab list.
        onkeydown: (event: KeyboardEvent) => {
          const last = assistants.length - 1;
          const moves: Record<string, number> = {
            ArrowLeft: index ? index - 1 : last,
            ArrowRight: index === last ? 0 : index + 1,
            Home: 0,
            End: last,
          };
          const next = moves[event.key];
          if (next === undefined) return;
          event.preventDefault();
          selected.val = next;
          tabs[next]!.focus();
        },
      },
      choice.name,
    ),
  );
  return div(
    div({ class: "ai-tabs", role: "tablist", "aria-label": "Your AI" }, tabs),
    div(
      {
        id: "ai-panel",
        class: "dialog-layout",
        role: "tabpanel",
        "aria-labelledby": () => `ai-tab-${assistant.val.id}`,
      },
      () => dragArt(fileName(school), assistant.val.id),
      div(
        { class: "dialog-copy" },
        p(
          { class: "home-step-text" },
          "Drag and drop ",
          fileBadge(fileName(school)),
          van.derive(
            () =>
              ` into ${assistant.val.href ? assistant.val.name : "your favorite AI"} and paste in this prompt:`,
          ),
        ),
        label({ for: "ai-question", class: "sr-only" }, "Prompt for the AI"),
        textarea(
          {
            class: "uk-textarea field question",
            id: "ai-question",
            rows: 3,
            readOnly: true,
            spellcheck: false,
            onfocus: (event: FocusEvent) => (event.target as HTMLTextAreaElement).select(),
          },
          aiPrompt,
        ),
        div(
          { class: "question-actions" },
          button(
            { type: "button", class: "uk-button uk-button-default btn", onclick: copy },
            van.derive(() => (copied.val ? "Copied" : "Copy prompt")),
          ),
          () => {
            const choice = assistant.val;
            return choice.href
              ? a(
                  {
                    class: "uk-button uk-button-default btn new-tab",
                    href: choice.href,
                    target: "_blank",
                    rel: "noopener noreferrer",
                  },
                  `Open ${choice.name}`,
                  newTabIcon(),
                  span({ class: "sr-only" }, " (opens in a new tab)"),
                )
              : "";
          },
        ),
        p(
          { class: "copied-note", role: "alert", hidden: () => !copyFailed.val },
          "Clipboard access isn't available. Select the prompt above to copy it.",
        ),
        span(
          { class: "sr-only", role: "status" },
          van.derive(() => (copied.val ? "Prompt copied." : "")),
        ),
      ),
    ),
  );
}

/**
 * Step 3: open the file, which takes over from here with its own steps, and
 * what to take away. A drawing beside the text shows the double click in the
 * browser's downloads.
 */
export function continueStep(school: University) {
  return div(
    { class: "dialog-layout" },
    openArt(fileName(school)),
    div(
      { class: "dialog-copy" },
      p(
        { class: "home-step-text" },
        "Once your AI has given the green light, double click ",
        fileBadge(fileName(school)),
        " to open UnDuo's secure webpage and follow its instructions.",
      ),
      p(
        { class: "home-step-text stay-safe" },
        em(
          strong("Remember:"),
          " Never trust any website with your sensitive school login credentials without a way for you to verify it's 100% safe. Stay safe out there!",
        ),
      ),
    ),
  );
}
