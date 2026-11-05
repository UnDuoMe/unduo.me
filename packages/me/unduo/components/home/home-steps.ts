import type { University } from "@-/me.unduo.data.universities.entities";
import { a, button, div, label, p, span, strong, textarea } from "@-/me.unduo.lib.dom";
import { aiPrompt } from "#ai-prompt";

const assistants = [
  { name: "ChatGPT", href: "https://chatgpt.com/" },
  { name: "Claude", href: "https://claude.ai/" },
  { name: "Gemini", href: "https://gemini.google.com/" },
];

/** The name a browser saves an institution's file under. */
const fileName = (school: University) => `${school.name.replace(/[\\/:*?"<>|]+/g, "-")}.html`;

/**
 * Step 2: the institution's file, which the student downloads but mustn't open
 * yet, goes to an AI with the prompt, which a button copies.
 */
export function verifyStep(school: University) {
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
    p(
      { class: "home-step-text" },
      `Download the file for ${school.name}, but `,
      strong("DO NOT RUN IT"),
      " (yet).",
    ),
    a(
      {
        class: "uk-button uk-button-primary btn-accent home-download",
        href: `./files/${school.id.slice(4)}`,
        download: fileName(school),
      },
      `Download ${fileName(school)}`,
    ),
    p(
      { class: "home-step-text" },
      `Then drag and drop ${fileName(school)} into your favorite AI and copy this prompt:`,
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
      assistants.map((assistant) =>
        a(
          {
            class: "uk-button uk-button-default btn",
            href: assistant.href,
            target: "_blank",
            rel: "noopener noreferrer",
          },
          `Open ${assistant.name}`,
        ),
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
  );
}

/** Step 3: open the file, which takes over from here with its own steps, and what to take away. */
export function continueStep(school: University) {
  return div(
    p(
      { class: "home-step-text" },
      `Once your AI has given the thumbs up, double click ${fileName(school)} and follow its further instructions. If it doesn't, don't open the file.`,
    ),
    p({ class: "note" }, "It runs in your browser and starts at the Duo portal step."),
    p(
      { class: "home-step-text stay-safe" },
      strong(
        "Never trust any website with your sensitive school data without a way to fully audit and verify it, even if they claim to be secure.",
      ),
    ),
  );
}
