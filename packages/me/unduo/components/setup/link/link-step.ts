import type { SetupPage } from "@-/me.unduo.components.setup.entities";
import { portalInstructions } from "@-/me.unduo.components.setup.portal";
import { shortcutKeys } from "@-/me.unduo.components.setup.shortcuts";
import { button, div, form, input, label, p } from "@-/me.unduo.lib.dom";

const secondary = "uk-button uk-button-default btn";

/** The step that takes the activation QR code: pasted, dropped, uploaded or scanned. */
export function linkStep(page: SetupPage) {
  const { view, text, dragging, send } = page;
  const upload = input({
    type: "file",
    accept: "image/*",
    hidden: true,
    onchange: page.upload,
  });
  return div(
    portalInstructions(page),
    div(
      {
        class: "drop-zone",
        "data-dragging": () => String(dragging.val),
        ondragover: (event: DragEvent) => {
          event.preventDefault();
          dragging.val = true;
        },
        ondragleave: (event: DragEvent) => {
          dragging.val = (event.currentTarget as Element).contains(event.relatedTarget as Node);
        },
        ondrop: (event: DragEvent) => {
          event.preventDefault();
          page.input(event.dataTransfer);
        },
      },
      form(
        {
          onsubmit: (event: SubmitEvent) => {
            event.preventDefault();
            send({ type: "input", text: text.val });
          },
        },
        div(
          { class: "stack-2" },
          label({ for: "activation-input", class: "subheading" }, "Paste the QR code here"),
          div(
            {
              class: "link-row",
            },
            input({
              class: () => `uk-input field grow ${view.val.linkError ? "uk-form-danger" : ""}`,
              value: text,
              oninput: (event: Event) => {
                text.val = (event.target as HTMLInputElement).value;
                send({ type: "editLink" });
              },
              disabled: () => view.val.linkBusy === "scan",
              "aria-invalid": () => String(!!view.val.linkError),
              "aria-describedby": () =>
                view.val.linkError
                  ? "activation-description activation-error"
                  : "activation-description",
              id: "activation-input",
              placeholder: "Paste the copied QR code, its address, or an activation link",
              autocomplete: "off",
              autocapitalize: "off",
              spellcheck: false,
            }),
            button(
              {
                class: "uk-button uk-button-primary btn-accent link-submit",
                type: "submit",
                disabled: () => !text.val.trim() || !!view.val.linkBusy,
              },
              "Continue",
            ),
          ),
          p(
            { id: "activation-description", class: "hint" },
            "Press ",
            shortcutKeys(page, "V"),
            " anywhere on this page, or drop a screenshot here.",
          ),
          p(
            {
              id: "activation-error",
              class: "uk-text-danger small",
              role: "alert",
              hidden: () => !view.val.linkError,
            },
            van.derive(() => view.val.linkError),
          ),
        ),
      ),
      div(
        { class: "link-actions" },
        button(
          {
            type: "button",
            class: secondary,
            disabled: () => !!view.val.linkBusy,
            onclick: () => upload.click(),
          },
          "Upload a screenshot",
        ),
        button(
          {
            type: "button",
            class: secondary,
            hidden: () => !(view.val.canScan && view.val.linkBusy !== "scan"),
            disabled: () => !!view.val.linkBusy,
            onclick: page.scan,
          },
          "Scan my screen",
        ),
        button(
          {
            type: "button",
            class: secondary,
            hidden: () => !(view.val.canScan && view.val.linkBusy === "scan"),
            onclick: page.stopScan,
          },
          "Stop sharing",
        ),
        upload,
      ),
      p(
        {
          class: "scan-note",
          role: "status",
          hidden: () =>
            !(
              view.val.linkBusy === "image" ||
              view.val.linkBusy === "prepare" ||
              view.val.scanNote
            ),
        },
        van.derive(() =>
          view.val.linkBusy === "image"
            ? "Reading the QR code…"
            : view.val.linkBusy === "prepare"
              ? "Preparing your request…"
              : view.val.scanNote,
        ),
      ),
    ),
  );
}
