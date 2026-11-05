import type { SetupPage } from "@-/me.unduo.components.setup.entities";
import { shortcutKeys } from "@-/me.unduo.components.setup.shortcuts";
import {
  button,
  div,
  form,
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
 * shows in a frame rather than a new tab, because browsers write a new tab's
 * address, which holds the code, to history. Removing the frame discards the
 * reply, so `setupCard` keeps this step in the page through earlier steps.
 */
export function activateStep(page: SetupPage) {
  const { view, text, send, newTab } = page;
  return div(
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
      p(
        { class: "tab-note" },
        button(
          {
            type: "submit",
            formTarget: "_blank",
            class: textButton,
            disabled: () => !view.val.request,
          },
          "Open Duo's reply in a new tab instead",
        ),
        "Your browser history keeps a new tab's address, which holds the code. Use this if the box doesn't show the reply.",
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
        li(
          span(
            van.derive(() =>
              newTab.val
                ? "In the Duo tab, select everything with "
                : "Click in the box, then select everything with ",
            ),
          ),
          shortcutKeys(page, "A"),
        ),
        li("Copy it with ", shortcutKeys(page, "C")),
        li(
          span(
            van.derive(() =>
              newTab.val
                ? "Come back and paste it in the field below with "
                : "Click the field under the box and paste with ",
            ),
          ),
          shortcutKeys(page, "V"),
        ),
      ),
      // Sandboxed with no permissions and no src: only the form above loads anything here.
      iframe({
        name: "duo-reply",
        sandbox: "",
        title: "Duo's reply",
        class: "reply-frame",
        hidden: () => newTab.val,
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
          van.derive(
            () =>
              `It contains your key, so it's read only in this page. ${
                newTab.val
                  ? "Close the Duo tab afterwards."
                  : "The box empties when you go on to the next step."
              }`,
          ),
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
            onclick: () => send({ type: "startOver", step: 1 }),
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
        span(
          van.derive(() =>
            newTab.val
              ? "No Duo tab appeared? Your browser may have blocked it, so Duo never got the request."
              : "Box still empty? Try again, or open the reply in a new tab.",
          ),
        ),
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
