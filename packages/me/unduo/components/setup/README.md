# @-/me.unduo.components.setup

The authenticator setup UI in an institution's file. A numbered stepper sits
above one card that shows the open step. Steps already reached are buttons in
the stepper; the card footer has **Back**, **Next** (when a later step is
already done) and, on the last step, **Start over**. Browser Back and Forward
move between steps too, and focus moves to the opened step's heading.

It runs only from a file on the student's computer; the home page offers the download. It has
five steps:

1. **Open your Duo device portal** (`portalStep`). The institution's verified
   portal when known, then an example of what Duo shows once you're signed in
   in a narrow and a wide window (`setup-0-signed-in-narrow.webp` and
   `setup-0-signed-in-wide.webp`, with only the device's name and number
   blurred): press **Continue** when you see a page like it. A file for a
   portal on Duo's Universal Prompt (`data-duo-prompt="universal"`, Waterloo's)
   shows Waterloo's prompt instead (`setup-0-signed-in-universal.webp`).
2. **Authenticate with Duo** (`authenticateStep`). Authenticate as usual, with a
   passcode or a push, and press **Continue** on Duo's My Settings & Devices page,
   shown in `setup-0-settings-devices.webp` (with only the devices'
   names and numbers blurred), or on the Universal Prompt, the page with
   **Add a device** (`setup-0-settings-devices-universal.webp`).
3. **Copy the activation QR code** (`linkStep`). How to add a device, an
   example screenshot of each click, and one input. Anything pasted anywhere on the page
   (from the portal step too) is routed by the
   setup plugin: a copied QR image (its `<img src>` is preferred when present),
   an image address, a `duo://` or activation link, or even Duo's reply. Dropped
   and uploaded screenshots and **Scan my screen** use the same path, except that
   a scan that finds Duo's code stops sharing, puts the code's text in the field
   with a success note under it, and waits for **Continue**. Problems with the
   input are shown on this step.
4. **Activate with Duo.** A note at the top tells the user to get their 2FA app
   ready to scan a QR code next. A native form submits directly to Duo, into a sandboxed
   frame on the page, so the address that holds the code stays out of browser
   history; nothing opens it in a new tab. The reply is pasted across; browsers
   refuse a drag from another origin's frame into the page. A note says Duo's reply
   holds the new key, so a clipboard that syncs or keeps a history should be
   cleared after pasting. Duo errors explain whether a new QR code is needed. If the frame stays empty, the
   user can activate again. **Use a new QR code** clears the used code and returns
   to step 3.
5. **Add it to your authenticator.** The authenticator result template shows the QR,
   key (no copy buttons: some systems sync the clipboard to the cloud), defaulting
   to counter-based (HOTP) codes.

## Usage

Import the documented public API from `@-/me.unduo.components.setup`. Package-local modules use `#...` imports.

## API

```ts
export { startSetupPage } from "#setup-app";
```

The build writes each page's mount through `@-/me.unduo.components.setup/server`:

```ts
setupMount({ universities, screenshot, asset });
```

That is the `#setup` element and the `#setup-schools` template, whose elements hold each
institution's details as data attributes for the script to read, including the name of its set
of example screenshots. The file names no screenshot: `asset` publishes the screenshot list,
`screenshots.<hash>.json`, with the setup files' assets, and `#setup`'s
`data-screenshots-url` and `data-screenshots-integrity` pin it by its SHA-256. The list gives
each set's screenshots, their text, and their files and SHA-256s, which `screenshot` resolves;
the page fetches the list, then the shown institution's screenshots from the same folder, each
only if its SHA-256 matches, and the CSP allows fetches only from that assets commit's folder.
The script picks the institution whose name the file's own name holds (`schoolFromPath` in
`school-choice.ts`: `UnDuo - <name>.html`, even with a browser's ` (1)` or ` 2`), or Other, and
the first step's **Your school** menu changes it. It fetches all of an institution's
screenshots as soon as it's shown, never step by step, so when they load says nothing about the
setup. In the self-contained experiment the list is `#setup`'s `data-screenshots`, with each
screenshot a `data:` URL. The file links home to `https://unduo.me/`. The adapter calls `startSetupPage(load)`,
which builds the alerts, stepper and step card in `#setup` and the header, introduction, help
dialogs, footer and Advanced panel around it with VanJS, where `load(limits)` calls
`loadSetupPlugin(url, integrity, limits)` with the root element's
`data-plugin-url` and `data-plugin-integrity`. The page
loads the plugin with `defaultPluginLimits` at once. The footer's Advanced panel
from the `limits` package edits `limits`, and `restart()` loads a fresh plugin
with them and starts setup over, ignoring any output still due from the old
one.

## The plugin and the host

The flow's logic is the Rust setup plugin in [`crates/setup`](../../../../../crates/setup),
loaded by the nested `plugin` package. The plugin keeps the page's state in its
own memory. `setup-page.ts` is its browser host: it sends each browser event to
the plugin's `update`, keeps the returned `view` for the steps to show, and performs the returned
effects (generate a key, read the QR codes in an image or a
screen frame with `readQrCodes` from `@-/me.unduo.lib.qr-reader` and send their
text, stop sharing, set the text field, move focus, send an event later). The
plugin never receives pixels. The authenticator QR code is drawn by `qr-code.ts`,
the page's own encoder, from the guarded link. Steps call `send({ type, … })` directly
for clicks, so the host has no per-action methods.

Every output first passes the guard in `plugin/setup-plugin.ts`, the one place
that checks plugin output. It checks the Duo form and the
authenticator link, and throws on a violation; the host then
stops sharing, removes the steps and shows an error. The steps set everything
else as text, booleans and classes, and nothing writes HTML. The CSP already
limits forms to Duo and fetches to the plugin's file. **Stop sharing** stops
the capture in the host before telling the plugin, and the browser's own
sharing controls always work.

## Subpackages

The root package composes the page and owns its host and stylesheet.
Feature packages export functions that build their elements and declare their own dependencies:

- `plugin`: the committed `setup.wasm`, its loader and kernel, the security guard and message types.
- `portal`: device portal guidance and enrollment screenshots.
- `link`: QR input markup.
- `activate`: Duo submission and reply form markup.
- `help`: help and privacy popovers.
- `shortcuts`: keyboard shortcut hints shared by the input steps.

The `activate`, `link` and `plugin` packages keep shared types in their own nested
`+entities` packages.

## Where state lives

| State                                     | Where            | Why                                                                                                           |
| ----------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------- |
| Current step and code type                | Plugin memory    | The address never changes during setup, so nothing the plugin decides reaches history or browser sync         |
| WHED institution ID                       | Document path    | Shareable institution page                                                                                    |
| Activation value, submitted flag, account | Plugin memory    | Secret: never in this page's links, history or browser storage; the Duo frame's URL holds the activation code |
| Errors, busy state, scan notes, Duo form  | Plugin memory    | Short-lived                                                                                                   |
| Typed link or reply, pending image        | Host (in memory) | Short-lived                                                                                                   |

The page changes its address once, when it opens and before anything is
pasted: `history.replaceState` drops any query or hash. It never changes the
address after that, and it adds no history entries, so links, history and
browser sync carry nothing the plugin decides, and no activation values or
keys. The plugin reads the step and code type from the address it opened with
(`#step=add&type=totp`, or an old `?step=` query), validated field by field; a
step the session can't reach opens the portal. The numbered steps move between
steps; Back and Forward leave the page. Refreshing or closing the tab discards
the activation and key, so the host asks the browser to confirm leaving while
it holds them. **Start over** clears the session and opens the portal step. The
build renders the institution in its document; the address cannot change that
identity, and never names it. Old `?university=` home links open that
institution's download on the home page.

## Appearance

Use UIkit classes on native HTML for cards, buttons, fields and notices; no UIkit
JavaScript runs. The help and privacy dialogs are native popovers opened by
`popovertarget` buttons, and the Advanced limits use `<details>`, so the CSP
allows no style attributes. The screenshots load with `fetch` and their SHA-256
(`data-image-integrity`) as `blob:` URLs, so the CSP allows images only as `data:`
and `blob:` URLs and stylesheets can request nothing. The "Open in authenticator app" link shows only on
touch screens, through a `pointer-coarse:` utility. Everything the page
shows is built in the browser with VanJS (see `lib/dom`), without eval. The home page school search uses a native search
input and keyboard-accessible buttons; code types are native radio inputs.

Layout, typography and responsive states are named classes in `setup-styles.css`,
such as `step-card` and `btn-accent`, each compiled from Tailwind CSS v4 utilities
with `@apply`, so the page's script names a class instead of a list of utilities.
Tailwind scans no source files; a class needs a rule there, and a test fails if one
has none.
`setup-styles.css` declares the small application palette. Its rules are important,
through `!` on each utility, to compose with UIkit's unlayered stylesheet. The adapter compiles Tailwind and
publishes its CSS as an SRI-checked stylesheet in the setup files' pinned assets commit. The app uses
the system font; no Tailwind compiler runs in the browser. Steps use the `hidden`
property to hide elements, because Tailwind's rule for it beats important display utilities.

## Safety

Each image or scan frame carries the plugin's ticket, so results of cancelled
work are dropped, and late key results for an abandoned activation are ignored. Submission is guarded against double clicks and
the form stays mounted while the browser submits it. Activation inputs and
replies are validated by the plugin before entering its state. No browser storage
is used, and raw pasted replies are never serialized.

## Local download

The build publishes the help images with the
pinned assets. Every choice on the home page downloads the one file, `files/unduo`, built from these
components. Other shows no institution's name ("isn't affiliated with your organization"),
no portal or Source link, and the signed-in and My Settings examples with the logo painted out. It never serializes current page state.
