import type { SetupPage } from "@-/me.unduo.components.setup.entities";
import {
  a,
  aside,
  button,
  code,
  div,
  em,
  fieldset,
  h3,
  img,
  input,
  label,
  legend,
  p,
  span,
  strong,
} from "@-/me.unduo.lib.dom";

/** The last step: the `otpauth://` QR code, code type, setup key and how to test it. */
export function authenticatorResult({ view, qr, send, copy }: SetupPage) {
  const codeType = (type: "hotp" | "totp", name: string) =>
    label(
      {
        class: () => `code-type ${view.val.codeType === type ? "code-type-on" : "code-type-off"}`,
      },
      input({
        class: "uk-radio no-shrink",
        type: "radio",
        name: "code-type",
        value: type,
        checked: () => view.val.codeType === type,
        onchange: () => send({ type: "changeType", codeType: type }),
      }),
      name,
    );
  const advice = "advice";
  return div(
    { class: "stack-5" },
    div(
      {
        class: "result-layout",
      },
      div(
        { class: "qr-column" },
        div(
          {
            class: "qr-box",
          },
          () =>
            qr.val
              ? img({
                  class: "qr-image",
                  src: qr.val,
                  alt: () => view.val.account?.qrAlt ?? "",
                  width: 220,
                  height: 220,
                })
              : "",
          span(
            { role: "status", hidden: () => !!qr.val },
            van.derive(() =>
              qr.val === false ? "Use the setup key instead." : "Creating QR code…",
            ),
          ),
        ),
        fieldset(
          { class: "code-types" },
          legend({ class: "sr-only" }, "Code type"),
          codeType("hotp", "Counter-based"),
          codeType("totp", "Time-based"),
        ),
      ),
      div(
        { class: "result-details" },
        p(
          { class: "result-summary" },
          "Duo account for ",
          strong(van.derive(() => view.val.account?.customer ?? "")),
        ),
        h3({ class: "subheading" }, "Scan this with your authenticator app"),
        p(
          { class: advice, hidden: () => view.val.codeType !== "hotp" },
          "Use an app that supports ",
          strong("counter-based codes"),
          ", such as Google Authenticator, 2FAS, Aegis or FreeOTP. Tap refresh in the app whenever you need a new code.",
        ),
        p(
          { class: advice, hidden: () => view.val.codeType !== "totp" },
          "Time-based codes work in any authenticator app, but ",
          strong("only"),
          " if your organization switched Duo to time-based passcodes. Use them if counter-based codes are rejected.",
        ),
        a(
          {
            class: "uk-button uk-button-default btn touch-only",
            href: () => view.val.account?.uri ?? "",
          },
          "Open in authenticator app",
        ),
        div(
          {
            class: "stack-1",
            role: "group",
            "aria-label": () => (view.val.account?.revealed ? "Setup key" : "Setup key hidden"),
          },
          div(
            { class: "key-header" },
            span({ class: "uk-form-label" }, "Setup key"),
            button(
              {
                type: "button",
                class: "uk-button uk-button-text btn",
                onclick: () => send({ type: "reveal" }),
              },
              van.derive(() => (view.val.account?.revealed ? "Hide" : "Show")),
            ),
          ),
          code(
            {
              class: "setup-key",
            },
            van.derive(() => view.val.account?.key ?? ""),
          ),
          p(
            { class: "hint" },
            van.derive(() =>
              view.val.codeType === "hotp"
                ? "Counter-based (HOTP) · counter 0 · 6 digits · SHA-1"
                : "Time-based (TOTP) · 30 seconds · 6 digits · SHA-1",
            ),
          ),
        ),
        div(
          { class: "row-2" },
          button(
            {
              type: "button",
              class: "uk-button uk-button-default btn",
              onclick: () => copy("key"),
            },
            van.derive(() => (view.val.copied === "key" ? "Key copied" : "Copy key")),
          ),
          button(
            {
              type: "button",
              class: "uk-button uk-button-text btn",
              onclick: () => copy("uri"),
            },
            van.derive(() => (view.val.copied === "uri" ? "Link copied" : "Copy otpauth:// link")),
          ),
        ),
        p(
          { class: "hint", role: "alert", hidden: () => !view.val.copyError },
          "Clipboard access isn't available. Select the key above to copy it.",
        ),
        span(
          { class: "sr-only", role: "status" },
          van.derive(() =>
            view.val.copied === "key"
              ? "Setup key copied."
              : view.val.copied === "uri"
                ? "Link copied."
                : "",
          ),
        ),
      ),
    ),
    div(
      {
        class: "next-test",
      },
      h3({ class: "subheading" }, "Then test it"),
      p(
        { class: "body-note" },
        "Sign in somewhere that uses Duo, choose ",
        em("Other options"),
        " → ",
        em("Duo Mobile passcode"),
        " (or ",
        em("Enter a passcode"),
        "), and type the code your app shows.",
      ),
    ),
    aside(
      { class: "uk-alert-warning warning", role: "note" },
      h3({ class: "warning-title" }, "Add it now — unduo forgets the key when you close this tab"),
      p(
        { class: "warning-text" },
        "Keep your current Duo sign-in method until a code from your authenticator works.",
      ),
    ),
  );
}
