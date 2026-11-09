import { readFileSync } from "node:fs";
import type { PageEntry, PageResources } from "@-/me.unduo.configs.web";
import { attributes, escapeText } from "@-/me.unduo.lib.dom/server";

const favicon = `data:image/svg+xml,${encodeURI(
  readFileSync(new URL("assets/favicon.svg", import.meta.url), "utf8")
    .trim()
    .replaceAll('"', "'"),
)}`;
// Describes how the page contains the plugin, what its output can reach, and its pin.
const pluginComment =
  "The page treats the WebAssembly module at data-plugin-url as untrusted code and runs any module the same way, whatever its bytes. loadSetupPlugin() refuses a module unless it imports exactly alloc, input_length, input_load_u8, input_load_u64, store_u8, store_u64, output_set and error_set, which kernel(), in the script below, implements, and exports exactly memory and update. A WebAssembly module computes on its own memory and can reach anything else only through its imports, and these only copy one call's input in and its output or error out. So the module acts only through its output, and the script decides what that output can do. The module runs the setup steps. It receives events as JSON and never pixels: readQrCodes(), in the script, reads QR codes from images and screen frames, and the module gets only their text. check() validates each of its outputs against the Output schema before the page uses it. Its output reaches only what the page shows, the text field, the Duo form's URL and the otpauth:// link. The page shows only the titles, labels and messages listed in pageTexts in the script, and text built from what you pasted: the organization name and setup key from Duo's reply, Duo's reason when it refuses, from a pasted reply that says it failed, and your pasted text in the text field. Its output never reaches the address: the script changes the address only once, with history.replaceState() when the page opens, before anything is pasted, to drop any query or hash. The Duo form's URL, the only output sent to a server, is an api-XXXXXXXX.duosecurity.com host, the same for the whole page load, with a 5 to 128 character activation code in its path, and fromInput() requires that code and host in text the page read: pasted text or HTML, or the text readQrCodes() read from a QR code. The otpauth:// link becomes a QR code, a link and clipboard text when you ask, and fromReply() requires the text its secret encodes, and its organization name, to appear in text you pasted, where Duo's reply arrives. Calls run on the page's thread, so the page can't stop a call that never returns; limits apply once it returns. So whatever its bytes compute, the module can only choose among this page's own steps and messages, leave setup unfinished or hang the tab. Its bytes decide only whether setup works. They are built from crates/setup in github.com/UnDuoMe/unduo.me; the browser fetches them only if their SHA-256 matches data-plugin-integrity, the hash jsDelivr's listing at data-integrity-source gives for data-integrity-file; and GitHub's artifact attestation for this file names the commit and workflow run that built it: gh attestation verify FILE --repo UnDuoMe/unduo.me.";
interface PageLayout {
  title: string;
  entry: PageEntry;
  resources: PageResources;
}

/**
 * A page's whole HTML: what the build alone can write, around `mount`, the
 * elements its script starts from. The script builds everything visible.
 */
export function pageLayout({ title, entry, resources }: PageLayout, mount = "") {
  const setup = entry === "setup";
  const root = attributes({
    id: "root",
    ...(setup ? resources.plugin : {}),
    "data-comment": setup ? pluginComment : undefined,
  });
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="referrer" content="no-referrer">
    <meta name="description" content="Use your favorite authenticator with Duo. Activation goes directly to Duo; your key stays in your browser. No install or account.">
    <title>${escapeText(title)}</title>
    <link rel="icon" type="image/svg+xml" href="${favicon}">
    ${resources.head}
  </head>
  <body class="page-body">
    <div${root}>${mount}</div>
    <noscript>Enable JavaScript to use unduo.</noscript>
    ${resources.script(entry)}
  </body>
</html>
`;
}
