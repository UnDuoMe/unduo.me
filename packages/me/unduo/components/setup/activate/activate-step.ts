import type { SetupPage } from "@-/me.unduo.components.setup.entities";
import { shortcutKeys } from "@-/me.unduo.components.setup.shortcuts";
import {
  aside,
  button,
  div,
  form,
  h3,
  iframe,
  input,
  label,
  li,
  ol,
  p,
  span,
  textarea,
} from "@-/me.unduo.lib.dom";

/** The longest reply crates/setup accepts (MAX_RESPONSE_LENGTH in response.rs). */
const maxResponseLength = 2_000_000;

const primary = "uk-button uk-button-primary btn-accent";

const textButton = "uk-button uk-button-text btn btn-inline";

/**
 * The step that posts the activation to Duo, then takes Duo's reply. Duo's reply
 * shows in a frame in the page, never a new tab, because browsers write a new
 * tab's address, which holds the code, to history. The frame is another origin's,
 * so the page can't read it: the student copies the reply across. (Browsers
 * refuse a drag from another origin's frame into the page.) Removing the frame
 * discards the reply, so `setupCard` keeps this step in the page through
 * earlier steps.
 */
export function activateStep(page: SetupPage) {
  const { view, text, send } = page;
  return div(
    aside(
      { class: "ready-note", role: "note" },
      h3({ class: "ready-title" }, "Get your 2FA app ready"),
      p(
        { class: "ready-text" },
        "After this step, you'll scan a QR code with your authenticator app, such as Google Authenticator, 1Password, 2FAS or Aegis.",
      ),
    ),
    // The native form stays connected while the browser starts its POST.
    form(
      {
        action: () => view.val.request?.url ?? "",
        method: "post",
        enctype: "application/x-www-form-urlencoded",
        target: "duo-reply",
        rel: "noopener noreferrer",
        onsubmit: page.submit,
        hidden: () => view.val.submitted,
      },
      () =>
        div(
          view.val.request?.fields.map(({ name, value }) =>
            input({ type: "hidden", name, value }),
          ) ?? [],
        ),
      p(
        { class: "intro" },
        "This registers unduo as a new Duo Mobile device on your account. Duo's reply appears in a box here, which you'll copy into the field under it.",
      ),
      button(
        {
          class: `${primary} wide`,
          type: "submit",
          disabled: () => !view.val.request,
        },
        van.derive(() => (view.val.request ? "Activate with Duo" : "Preparing…")),
      ),
      p(
        { class: "sent-note" },
        "Sent straight from your browser to ",
        span(van.derive(() => view.val.request?.host ?? "")),
        ". Each QR code works once.",
      ),
    ),
    form(
      {
        class: "stack-4",
        hidden: () => !view.val.submitted,
        onsubmit: (event: SubmitEvent) => {
          event.preventDefault();
          send({ type: "input", text: text.val });
        },
      },
      ol(
        {
          class: "reply-steps",
        },
        li(span("Click in the box, then select everything with "), shortcutKeys(page, "A")),
        li("Copy it with ", shortcutKeys(page, "C")),
        li(span("Click the field under the box and paste with "), shortcutKeys(page, "V")),
      ),
      p(
        { class: "hint" },
        "Duo's reply holds your new key. If your clipboard syncs to your other devices or keeps a history, as Windows can, clear it after pasting.",
      ),
      // Sandboxed with no permissions and no src: only the form above loads anything here.
      iframe({
        name: "duo-reply",
        sandbox: "",
        title: "Duo's reply",
        class: "reply-frame",
      }),
      div(
        { class: "stack-2" },
        label({ for: "duo-reply", class: "uk-form-label" }, "Paste Duo's reply here"),
        textarea({
          class: () => `uk-textarea field ${view.val.problem ? "uk-form-danger" : ""}`,
          value: text,
          oninput: (event: Event) => {
            text.val = (event.target as HTMLTextAreaElement).value;
          },
          "aria-invalid": () => String(!!view.val.problem),
          "aria-describedby": () =>
            view.val.problem ? "reply-description reply-error" : "reply-description",
          id: "duo-reply",
          placeholder: '{"response": {…}, "stat": "OK"}',
          rows: 4,
          autocomplete: "off",
          autocapitalize: "off",
          spellcheck: false,
          maxLength: maxResponseLength,
        }),
        p(
          { id: "reply-description", class: "hint" },
          "It contains your key, so it's read only in this page. The box empties when you go on to the next step.",
        ),
        p(
          {
            id: "reply-error",
            class: "uk-text-danger small",
            role: "alert",
            hidden: () => !view.val.problem,
          },
          van.derive(() => view.val.problem?.message ?? ""),
        ),
      ),
      div(
        { class: "row-2" },
        button(
          {
            type: "button",
            class: primary,
            hidden: () => !view.val.problem?.needsNewCode,
            onclick: () => send({ type: "startOver", step: 2 }),
          },
          "Use a new QR code",
        ),
        button(
          { class: primary, type: "submit", disabled: () => !text.val.trim() },
          "Create my authenticator",
        ),
      ),
      p(
        {
          class: "retry-note",
          hidden: () => !!view.val.problem,
        },
        span("Box still empty?"),
        button(
          {
            type: "button",
            class: textButton,
            onclick: page.retry,
          },
          "Activate again",
        ),
      ),
    ),
  );
}
