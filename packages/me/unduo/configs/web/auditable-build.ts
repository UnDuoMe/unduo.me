import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build as bundle, type Plugin } from "vite";
import { repoRoot, webRoot } from "#web-paths";
import { universityCatalog } from "#university-catalog";
import { cdnLibraries } from "#cdn-libraries";
import { cdnBase, cdnCommit } from "#cdn-assets";
import { assetIntegritySource, installedVersion, readCdnSource, template } from "#cdn-source";
import { finalizeHtml, validateScript, validateStylesheet } from "#html-security";
import { readSetupPlugin, setupPluginFile } from "@-/me.unduo.components.setup.plugin/server";
import { reviewedStylesheet, selfContained, trimUikit, usedUikitClasses } from "#self-contained";

/**
 * An experiment: with UNDUO_JS_PLUGIN=1, setup pages run the TypeScript port
 * of `crates/setup` in their script and load no WebAssembly.
 */
export const jsPlugin = process.env.UNDUO_JS_PLUGIN === "1";

/** The build's choices that the pages' scripts read as constants. */
export const pageDefines = {
  "import.meta.env.UNDUO_JS_PLUGIN": JSON.stringify(jsPlugin),
  "import.meta.env.UNDUO_SELF_CONTAINED": JSON.stringify(selfContained),
};

/** The script each kind of page runs, from the web adapter's root. */
const pageEntries = {
  setup: "src/main.ts",
  home: "src/home.ts",
};

export type PageEntry = keyof typeof pageEntries;

/** What a page's HTML loads, which differs between the dev server and each build. */
export interface PageResources {
  /** The head's elements for the page's stylesheets. */
  head: string;
  /** The attributes that load the setup plugin; absent when the logic is in the script. */
  plugin?: Record<string, string> | undefined;
  /** The attributes that load an image in `src/assets/`, named without `.webp`. */
  image: (name: string) => Record<string, string>;
  /**
   * A setup screenshot in `src/assets/`, named without `.webp`: its file,
   * relative to the files `asset` publishes, and its SHA-256.
   */
  screenshot: (name: string) => { file: string; integrity: string };
  /**
   * Publish `bytes` as `name` with the page's assets: its address, SHA-256 and
   * jsDelivr's listing of it, or in the self-contained experiment its text to
   * put in the page.
   */
  asset: (
    name: string,
    bytes: Buffer,
  ) => { url: string; integrity: string; source: string; file: string } | { inline: string };
  /** The element that runs the page's script. */
  script: (entry: PageEntry) => string;
}

/** One document of the site, at its path below the output directory. */
export interface SitePage {
  path: string;
  entry: PageEntry;
  render: (resources: PageResources) => string;
}

async function bundleScript(entry: string) {
  const root = fileURLToPath(webRoot);
  const result = await bundle({
    configFile: false,
    root,
    logLevel: "silent",
    plugins: [universityCatalog(), cdnLibraries()],
    define: pageDefines,
    build: {
      write: false,
      minify: false,
      sourcemap: false,
      modulePreload: false,
      lib: { entry: resolve(root, entry), formats: ["es"] },
      // Keep doc comments; drop tree-shaking annotations and per-module markers.
      rolldownOptions: {
        output: { codeSplitting: false, comments: { legal: true, annotation: false, jsdoc: true } },
        experimental: { attachDebugInfo: "none" },
      },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunks = outputs.flatMap((output) =>
    "output" in output ? output.output.filter((part) => part.type === "chunk") : [],
  );
  if (chunks.length !== 1) throw new Error(`Expected one application bundle for ${entry}.`);
  const code = chunks[0]!.code;
  // Inline code must never end its element early or enter double-escaped script parsing.
  if (/<\/script|<!--/i.test(code)) throw new Error(`Unsafe inline script markup in ${entry}.`);
  const modules = Object.entries(chunks[0]!.modules).flatMap(([id, module]) =>
    module.code ? [{ id, code: module.code.replaceAll("/* @__PURE__ */ ", "") }] : [],
  );
  return { code, modules };
}

/**
 * The page's VanJS: this exact file from github.com/vanjs-org/van, kept unchanged
 * in the wrapper package. The element holds its bytes, so anyone can compare them.
 */
const vanjsVersion = installedVersion("vanjs-core");
const vanjsCommit = "84f30ae917107c9d4b4c38b9969a0d56aaac5ac8";
const vanjsFile = `van-${vanjsVersion}.nomodule.js`;
const vanjsCode = readFileSync(
  new URL(`packages/com/npmjs/vanjs-core/${vanjsFile}`, repoRoot),
  "utf8",
);
const vanjsComment = `VanJS ${vanjsVersion}: the file at data-upstream, byte for byte, whose SHA-256 is data-upstream-sha256. It sets window.van and nothing else.`;
const vanjsUrl = `https://raw.githubusercontent.com/vanjs-org/van/${vanjsCommit}/public/${vanjsFile}`;
if (/<\/script|<!--|\r/i.test(vanjsCode))
  throw new Error(`Unsafe inline script markup in ${vanjsFile}.`);
const vanjsElement = (comment = vanjsComment) =>
  `<script data-app="unduo" data-part="vanjs" data-upstream="${vanjsUrl}" data-upstream-sha256="${createHash("sha256").update(vanjsCode).digest("hex")}" data-requests="none" data-comment="${comment}">${vanjsCode}</script>`;

/**
 * The setup page's script elements, in the order they run. Each holds the modules
 * it matches, whose scope-hoisted code shares one global scope. `requests` is
 * "none" where `finalizeHtml` checks that the code holds no request or navigation.
 */
const setupParts = [
  {
    part: "plugin-checks",
    modules: /\/setup\/plugin\/setup-plugin\.ts$/,
    requests: jsPlugin ? "none" : "fetch() of data-plugin-url",
    comment: jsPlugin
      ? "guard() and check() test each output of the setup logic before the page uses it, and fromInput() and fromReply() bind what it names to what the page read."
      : "kernel() gives the WebAssembly module its only imports, loadSetupPlugin() refuses a module with any others, and guard() and check() test each of its outputs before the page uses it. fromInput() and fromReply() bind what it names to what the page read. fetch() returns the module only if its SHA-256 matches.",
  },
  {
    part: "setup-logic",
    modules: /\/setup\/plugin\/js-plugin\.ts$/,
    requests: "none",
    comment:
      "The setup logic ported from crates/setup to TypeScript. Its output goes through guard().",
  },
  {
    part: "qr-codes",
    modules: /\/lib\/qr-reader\/qr-reader\.ts$|\/setup\/qr-code\.ts$/,
    requests: "none",
    comment:
      "readQrCodes() reads the text of QR codes from gray pixels, and qrModules() and qrImage() draw the authenticator QR code as a data: URL. They take and return numbers and text.",
  },
  {
    part: "steps",
    modules:
      /\/lib\/dom\/dom\.ts$|\/components\/result\/[\w-]+\.ts$|\/components\/stepper\/[\w-]+\.ts$|\/setup\/(?:shortcuts|limits|portal|link|help)\/[\w-]+\.ts$|\/setup\/setup-layout\.ts$/,
    requests: "none",
    comment:
      "The element functions from the vanjs element's global, and the elements of each setup step but the Duo form. Their links open only when you click them, and the one form here, for pasted text, has no action: the page handles it.",
  },
  {
    part: "duo-form",
    modules: /\/setup\/activate\/activate-step\.ts$/,
    requests: "the Duo form's POST",
    comment:
      "The Duo form, whose action check() approves, and the sandboxed frame that shows Duo's reply.",
  },
  {
    part: "page",
    modules:
      /\/setup\/setup-page\.ts$|\/setup\/setup-app\.ts$|\/setup\/school-choice\.ts$|\/src\/main\.ts$/,
    requests: selfContained
      ? "fetch() of a data: URL the CSP must refuse; window.open() of the portal link"
      : "fetch() of the screenshots, and of a data: URL the CSP must refuse; window.open() of the portal link",
    comment:
      "The page's browser I/O, which sends each event to the setup logic and performs what check() approved. It starts setup.",
  },
];

/** The setup page's script elements, built from its bundle's modules. */
function setupElements({ code, modules }: Awaited<ReturnType<typeof bundleScript>>) {
  const unmatched = modules.filter(({ id }) => !setupParts.some((part) => part.modules.test(id)));
  if (unmatched.length)
    throw new Error(`No script part for ${unmatched.map(({ id }) => id).join(", ")}`);
  // A module's code comes just before the bundler's last pass, which inlines a few
  // constants. Each name the bundle declares must still be declared in a part.
  const declared = (text: string) =>
    new Set(
      [
        ...text.matchAll(/^(?:var|let|const|function\*?|async function|class) +\{?\s*([\w$]+)/gm),
      ].map(([, name]) => name!),
    );
  const held = declared(modules.map((module) => module.code).join("\n"));
  const lost = [...declared(code)].filter((name) => !held.has(name));
  if (lost.length) throw new Error(`The script parts lost ${lost.join(", ")}.`);
  const elements = setupParts.flatMap(({ part, modules: match, requests, comment }) => {
    const matched = modules.filter(({ id }) => match.test(id));
    if (!matched.length) return [];
    const source = matched
      .filter(({ id }) => !id.startsWith("\0"))
      .map(({ id }) => id.replace(/^.*\/(?=packages\/|apps\/)/, ""))
      .join(" ");
    const inline = `"use strict";\n${matched.map((module) => module.code.trim()).join("\n")}\n`;
    if (/<\/script|<!--/i.test(inline)) throw new Error(`Unsafe inline script markup in ${part}.`);
    validateScript(inline);
    return [
      `<script data-app="unduo" data-part="${part}" data-source="${source}" data-requests="${requests}" data-comment="${comment}">${inline}</script>`,
    ];
  });
  return [vanjsElement(scriptComments.setup!), ...elements].join("\n");
}

const sri = (bytes: Buffer) => `sha256-${createHash("sha256").update(bytes).digest("base64")}`;

/** jsDelivr's listing of the assets commit, which auditors compare hashes with. */
function integrityAttributes(url: string): string {
  const { source, file } = assetIntegritySource(url)!;
  return `data-integrity-source="${source}" data-integrity-file="${file}"`;
}
/** The one npm file in the page's script; see `cdnLibraries`. */
const vanjs = `VanJS ${installedVersion("vanjs-core")} (the vanjs-core package's src/van.js, reformatted by the bundler)`;
/** VanJS in its own script element, exactly as published. */
const vanjsInElement = `VanJS ${installedVersion("vanjs-core")} (this element: the file at data-upstream, byte for byte, whose SHA-256 is data-upstream-sha256; it sets window.van and nothing else)`;

/** What each page's one script holds and can do; the auditable test checks it against the code. */
export const scriptComments: Record<string, string> = {
  setup: `This is all the JavaScript the page runs, bundled from github.com/UnDuoMe/unduo.me without minifying. It imports nothing. It holds ${vanjs}, which builds the page's elements with createElement and text nodes and updates them when state changes; the setup page and its steps (startSetupPage, createSetupPage, screenshot); the QR code encoder and reader (qrModules, qrImage, readQrCodes), and the plugin loader and its output checks (kernel, loadSetupPlugin, guard, check, fromInput, fromReply). Nothing in the script writes HTML or evaluates text as code, and no attribute in the page's HTML holds an expression: the data attributes of the institutions in the #setup-schools template are text the script shows or sets as links. It reads its own file name from location.pathname only to pick which of those institutions to show, which the first step lets you change, and the name goes nowhere. Its only requests are the Duo form, whose action check() approves, and fetch() of data-plugin-url, of the screenshot list at the #setup element's data-screenshots-url and of the screenshots it names for the institution shown, each of which returns a file only if its SHA-256 matches. Before setup starts, it tries fetch() of a data: URL, which the CSP forbids, and starts only if that fails. It navigates only with window.open() of the portal link the user clicked (popup), and with one history.replaceState() when the page opens, before anything is pasted, which drops any query or hash from its address. The script sets four kinds of changing URL: the Duo form's action and the otpauth:// link's href, both approved by check(); the authenticator QR code's src, a data: URL from qrImage(); and each screenshot's src, a blob: URL of its fetched file. Every other link's href is written in the script or is the data-portal-url or data-source-url of an institution in the #setup-schools template.`,
  home: `This and the vanjs element before it are all the JavaScript the page runs. This one is bundled from github.com/UnDuoMe/unduo.me without minifying. It imports nothing. With VanJS, which builds the page's elements with createElement and text nodes, it filters the list of institutions as you type and takes the one you choose through downloading its setup file, asking an AI about it and opening it. Its only requests are fetch() of the screenshots of what ChatGPT, Claude and Gemini said about a setup file (showScreenshot): each image's data-image-src in the #ai-reply-images template, which returns a file only if its SHA-256 matches, shown as a blob: URL. It changes the URL only with history.pushState(), which records the institution and step you chose in this page's own address. It opens a window only with window.open() of the AI link you click (openWindow), and only links you click go anywhere else. When you ask, it copies a prompt for an AI to your clipboard.`,
};
if (jsPlugin)
  scriptComments.setup = `This is all the JavaScript the page runs, bundled from github.com/UnDuoMe/unduo.me without minifying. It imports nothing. It holds ${vanjs}, which builds the page's elements with createElement and text nodes and updates them when state changes; the setup page and its steps (startSetupPage, createSetupPage, screenshot); the QR code encoder and reader (qrModules, qrImage, readQrCodes), the setup logic ported from crates/setup to TypeScript (loadJsSetupPlugin, createSetupLogic, readEvent, view), and the checks on the setup logic's output (guard, check, fromInput, fromReply). Nothing in the script writes HTML or evaluates text as code, and no attribute in the page's HTML holds an expression: the data attributes of the institutions in the #setup-schools template are text the script shows or sets as links. It reads its own file name from location.pathname only to pick which of those institutions to show, which the first step lets you change, and the name goes nowhere. Its only requests are the Duo form, whose action check() approves, and fetch() of the screenshot list at the #setup element's data-screenshots-url and of the screenshots it names for the institution shown, each of which returns a file only if its SHA-256 matches. Before setup starts, it tries fetch() of a data: URL, which the CSP forbids, and starts only if that fails. Once the page accepts a Duo form, it adds a second CSP limiting forms to that form's host. It navigates only with window.open() of the portal link the user clicked (popup), and with one history.replaceState() when the page opens, before anything is pasted, which drops any query or hash from its address. The script sets four kinds of changing URL: the Duo form's action and the otpauth:// link's href, both approved by check(); the authenticator QR code's src, a data: URL from qrImage(); and each screenshot's src, a blob: URL of its fetched file. Every other link's href is written in the script or is the data-portal-url or data-source-url of an institution in the #setup-schools template.`;

/** A copy of `text` with `from` replaced, which must appear in it. */
function rewrite(text: string, from: string, to: string) {
  if (!text.includes(from)) throw new Error(`Missing text to rewrite: ${from}`);
  return text.replace(from, () => to);
}
if (selfContained && jsPlugin)
  scriptComments.setup = rewrite(
    rewrite(
      scriptComments.setup!,
      "Its only requests are the Duo form, whose action check() approves, and fetch() of the screenshot list at the #setup element's data-screenshots-url and of the screenshots it names for the institution shown, each of which returns a file only if its SHA-256 matches. Before setup starts, it tries fetch() of a data: URL, which the CSP forbids, and starts only if that fails.",
      "Its only requests are the Duo form, whose action check() approves, and, before setup starts, fetch() of a data: URL, which the CSP forbids; setup starts only if that fails. The screenshot list is the #setup element's data-screenshots, and its screenshots are data: URLs, so loadScreenshot() fetches nothing.",
    ),
    "The script sets four kinds of changing URL: the Duo form's action and the otpauth:// link's href, both approved by check(); the authenticator QR code's src, a data: URL from qrImage(); and each screenshot's src, a blob: URL of its fetched file. Every other link's href is written in the script or is the data-portal-url or data-source-url of an institution in the #setup-schools template.",
    "The script sets three kinds of changing URL: the Duo form's action and the otpauth:// link's href, both approved by check(); and the authenticator QR code's src, a data: URL from qrImage(). Every other link's href is written in the script or is the data-portal-url or data-source-url of an institution in the #setup-schools template, and every other image has a fixed src.",
  );

scriptComments.setup = rewrite(
  rewrite(
    scriptComments.setup!,
    "This is all the JavaScript the page runs, bundled from github.com/UnDuoMe/unduo.me without minifying. It imports nothing. It holds",
    "These script elements, which run in order and share one scope, are all the JavaScript the page runs, bundled from github.com/UnDuoMe/unduo.me without minifying. Together they are the script this comment describes. It imports nothing. It holds",
  ),
  vanjs,
  vanjsInElement,
);

/** Every request a self-contained page's script can make, for its CSP's data-comment. */
const selfContainedRequests: Record<string, string> = {
  setup:
    "the fetch('data:,') probe, which this policy must refuse, and the Duo form's POST to the URL that check() approves, besides opening links you click",
  home: "none, besides opening links you click",
};

const stylesheetComment =
  "The browser applies this stylesheet only if its SHA-256 matches integrity. jsDelivr's listing at data-integrity-source, a commit of github.com/UnDuoMe/unduo.me, gives the same hash for data-integrity-file.";

/** An image in `src/assets/`, by its name without `.webp`, such as `setup-1-add-device`. */
const imageFile = (name: string) => new URL(`src/assets/${name}.webp`, webRoot);
/** The images pages show: the setup file's portal screenshots and the home page's AI replies. */
const pageImage = /^((?:setup|ai-reply)-.+)\.webp$/;

/**
 * The dev server's pages load files as they are on disk, and their script through
 * Vite after the same VanJS element a build writes, which sets the global `van`.
 * They need a policy only so that `fetch("data:,")` fails and setup starts.
 */
async function devResources(
  stylesheet: string,
  assets: Map<string, Buffer>,
): Promise<PageResources> {
  const fs = (path: string) => `/@fs${path}`;
  const plugin = readSetupPlugin();
  return {
    head: `<meta http-equiv="Content-Security-Policy" content="connect-src 'self' ws:">
    ${(await readFile(template, "utf8")).trim()}
    <link rel="stylesheet" data-vendor="app" href="${fs(stylesheet)}">`,
    plugin: jsPlugin
      ? undefined
      : {
          "data-plugin-url": fs(fileURLToPath(setupPluginFile)),
          "data-plugin-integrity": sri(plugin.bytes),
        },
    image: (name) => ({ "data-image-src": fs(fileURLToPath(imageFile(name))) }),
    screenshot: (name) => ({
      file: `${name}.webp`,
      integrity: sri(readFileSync(imageFile(name))),
    }),
    asset: (name, bytes) => {
      assets.set(name, bytes);
      return { url: `${devAssets}${name}`, integrity: sri(bytes), source: "", file: "" };
    },
    script: (entry) =>
      `${vanjsElement()}\n<script type="module" src="/${pageEntries[entry]}"></script>`,
  };
}

/** Where the dev server serves what pages publish with `asset`, and the screenshots next to it. */
const devAssets = "/@unduo/";

/** The setup files' assets and the home page's, each in a commit of its own. */
type AssetGroup = "setup" | "home";
/** Where each group's commit is written: `vp run publish:assets` pushes both. */
const assetOutputs: Record<AssetGroup, { directory: string; manifest: string }> = {
  setup: { directory: "cdn", manifest: "cdn.json" },
  home: { directory: "cdn-home", manifest: "cdn-home.json" },
};

/**
 * Write the site from the compiled stylesheets: every page, each with its whole
 * script inline so it's reviewable from the HTML alone, and two content-addressed
 * jsDelivr commits. `cdn/` holds what the setup files load (their stylesheet,
 * the setup plugin and the setup screenshots) and `cdn-home/` what the home
 * page loads (its stylesheet and the AI replies' screenshots), so nothing on
 * the home page changes a setup file's bytes.
 */
async function writeSite(
  output: string,
  css: Record<PageEntry, string>,
  pages: readonly SitePage[],
) {
  validateStylesheet(css.setup);
  validateStylesheet(css.home);
  const groups = Object.fromEntries(
    (Object.keys(assetOutputs) as AssetGroup[]).map((group) => [
      group,
      { files: new Map<string, Buffer>(), base: "", commit: "" },
    ]),
  ) as Record<AssetGroup, { files: Map<string, Buffer>; base: string; commit: string }>;
  /** Add a file to a group's commit and return its URL. */
  const publish = (group: AssetGroup, name: string, bytes: Buffer) => {
    const { name: stem, ext } = parse(name);
    const hash = createHash("sha256").update(bytes).digest("base64url").slice(0, 8);
    const published = `${stem}.${hash}${ext}`;
    groups[group].files.set(published, bytes);
    return { name: published, bytes, url: () => groups[group].base + published };
  };
  const stylesheets = {
    setup: publish("setup", "setup-styles.css", Buffer.from(css.setup)),
    home: publish("home", "home-styles.css", Buffer.from(css.home)),
  };
  const plugin = publish("setup", "setup.wasm", readSetupPlugin().bytes);
  const images = new Map<string, ReturnType<typeof publish>>();
  for (const name of (await readdir(new URL("src/assets/", webRoot))).sort()) {
    const stem = pageImage.exec(name)?.[1];
    if (stem)
      images.set(
        stem,
        publish(
          stem.startsWith("setup-") ? "setup" : "home",
          name,
          await readFile(imageFile(stem)),
        ),
      );
  }
  const image = (name: string) => {
    const published = images.get(name);
    if (!published) throw new Error(`Missing image: ${name}`);
    return published;
  };
  /** The group whose commit a page's assets come from. */
  const groupOf = (entry: PageEntry): AssetGroup => (entry === "home" ? "home" : "setup");
  const screenshot = (name: string) => ({
    file: image(name).name,
    integrity: sri(image(name).bytes),
  });
  // A page can publish files of its own, such as the setup file's screenshot
  // list: render each once to publish them before the commits are named.
  if (!selfContained)
    for (const page of pages)
      page.render({
        head: "",
        image: () => ({}),
        screenshot,
        asset: (name, bytes) => {
          publish(groupOf(page.entry), name, bytes);
          return { url: "", integrity: "", source: "", file: "" };
        },
        script: () => "",
      });
  for (const group of Object.values(groups)) {
    group.commit = cdnCommit(group.files);
    group.base = cdnBase(group.commit);
  }

  // Bundle each entry independently: setup pages never need the catalog.
  const home = (await bundleScript(pageEntries.home)).code;
  validateScript(home);
  const elements = {
    setup: setupElements(await bundleScript(pageEntries.setup)),
    home: `${vanjsElement()}\n<script type="module" data-app="unduo" data-comment="${scriptComments.home}">${home}</script>`,
  };
  const script = (entry: PageEntry) => elements[entry];

  const uikitLink = (await readFile(template, "utf8")).trim().replaceAll("\n", "\n    ");
  const appLink = (stylesheet: ReturnType<typeof publish>) =>
    `<link rel="stylesheet" data-vendor="app" href="${stylesheet.url()}" integrity="${sri(stylesheet.bytes)}" crossorigin="anonymous" referrerpolicy="no-referrer" ${integrityAttributes(stylesheet.url())} data-comment="${stylesheetComment}">`;
  const resourcesFor = (entry: PageEntry): PageResources => ({
    head: `${uikitLink}\n    ${appLink(stylesheets[entry])}`,
    plugin:
      jsPlugin || entry !== "setup"
        ? undefined
        : {
            "data-plugin-url": plugin.url(),
            "data-plugin-integrity": sri(plugin.bytes),
            "data-integrity-source": assetIntegritySource(plugin.url())!.source,
            "data-integrity-file": assetIntegritySource(plugin.url())!.file,
          },
    image: (file) => ({
      "data-image-src": image(file).url(),
      "data-image-integrity": sri(image(file).bytes),
    }),
    screenshot,
    asset: (name, bytes) => {
      const before = groups[groupOf(entry)].files.size;
      const published = publish(groupOf(entry), name, bytes);
      if (groups[groupOf(entry)].files.size !== before)
        throw new Error(`${name} changed after its commit was named.`);
      return {
        url: published.url(),
        integrity: sri(bytes),
        ...assetIntegritySource(published.url())!,
      };
    },
    script,
  });

  /** UIkit trimmed to each set of classes a page uses. */
  const trimmed = new Map<string, string>();
  /** A style element holding `css`, which must not end the element early. */
  const style = (vendor: string, comment: string, source: string) => {
    if (/<\/style/i.test(source)) throw new Error(`A stylesheet would end its element: ${vendor}`);
    return `<style data-vendor="${vendor}" data-comment="${comment}">${source}</style>`;
  };
  /**
   * The experiment's self-contained page: its stylesheets become style
   * elements, which the CSP allows by hash, UIkit's trimmed to the rules this
   * page can use, and its screenshots become data: URLs.
   */
  const containedResources = (page: SitePage): PageResources => {
    const contained: PageResources = {
      head: "",
      plugin: undefined,
      image: (file) => ({
        src: `data:image/webp;base64,${image(file).bytes.toString("base64")}`,
      }),
      screenshot: (name) => ({
        file: `data:image/webp;base64,${image(name).bytes.toString("base64")}`,
        integrity: sri(image(name).bytes),
      }),
      asset: (_name, bytes) => ({ inline: bytes.toString("utf8") }),
      script,
    };
    // The script builds most of the elements, so this counts its classes too.
    const used = usedUikitClasses(page.render(contained));
    const key = [...used].sort().join(" ");
    const reviewed = Object.keys(readCdnSource().assets).map((url) => {
      const { css: source, integrity, name, version, file } = reviewedStylesheet(url);
      if (name !== "uikit") throw new Error(`Only UIkit's stylesheet is trimmed: ${url}`);
      if (!trimmed.has(key)) trimmed.set(key, trimUikit(source, used));
      const comment = `UIkit ${version}'s ${file.slice(1)} from the npm registry, whose SHA-256 is ${integrity}, trimmed to the selectors whose .uk- classes all appear in this page's class attributes and script, the selectors with no .uk- class, and the @keyframes they name. The CSP allows this element by the hash of its contents.`;
      return style("uikit", comment, trimmed.get(key)!);
    });
    const stylesheet = stylesheets[page.entry];
    const comment = `The page's own stylesheet, compiled with Tailwind CSS from github.com/UnDuoMe/unduo.me: the bytes the normal build pins at ${stylesheet.url()}, whose SHA-256 is ${sri(stylesheet.bytes)}. The CSP allows this element by the hash of its contents.`;
    return {
      ...contained,
      head: [...reviewed, style("app", comment, css[page.entry])].join("\n    "),
    };
  };

  let totalBytes = 0;
  const secure = async (page: SitePage) => {
    const stylesheet = stylesheets[page.entry];
    const html = finalizeHtml(
      page.render(selfContained ? containedResources(page) : resourcesFor(page.entry)),
      {
        stylesheets: selfContained ? {} : { [stylesheet.url()]: sri(stylesheet.bytes) },
        assetBase: groups[groupOf(page.entry)].base,
        selfContained: selfContained ? selfContainedRequests[page.entry] : undefined,
      },
    );
    const path = resolve(output, page.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, html);
    totalBytes += Buffer.byteLength(html);
  };
  for (let offset = 0; offset < pages.length; offset += 32) {
    await Promise.all(pages.slice(offset, offset + 32).map(secure));
    if (offset > 0 && offset % 2048 === 0)
      console.log(
        `Secured ${Math.min(offset + 32, pages.length).toLocaleString("en-US")} of ${pages.length.toLocaleString("en-US")} documents.`,
      );
  }

  // `vp run publish:assets` pushes each group's directory as the commit its pages reference.
  for (const [group, { directory, manifest }] of Object.entries(assetOutputs)) {
    const { files, commit, base } = groups[group as AssetGroup];
    const published = resolve(output, directory);
    await mkdir(published, { recursive: true });
    for (const [name, bytes] of files) await writeFile(resolve(published, name), bytes);
    await writeFile(
      resolve(output, manifest),
      `${JSON.stringify({ commit, base, files: Object.fromEntries([...files].map(([name, bytes]) => [name, sri(bytes)])) }, null, 2)}\n`,
    );
  }
  for (const name of ["CNAME", ".nojekyll"])
    await writeFile(resolve(output, name), await readFile(new URL(name, repoRoot)));
  console.log(
    `Secured ${pages.length.toLocaleString("en-US")} documents (${(totalBytes / 1e6).toFixed(2)} MB); setup files' assets are pinned to ${groups.setup.base}, the home page's to ${groups.home.base}`,
  );
}

/**
 * The site's pages. The dev server serves them at their paths. In a build Vite
 * compiles only `stylesheets`, one per page entry, and this plugin keeps their
 * CSS, drops the rest of the bundle, and writes the site.
 */
export function auditableBuild(
  pages: readonly SitePage[],
  stylesheets: Record<PageEntry, string>,
): Plugin {
  const css: Partial<Record<PageEntry, string>> = {};
  /** What the dev server's pages published with `asset`, by name. */
  const assets = new Map<string, Buffer>();
  return {
    name: "unduo-auditable-build",
    config() {
      // Refuse to serve or build a plugin older than its Rust sources.
      readSetupPlugin();
      if (selfContained && !jsPlugin)
        throw new Error(
          "UNDUO_SELF_CONTAINED=1 needs UNDUO_JS_PLUGIN=1: the WebAssembly plugin is a file the page fetches.",
        );
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = request.originalUrl ?? request.url ?? "/";
        const { pathname } = new URL(url, "http://localhost");
        const path = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
        if (path.startsWith(devAssets)) {
          const name = path.slice(devAssets.length);
          const bytes =
            assets.get(name) ??
            (/^setup-[\w.-]+\.webp$/.test(name)
              ? readFileSync(imageFile(name.slice(0, -5)))
              : undefined);
          if (!bytes) {
            next();
            return;
          }
          response.setHeader(
            "Content-Type",
            name.endsWith(".json") ? "application/json" : "image/webp",
          );
          response.end(bytes);
          return;
        }
        const page = pages.find((candidate) => `/${candidate.path}` === path);
        if (!page) {
          next();
          return;
        }
        devResources(stylesheets[page.entry], assets)
          .then((resources) => server.transformIndexHtml(url, page.render(resources)))
          .then((html) => {
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.end(html);
          })
          .catch(next);
      });
    },
    generateBundle(_, bundled) {
      for (const [name, file] of Object.entries(bundled)) {
        // Vite marks a stylesheet with a comment that only its own minifier removes.
        const entry = /(?:^|\/)(setup|home)-[\w-]*\.css$/.exec(name)?.[1] as PageEntry | undefined;
        if (file.type === "asset" && entry)
          css[entry] = file.source.toString().replace(/\/\*\$vite\$:\d+\*\/$/, "");
        delete bundled[name];
      }
    },
    async writeBundle(options) {
      if (!css.setup || !css.home) throw new Error("Vite compiled no setup or no home stylesheet.");
      await writeSite(options.dir!, { setup: css.setup, home: css.home }, pages);
    },
  };
}
