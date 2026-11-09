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
import { assetIntegritySource, installedVersion, template } from "#cdn-source";
import { finalizeHtml, validateScript, validateStylesheet } from "#html-security";
import { readSetupPlugin, setupPluginFile } from "@-/me.unduo.components.setup.plugin/server";

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
  /** The attributes that load the setup plugin; absent on the home page. */
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
   * jsDelivr's listing of it.
   */
  asset: (
    name: string,
    bytes: Buffer,
  ) => { url: string; integrity: string; source: string; file: string };
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
    requests: "fetch() of data-plugin-url",
    comment:
      "kernel() gives the WebAssembly module its only imports, loadSetupPlugin() refuses a module with any others, and guard() and check() test each of its outputs before the page uses it. fromInput() and fromReply() bind what it names to what the page read. fetch() returns the module only if its SHA-256 matches.",
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
      "The element functions from the vanjs element's global, and the elements of each setup step but the Duo form. Their links open only when you click them. The forms here, for pasted text and the local passcode check, have no action: the page handles them.",
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
    requests:
      "fetch() of the screenshots, and of a data: URL the CSP must refuse; window.open() of the portal link",
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
/** A copy of `text` with `from` replaced, which must appear in it. */
function rewrite(text: string, from: string, to: string) {
  if (!text.includes(from)) throw new Error(`Missing text to rewrite: ${from}`);
  return text.replace(from, () => to);
}
scriptComments.setup = rewrite(
  rewrite(
    scriptComments.setup!,
    "This is all the JavaScript the page runs, bundled from github.com/UnDuoMe/unduo.me without minifying. It imports nothing. It holds",
    "These script elements, which run in order and share one scope, are all the JavaScript the page runs, bundled from github.com/UnDuoMe/unduo.me without minifying. Together they are the script this comment describes. It imports nothing. It holds",
  ),
  vanjs,
  vanjsInElement,
);

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
    plugin: {
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
 * Render the site from the compiled stylesheets: every page, each with its whole
 * script inline so it's reviewable from the HTML alone, and two content-addressed
 * jsDelivr commits. `cdn/` holds what the setup files load (their stylesheet,
 * the setup plugin and the setup screenshots) and `cdn-home/` what the home
 * page loads (its stylesheet and the AI replies' screenshots), so nothing on
 * the home page changes a setup file's bytes.
 */
async function renderSite(css: Record<PageEntry, string>, pages: readonly SitePage[]) {
  const output = new Map<string, Buffer>();
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
      entry !== "setup"
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

  let totalBytes = 0;
  const secure = (page: SitePage) => {
    const stylesheet = stylesheets[page.entry];
    const html = finalizeHtml(page.render(resourcesFor(page.entry)), {
      stylesheets: { [stylesheet.url()]: sri(stylesheet.bytes) },
      assetBase: groups[groupOf(page.entry)].base,
    });
    output.set(page.path, Buffer.from(html));
    totalBytes += Buffer.byteLength(html);
  };
  for (let offset = 0; offset < pages.length; offset += 32) {
    pages.slice(offset, offset + 32).forEach(secure);
    if (offset > 0 && offset % 2048 === 0)
      console.log(
        `Secured ${Math.min(offset + 32, pages.length).toLocaleString("en-US")} of ${pages.length.toLocaleString("en-US")} documents.`,
      );
  }

  // `vp run publish:assets` pushes each group's directory as the commit its pages reference.
  for (const [group, { directory, manifest }] of Object.entries(assetOutputs)) {
    const { files, commit, base } = groups[group as AssetGroup];
    for (const [name, bytes] of files) output.set(`${directory}/${name}`, bytes);
    output.set(
      manifest,
      Buffer.from(
        `${JSON.stringify({ commit, base, files: Object.fromEntries([...files].map(([name, bytes]) => [name, sri(bytes)])) }, null, 2)}\n`,
      ),
    );
  }
  for (const name of ["CNAME", ".nojekyll"])
    output.set(name, await readFile(new URL(name, repoRoot)));
  console.log(
    `Secured ${pages.length.toLocaleString("en-US")} documents (${(totalBytes / 1e6).toFixed(2)} MB); setup files' assets are pinned to ${groups.setup.base}, the home page's to ${groups.home.base}`,
  );
  return output;
}

/** Build downloads with the production pipeline, keeping unpublished assets on localhost. */
async function devDownloads(
  pages: readonly SitePage[],
  stylesheets: Record<PageEntry, string>,
  assets: Map<string, Buffer>,
) {
  const result = await bundle({
    configFile: false,
    root: fileURLToPath(webRoot),
    logLevel: "silent",
    build: { write: false, minify: false, rolldownOptions: { input: stylesheets } },
  });
  const css: Partial<Record<PageEntry, string>> = {};
  for (const output of Array.isArray(result) ? result : [result]) {
    if (!("output" in output)) continue;
    for (const file of output.output) {
      const entry = /(?:^|\/)(setup|home)-[\w-]*\.css$/.exec(file.fileName)?.[1] as
        | PageEntry
        | undefined;
      if (file.type === "asset" && entry)
        css[entry] = file.source.toString().replace(/\/\*\$vite\$:\d+\*\/$/, "");
    }
  }
  if (!css.setup || !css.home) throw new Error("Vite compiled no setup or no home stylesheet.");
  const files = await renderSite({ setup: css.setup, home: css.home }, pages);
  const bases = new Map<string, string>();
  for (const { directory, manifest } of Object.values(assetOutputs)) {
    const { commit, base } = JSON.parse(files.get(manifest)!.toString());
    bases.set(base, `${devAssets}${commit}/`);
    for (const [path, bytes] of files)
      if (path.startsWith(`${directory}/`))
        assets.set(`${commit}/${path.slice(directory.length + 1)}`, bytes);
  }
  return { files, bases };
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
    },
    configureServer(server) {
      let downloads: ReturnType<typeof devDownloads> | undefined;
      const getDownloads = () =>
        (downloads ??= devDownloads(pages, stylesheets, assets).catch((error) => {
          downloads = undefined;
          throw error;
        }));
      // The nested production bundles don't enter Vite's dev module graph.
      // Watch their workspace sources as well as the adapter's root.
      server.watcher.add(fileURLToPath(new URL("packages/", repoRoot)));
      server.watcher.on("all", () => {
        downloads = undefined;
      });
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
          // A saved file may be the first request after Vite restarts. Rebuild
          // its content-addressed assets without needing another download first.
          const ready = bytes
            ? Promise.resolve(bytes)
            : /^[a-f0-9]{40}\//.test(name)
              ? getDownloads().then(() => assets.get(name))
              : Promise.resolve(undefined);
          ready
            .then((bytes) => {
              if (!bytes) {
                next();
                return;
              }
              response.setHeader(
                "Content-Type",
                name.endsWith(".json")
                  ? "application/json"
                  : name.endsWith(".css")
                    ? "text/css; charset=utf-8"
                    : name.endsWith(".wasm")
                      ? "application/wasm"
                      : "image/webp",
              );
              response.setHeader("Access-Control-Allow-Origin", "*");
              response.end(request.method === "HEAD" ? undefined : bytes);
            })
            .catch(next);
          return;
        }
        const page = pages.find((candidate) => `/${candidate.path}` === path);
        if (!page) {
          next();
          return;
        }
        if (page.entry === "setup") {
          getDownloads()
            .then(({ files, bases }) => {
              const address = server.httpServer!.address();
              if (!address || typeof address === "string")
                throw new Error("The download needs the dev server's HTTP address.");
              const host = address.family === "IPv6" ? `[${address.address}]` : address.address;
              const origin = `${server.config.server.https ? "https" : "http"}://${host}:${address.port}`;
              let html = files.get(page.path)!.toString();
              for (const [base, local] of bases) html = html.replaceAll(base, origin + local);
              response.setHeader("Content-Type", "application/octet-stream");
              response.setHeader("Content-Disposition", "attachment");
              response.end(request.method === "HEAD" ? undefined : html);
            })
            .catch(next);
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
      const files = await renderSite({ setup: css.setup, home: css.home }, pages);
      for (const [name, bytes] of files) {
        const path = resolve(options.dir!, name);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, bytes);
      }
    },
  };
}
