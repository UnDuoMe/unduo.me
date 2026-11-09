import type { SetupPage } from "@-/me.unduo.components.setup.entities";
import { button, div, form, h3, input, label, p } from "@-/me.unduo.lib.dom";
import { verifyCode } from "#verify-code";

/** A local check of the app's key, separate from trying a real Duo sign-in. */
export function codeCheck({ view }: Pick<SetupPage, "view">) {
  const entered = van.state("");
  const message = van.state("");
  const busy = van.state(false);
  const invalid = van.state(false);
  let attempt = 0;
  let lastSecret = "";
  function clear() {
    attempt++;
    busy.val = false;
    invalid.val = false;
    message.val = "";
  }
  van.derive(() => {
    // A new account or leaving this step also invalidates an unfinished check.
    const secret = view.val.account?.secret ?? "";
    if (secret === lastSecret) return;
    lastSecret = secret;
    clear();
    entered.val = "";
  });
  return form(
    {
      class: "stack-2",
      hidden: () => !view.val.account?.uri.startsWith("otpauth://totp/"),
      onsubmit: async (event: SubmitEvent) => {
        event.preventDefault();
        const id = ++attempt;
        const code = entered.val;
        const account = view.val.account;
        if (!account?.uri.startsWith("otpauth://totp/")) return;
        const key = account.secret;
        busy.val = true;
        invalid.val = false;
        message.val = "Checking…";
        try {
          const matches = await verifyCode(key, code);
          if (id !== attempt || key !== view.val.account?.secret) return;
          invalid.val = !matches;
          message.val = matches
            ? "Code matches — your app has the right setup key. Try a Duo sign-in below to confirm it works with your organization."
            : "That code doesn't match. Try a fresh code and check that your device's date and time are set automatically.";
        } catch {
          if (id === attempt)
            message.val =
              "Your browser couldn't check the code. Try a current browser, or test it at a Duo sign-in below.";
        } finally {
          if (id === attempt) busy.val = false;
        }
      },
    },
    h3({ class: "subheading" }, "Check your app's code"),
    p(
      { class: "body-note", id: "code-check-hint" },
      "Enter the six-digit code your authenticator shows. This check happens only in this tab; nothing is sent to Duo or anyone else.",
    ),
    div(
      { class: "stack-1" },
      label({ class: "uk-form-label", for: "authenticator-code" }, "6-digit code"),
      input({
        id: "authenticator-code",
        class: "uk-input",
        type: "text",
        inputmode: "numeric",
        autocomplete: "off",
        pattern: "[0-9]{6}",
        maxlength: 6,
        required: true,
        spellcheck: false,
        value: entered,
        "aria-describedby": "code-check-hint code-check-result",
        "aria-invalid": () => String(invalid.val),
        // The page's document-wide paste handler imports activation data. Let
        // this field receive its code through the browser's normal paste instead.
        onpaste: (event: ClipboardEvent) => event.stopPropagation(),
        oninput: (event: Event) => {
          clear();
          entered.val = (event.target as HTMLInputElement).value;
        },
      }),
    ),
    div(
      { class: "row-2" },
      button(
        {
          type: "submit",
          class: "uk-button uk-button-default btn",
          disabled: () => busy.val || !/^[0-9]{6}$/.test(entered.val),
        },
        "Check code",
      ),
    ),
    p(
      { class: "body-note", id: "code-check-result", role: "status", "aria-live": "polite" },
      message,
    ),
  );
}
