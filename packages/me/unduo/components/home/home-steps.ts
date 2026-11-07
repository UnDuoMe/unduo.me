import type { University } from "@-/me.unduo.data.universities.entities";
import {
  a,
  button,
  div,
  em,
  kbd,
  label,
  p,
  path,
  span,
  strong,
  svg,
  textarea,
} from "@-/me.unduo.lib.dom";
import { fileId, otherInstitution } from "@-/me.unduo.lib.universities";
import { aiPrompt } from "#ai-prompt";
import { type AiChoice, copyArt, downloadArt, dragArt, openArt } from "#how-art";

/** The Verify step's tabs, ChatGPT first and selected; `Other` has no link. */
const assistants: { id: AiChoice; name: string; href?: string }[] = [
  { id: "chatgpt", name: "ChatGPT", href: "https://chatgpt.com/" },
  { id: "claude", name: "Claude", href: "https://claude.ai/" },
  { id: "gemini", name: "Gemini", href: "https://gemini.google.com/" },
  { id: "other", name: "Other" },
];

/** The keys that open a new browser window: ⌘N on Apple devices, Ctrl+N elsewhere. */
const newWindowKeys = () => [
  kbd({ class: "key" }, /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"),
  kbd({ class: "key" }, "N"),
];

/**
 * Open an AI's link in a window of its own over the right of this one, so
 * these steps stay in view while the file is dragged across. Modified clicks,
 * and browsers that block the window, follow the link to a new tab as usual.
 */
function openWindow(event: MouseEvent) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.currentTarget as HTMLAnchorElement;
  const width = Math.min(760, Math.round(outerWidth / 2));
  const place = `width=${width},height=${outerHeight},left=${screenX + outerWidth - width},top=${screenY}`;
  const opened = window.open(link.href, "unduo-ai", `popup,${place}`);
  if (!opened) return;
  opened.opener = null;
  event.preventDefault();
}

/** An arrow out of a box: the link opens in a new window. */
const newTabIcon = () =>
  svg(
    { class: "button-icon", viewBox: "0 0 16 16", "aria-hidden": "true" },
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
 * a file. It never breaks across lines.
 */
const fileBadge = (name: string) =>
  span(
    { class: "file-badge" },
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
    name,
  );

/** The name a browser saves an institution's file under: `UnDuo - <name>.html`, or `UnDuo - Other.html`. */
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
            href: `./files/${fileId(school)}`,
            download: fileName(school),
          },
          fileName(school),
        ),
      ),
      p({ class: "home-step-text" }, "Next, we'll show you how to verify it's safe to use."),
    ),
  );
}

/** A clipboard: the button copies to it. */
const clipboardIcon = () =>
  svg(
    { class: "button-icon", viewBox: "0 0 16 16", "aria-hidden": "true" },
    path({
      d: "M5.5 2.5h-1a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-10a1 1 0 0 0-1-1h-1M6 1.5h4a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5ZM6 7.5h4M6 10h3",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.3",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }),
  );

/**
 * Step 2: the prompt that asks an AI whether the file is safe, which a button
 * copies to the clipboard for the next step. A drawing beside the text shows
 * the copy.
 */
export function promptStep(school: University) {
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
  return div(
    { class: "dialog-layout" },
    copyArt(),
    div(
      { class: "dialog-copy" },
      p(
        { class: "home-step-text" },
        "The prompt below validates that ",
        fileBadge(fileName(school)),
        " is safe to use.",
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
          {
            type: "button",
            class: "uk-button uk-button-primary btn-accent icon-button",
            onclick: copy,
          },
          clipboardIcon(),
          van.derive(() => (copied.val ? "Copied" : "Copy prompt to clipboard")),
        ),
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
  );
}

/**
 * Step 3: the downloaded file and the copied prompt go to an AI. Tabs choose
 * the AI, ChatGPT first: a drawing of dragging the file from the browser's
 * downloads into that AI sits beside the text, and a link opens it in a window
 * of its own, with ⌘N (or Ctrl+N) and its address as the fallback.
 */
export function verifyStep(school: University) {
  const selected = van.state(0);
  const assistant = van.derive(() => assistants[selected.val]!);
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
      // What to do depends on the AI, so the text rebuilds with the tab.
      () => {
        const choice = assistant.val;
        const file = fileBadge(fileName(school));
        if (!choice.href)
          return div(
            { class: "dialog-copy" },
            p(
              { class: "home-step-text" },
              "Open your favorite AI in a new window: press ",
              newWindowKeys(),
              " and type its address into the address bar.",
            ),
            p(
              { class: "home-step-text" },
              "Then press your browser's download button, drag ",
              file,
              " into it and paste in the prompt you copied.",
            ),
          );
        return div(
          { class: "dialog-copy" },
          p(
            { class: "home-step-text" },
            `Open ${choice.name} in a new window, press your browser's download button, then drag `,
            file,
            ` into ${choice.name} and paste in the prompt you copied.`,
          ),
          div(
            { class: "question-actions" },
            a(
              {
                class: "uk-button uk-button-default btn icon-button",
                href: choice.href,
                target: "_blank",
                rel: "noopener noreferrer",
                onclick: openWindow,
              },
              `Open ${choice.name}`,
              newTabIcon(),
              span({ class: "sr-only" }, " (opens in a new window)"),
            ),
          ),
          p(
            { class: "fallback-note" },
            "If that button doesn't work, press ",
            newWindowKeys(),
            " to open a new window and type ",
            em(new URL(choice.href).host),
            " into the address bar.",
          ),
        );
      },
    ),
  );
}

/**
 * Step 4: open the file, which takes over from here with its own steps, and
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
        "Open your Downloads and double click the ",
        fileBadge(fileName(school)),
        " file to open UnDuo's secure webpage.",
      ),
      p(
        { class: "home-step-text" },
        `Follow the webpage's instructions to set up a new 2FA app for ${school === otherInstitution ? "your organization" : school.name}.`,
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
