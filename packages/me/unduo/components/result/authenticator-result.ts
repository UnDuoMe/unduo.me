import type { SetupPage } from "@-/me.unduo.components.setup.entities";
import { a, aside, button, code, div, em, h3, img, p, span, strong } from "@-/me.unduo.lib.dom";
import { codeCheck } from "#code-check";

/** The last step: the time-based QR code, setup key, a code check and how to test it. */
export function authenticatorResult({ view, qr, send }: SetupPage) {
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
      ),
      div(
        { class: "result-details" },
        p(
          { class: "result-summary" },
          "Duo account for ",
          strong(van.derive(() => view.val.account?.customer ?? "")),
        ),
        h3({ class: "subheading" }, "Scan this with your authenticator app"),
        p({ class: "advice" }, "Time-based codes work in any authenticator app."),
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
          p({ class: "hint" }, "Time-based (TOTP) · 30 seconds · 6 digits · SHA-1"),
        ),
        // No button copies the key or its link: some systems sync the clipboard to the cloud.
      ),
    ),
    codeCheck({ view }),
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
        "Keep your existing Duo Mobile device registered as a backup, even after a code from your new authenticator works. If you lose your authenticator or its codes stop working, use your Duo device to sign in.",
      ),
    ),
  );
}
