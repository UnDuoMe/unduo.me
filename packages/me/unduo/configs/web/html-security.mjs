import { createHash } from "node:crypto";
import { init, parse as parseModules } from "es-module-lexer";
import { parse as parseHtml } from "parse5";
import { assetIntegritySource, readCdnSource } from "#cdn-source";

await init();
const scriptHashes = new Map();
const styleHashes = new Map();
const reviewed = readCdnSource();
const digest = (content) => `'sha256-${createHash("sha256").update(content).digest("base64")}'`;

/** Inline scripts import nothing, so the page runs only the code it contains. */
export function validateScript(code) {
  if (scriptHashes.has(code)) return scriptHashes.get(code);
  const [imports] = parseModules(code);
  if (imports.some((entry) => entry.type !== "import-meta"))
    throw new Error("The page runs only its own code: inline scripts can't import modules.");
  const hash = digest(code);
  scriptHashes.set(code, hash);
  return hash;
}

/**
 * What a script element marked data-requests="none" must not hold: any way to
 * send a request or navigate, whatever its links do when you click them. A form
 * with no action can't send anything: the page handles its submit event.
 */
const requestsOrNavigation =
  /\bfetch\s*\(|\bXMLHttpRequest\b|\bsendBeacon\b|\bWebSocket\b|\bWebTransport\b|\bEventSource\b|\bRTCPeerConnection\b|\bWorker\b|\bimportScripts\b|\bimport\s*\(|(?<![\w$])(?:window\.)?open\s*\(|\blocation\s*(?:=|\.\s*(?:href|assign|replace|reload)\b)|\bhistory\s*\.\s*(?:pushState|replaceState|back|forward|go)\b|\.submit\s*\(|\.requestSubmit\s*\(|\b(?:action|formAction)\s*[:=]/;

/** A named part of a page's program: a strict classic script that says what it requests. */
function validatePart(attrs, code) {
  const part = /\bdata-part="([\w-]+)"/.exec(attrs)?.[1];
  if (!part) return;
  // A published file stays byte for byte, so it must match the hash it names.
  const upstream = /\bdata-upstream-sha256="([0-9a-f]{64})"/.exec(attrs)?.[1];
  if (upstream) {
    if (createHash("sha256").update(code).digest("hex") !== upstream)
      throw new Error(`Script part ${part} isn't the published file it names.`);
  } else if (!code.startsWith('"use strict";')) {
    throw new Error(`Script part ${part} must be strict.`);
  }
  const requests = /\bdata-requests="([^"]*)"/.exec(attrs)?.[1];
  if (!requests) throw new Error(`Script part ${part} must say what it requests.`);
  if (requests !== "none") return;
  const found = requestsOrNavigation.exec(code);
  if (found) throw new Error(`Script part ${part} says it requests nothing, but holds ${found[0]}`);
}

/** Validate compiled CSS before permitting a shared, SRI-locked stylesheet. */
export function validateStylesheet(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (/@import\b/i.test(source)) throw new Error("Stylesheet imports are forbidden.");
  for (const [, quoted, unquoted] of source.matchAll(
    /url\(\s*(?:["']([^"']*)["']|([^)]*))\s*\)/gi,
  )) {
    if (!/^(?:data:|#)/i.test((quoted ?? unquoted).trim()))
      throw new Error("Stylesheets cannot load external resources.");
  }
}

/**
 * Lock the page's inline code with CSP hashes. Every script is inline and
 * imports nothing, so the document alone shows everything it runs. Published
 * stylesheets, images and the setup plugin must come from `assetBase`, the
 * content-addressed jsDelivr commit.
 * @param {string} source
 * @param {{ stylesheets?: Record<string, string>, assetBase?: string }} published
 */
export function finalizeHtml(source, { stylesheets = {}, assetBase } = {}) {
  const html = source.replace(/\r\n?/g, "\n");
  const stylesheetUrls = new Set();
  const plugins = new Set();
  const images = new Set();
  // Folders of published assets the page may fetch files from: the setup
  // file's screenshot list names the screenshots there, each with its SHA-256.
  const folders = new Set();
  // Published assets name jsDelivr's listing of their commit, described in data-comment.
  const requireIntegritySource = (attrs, url) => {
    const expected = assetIntegritySource(url);
    if (
      !expected ||
      attrs["data-integrity-source"] !== expected.source ||
      attrs["data-integrity-file"] !== expected.file ||
      !attrs["data-comment"]?.trim()
    )
      throw new Error(`Published assets require data-integrity-* and data-comment: ${url}`);
  };
  const fromAssets = (url) =>
    !!assetBase &&
    typeof url === "string" &&
    url.startsWith(assetBase) &&
    /^[\w.-]+$/.test(url.slice(assetBase.length));
  // Parse real attributes, even inside templates. Large code bodies are checked
  // separately and cached because institution pages repeat the same programs.
  const shell = html
    .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script\s*>)/gi, "$1$2")
    .replace(/(<style\b[^>]*>)[\s\S]*?(<\/style\s*>)/gi, "$1$2");
  function inspect(node) {
    const attrs = Object.fromEntries((node.attrs ?? []).map(({ name, value }) => [name, value]));
    if (node.tagName === "script") {
      // SVG scripts load by href (or xlink:href, which parse5 reports as href).
      if (Object.hasOwn(attrs, "href"))
        throw new Error(`Script href sources are forbidden: ${attrs.href}`);
      if (Object.hasOwn(attrs, "src"))
        throw new Error(`The page runs only its own code: scripts must be inline: ${attrs.src}`);
      if (attrs.type !== "module" && !(attrs.type === undefined && attrs["data-part"]))
        throw new Error("Scripts must be inline modules or named parts of the page's program.");
    }
    if (["base", "iframe", "object", "embed"].includes(node.tagName))
      throw new Error(`Embedded documents are forbidden: ${node.tagName}`);
    if (Object.keys(attrs).some((name) => /^on/i.test(name)))
      throw new Error("Native inline event handlers are forbidden; scripts add listeners.");
    // The script sets these as links, so they must be web addresses.
    for (const name of ["data-portal-url", "data-source-url"])
      if (Object.hasOwn(attrs, name) && !/^https?:\/\//.test(attrs[name]))
        throw new Error(`${name} must be a web address: ${attrs[name]}`);
    if (Object.hasOwn(attrs, "data-plugin-url")) {
      if (!fromAssets(attrs["data-plugin-url"]) || !attrs["data-plugin-url"].endsWith(".wasm"))
        throw new Error(
          `The setup plugin must load from the published assets: ${attrs["data-plugin-url"]}`,
        );
      if (!/^sha256-[A-Za-z0-9+/]{43}=$/.test(attrs["data-plugin-integrity"] ?? ""))
        throw new Error("The setup plugin requires a SHA-256 pin.");
      if (!attrs["data-comment"]?.trim())
        throw new Error("The setup plugin root must describe the plugin in data-comment.");
      requireIntegritySource(attrs, attrs["data-plugin-url"]);
      plugins.add(attrs["data-plugin-url"]);
    }
    // The screenshot list loads by fetch, with its SHA-256, and names the
    // screenshots next to it, each with its SHA-256.
    if (Object.hasOwn(attrs, "data-screenshots-url")) {
      if (
        !fromAssets(attrs["data-screenshots-url"]) ||
        !attrs["data-screenshots-url"].endsWith(".json")
      )
        throw new Error(
          `The screenshot list must be a published asset: ${attrs["data-screenshots-url"]}`,
        );
      if (!/^sha256-[A-Za-z0-9+/]{43}=$/.test(attrs["data-screenshots-integrity"] ?? ""))
        throw new Error("The screenshot list requires a SHA-256 pin.");
      requireIntegritySource(attrs, attrs["data-screenshots-url"]);
      folders.add(assetBase);
    }
    // Screenshots load by fetch, with their SHA-256, as blob: URLs.
    if (Object.hasOwn(attrs, "data-image-src")) {
      if (!fromAssets(attrs["data-image-src"]) || !attrs["data-image-src"].endsWith(".webp"))
        throw new Error(`Screenshots must be published assets: ${attrs["data-image-src"]}`);
      if (!/^sha256-[A-Za-z0-9+/]{43}=$/.test(attrs["data-image-integrity"] ?? ""))
        throw new Error("Screenshots require a SHA-256 pin.");
      images.add(attrs["data-image-src"]);
    }
    // Sources the script sets are checked at runtime by the CSP's img-src.
    if (
      node.tagName === "img" &&
      Object.hasOwn(attrs, "src") &&
      !attrs.src.startsWith("data:image/")
    )
      throw new Error(`Images must be data: URLs or load through data-image-src: ${attrs.src}`);
    if (node.tagName === "link") {
      if (attrs.rel === "stylesheet") {
        const expected =
          (Object.hasOwn(stylesheets, attrs.href) && fromAssets(attrs.href)
            ? stylesheets[attrs.href]
            : undefined) ??
          (Object.hasOwn(reviewed.assets, attrs.href)
            ? reviewed.assets[attrs.href].integrity
            : undefined);
        if (!expected || attrs.integrity !== expected || attrs.crossorigin !== "anonymous")
          throw new Error(`Stylesheet must have matching reviewed SRI: ${attrs.href}`);
        if (fromAssets(attrs.href)) requireIntegritySource(attrs, attrs.href);
        stylesheetUrls.add(attrs.href);
      } else if (attrs.rel !== "icon" || !attrs.href?.startsWith("data:image/"))
        throw new Error(`External resource links are forbidden: ${attrs.rel}`);
    }
    for (const child of node.childNodes ?? []) inspect(child);
    if (node.content) inspect(node.content);
  }
  inspect(parseHtml(shell));

  const hashes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter(([, attrs]) => !/\bsrc\s*=/i.test(attrs))
    .map(([, attrs, code]) => {
      validatePart(attrs, code);
      return validateScript(code);
    });
  const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map(([, css]) => {
    if (!styleHashes.has(css)) {
      validateStylesheet(css);
      styleHashes.set(css, digest(css));
    }
    return styleHashes.get(css);
  });
  if (plugins.size > 1) throw new Error("A page loads at most one setup plugin.");
  const scriptSources = [...new Set(hashes)];
  // Compiling WebAssembly is allowed only on pages that load the pinned plugin.
  if (plugins.size) scriptSources.push("'wasm-unsafe-eval'");
  // The script builds the page's one frame, for Duo's reply, and names it.
  const replyFrame = html.includes('name: "duo-reply"');
  const policy = [
    "default-src 'none'",
    `script-src ${scriptSources.join(" ") || "'none'"}`,
    "script-src-attr 'none'",
    `style-src-elem ${[...stylesheetUrls, ...new Set(styles)].join(" ") || "'none'"}`,
    // Neither the markup nor the script sets inline styles; `hidden` hides elements.
    "style-src-attr 'none'",
    // Stylesheets can request nothing: images are data: or blob: URLs, and fonts data: URLs.
    `img-src data:${images.size || folders.size ? " blob:" : ""}`,
    "font-src data:",
    // The only files a page fetches are the setup plugin, its screenshot list
    // and the screenshots it names, all in the folder of one assets commit.
    `connect-src ${
      [
        ...folders,
        ...[...plugins, ...images]
          .filter((url) => ![...folders].some((folder) => url.startsWith(folder)))
          .sort((a, b) => (a < b ? -1 : 1)),
      ].join(" ") || "'none'"
    }`,
    "form-action https://*.duosecurity.com",
    // Duo's reply shows in a frame rather than a new tab, so it stays out of browser history.
    ...(replyFrame ? ["frame-src https://*.duosecurity.com"] : []),
    "base-uri 'none'",
    "object-src 'none'",
  ].join("; ");
  // Describes the policy above. It holds by construction: script-src gets
  // only hashes and, with a plugin, wasm.
  const scriptNote =
    "script-src lists only the hashes of this page's inline scripts and no hosts, so the browser runs no script but those, which import nothing. No source allows inline handlers or eval. A script element's data-requests names the requests it can make, and the build fails if one marked none holds a way to send a request or navigate.";
  const formNote =
    "Once the page accepts a Duo form, its script adds a second policy, form-action and frame-src https://api-XXXXXXXX.duosecurity.com for that form's host, and browsers enforce both.";
  const frameNote =
    replyFrame &&
    "The script builds one frame, duo-reply, with the sandbox attribute, no permissions and no src. Only the Duo form loads anything in it, and scripts can't run there or read it from this page: you copy Duo's reply out of it by hand. No form or button sends Duo's form anywhere else, such as a new tab.";
  const navigationNote =
    "No CSP directive that browsers enforce limits top-level navigation or window.open, so only this page's own scripts can use them.";
  const comment = [
    scriptNote,
    plugins.size && "'wasm-unsafe-eval' allows compiling WebAssembly only.",
    plugins.size && formNote,
    frameNote,
    folders.size
      ? "Fetches may reach only the files in connect-src's folder, one commit of github.com/UnDuoMe/unduo.me whose files jsDelivr lists at the #setup element's data-integrity-source, and the script uses each only if its SHA-256 matches. Forms may reach only Duo."
      : "Fetches may reach only the files in connect-src, and forms only Duo.",
    `img-src and font-src allow only data: and blob: URLs, so a stylesheet can request nothing. ${navigationNote}`,
  ]
    .filter(Boolean)
    .join(" ");
  if (!/<head>/i.test(html)) throw new Error("Missing document head.");
  return html.replace(
    /<head>/i,
    () =>
      `<head><meta http-equiv="Content-Security-Policy" content="${policy}" data-comment="${comment}">`,
  );
}
