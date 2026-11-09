import { button, code, div, h2, h3, li, ol, p, path, pre, strong, svg } from "@-/me.unduo.lib.dom";
import { terminalCommands } from "#terminal-commands";

/** How unduo works: the steps and its limits. */
function guide() {
  return div(
    { class: "dialog-body" },
    p(
      "Duo Mobile is an ordinary one-time-passcode app inside. When you add a device, Duo hands the new device a secret key. unduo registers itself as that device and gives the key to the authenticator app you prefer.",
    ),
    ol(
      { class: "dialog-list" },
      li(
        strong("Get a QR code."),
        " In your Duo device portal, add a tablet with Duo Mobile. Copy the QR code it shows and paste it here.",
      ),
      li(
        strong("Activate."),
        " unduo sends the activation to Duo. Copy Duo's reply from the box and paste it under it. Each QR code works only once.",
      ),
      li(
        strong("Add it to your app."),
        " Scan the new QR code, then test a passcode on any Duo sign-in.",
      ),
    ),
    h3({ class: "dialog-heading" }, "Which authenticator apps work?"),
    p(
      "unduo makes time-based (TOTP) codes, which every authenticator app supports. If your organization's Duo uses counter-based codes instead, unduo says “Your organization's Duo is using an unsupported setting :(” and makes no QR code. Test a passcode on a Duo sign-in after adding it to your app.",
    ),
    h3({ class: "dialog-heading" }, "Keep a backup"),
    p(
      "Keep your existing Duo Mobile device registered as a backup, even after your new authenticator works. It gives you another way to sign in if you lose your authenticator or its codes stop working.",
    ),
    h3({ class: "dialog-heading" }, "What it can't do"),
    p(
      "Duo Push approvals aren't supported, only passcodes. Your organization must allow adding devices and passcode sign-ins.",
    ),
  );
}

/** What the page sends, keeps and loads. */
function privacy() {
  return div(
    { class: "dialog-body" },
    p(
      "unduo is a static web page. There is no unduo server that sees your activation code, Duo's reply, or your key.",
    ),
    p(
      "Your browser sends the activation directly to Duo, and Duo's reply shows in a box on this page. You copy it across, and this page turns it into a QR code. Pasted images and shared screens are decoded locally and never uploaded or recorded.",
    ),
    p(
      "Your activation code, Duo's reply and your key stay in this tab's memory. This page never puts them in its address or in browser storage, so refreshing or closing the tab clears them, and your browser asks before you leave. Its address doesn't change while you set up. Duo's reply opens in a box rather than a new tab, so the activation code stays out of your browser history. On a computer you share, use a private window.",
    ),
    p(
      `There are no accounts, analytics or cookies. All of this page's code is in the page itself, apart from its setup plugin. Your browser downloads the plugin, styles and images from jsDelivr, which receives ordinary request details such as your IP address but none of your codes or keys. Your authenticator app decides how your key is stored after that.`,
    ),
    p(
      `This page runs from the file you downloaded. It loads its setup plugin, styles and images from hash-pinned jsDelivr files. To skip unduo's code entirely, use the commands under `,
      strong("Terminal"),
      ", at the bottom of the page.",
    ),
  );
}

/** The commands that do the same setup without this page. */
function terminal() {
  return div(
    { class: "dialog-body-single" },
    p(
      "These macOS or Linux commands do what this page does with curl, openssl and python3 instead of unduo's code. Duo's reply stays in your terminal.",
    ),
    p(
      strong("1."),
      " Copy the QR code's image address. Set ",
      code("host"),
      " to its ",
      code("api-…"),
      " host and ",
      code("code"),
      " to the letters and digits after the last ",
      code("value="),
      ", ",
      code("duo%3A%2F%2F"),
      " or ",
      code("activate%2F"),
      ", up to any ",
      code("-"),
      " or ",
      code("&"),
      ".",
    ),
    pre({ class: "command" }, terminalCommands.values),
    p(strong("2."), " Register a device. openssl keeps only the public key. Each code works once."),
    pre({ class: "command" }, terminalCommands.activate),
    p(
      strong("3."),
      " Print your key and ",
      code("otpauth://"),
      " link. Add the key to your app as time-based, or show the link as a QR code with ",
      code("qrencode -t ansiutf8 '…'"),
      ". If Duo didn't turn on time-based codes, it prints the unsupported-setting message instead. Close the terminal when you're done.",
    ),
    pre({ class: "command" }, terminalCommands.account),
    p(
      "Test a passcode on a Duo sign-in, and keep your existing Duo Mobile device registered as a backup even after your new authenticator works. It gives you another way to sign in if you lose access to your authenticator.",
    ),
  );
}

const dialogs = {
  guide: { label: "How it works", title: "How unduo works", content: guide },
  privacy: { label: "Privacy", title: "Privacy, plainly", content: privacy },
  terminal: { label: "Terminal", title: "Set it up in a terminal", content: terminal },
};

/** A button that opens a help dialog, a native popover the browser opens and closes. */
export function setupHelpButton(mode: keyof typeof dialogs) {
  const id = `setup-${mode}`;
  const { label, title, content } = dialogs[mode];
  return [
    button(
      {
        type: "button",
        class: "uk-button uk-button-text btn small",
        popovertarget: id,
      },
      label,
    ),
    div(
      {
        id,
        popover: "auto",
        role: "dialog",
        "aria-labelledby": `${id}-title`,
        class: "dialog",
      },
      button(
        {
          type: "button",
          class: "uk-modal-close-default uk-close",
          popovertarget: id,
          popovertargetaction: "hide",
          "aria-label": "Close",
          autofocus: true,
        },
        svg(
          { width: "14", height: "14", viewBox: "0 0 14 14", "aria-hidden": "true" },
          path({ d: "M1 1l12 12M13 1L1 13", stroke: "currentColor", "stroke-width": "1.4" }),
        ),
      ),
      div(
        { class: "dialog-header" },
        h2({ id: `${id}-title`, class: "uk-modal-title dialog-title" }, title),
      ),
      div(content()),
      div(
        { class: "dialog-actions" },
        button(
          {
            type: "button",
            class: "uk-button uk-button-default btn",
            popovertarget: id,
            popovertargetaction: "hide",
          },
          "Got it",
        ),
      ),
    ),
  ];
}
