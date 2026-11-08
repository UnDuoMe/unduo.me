/**
 * The built site, checked end to end: the generated pages and their pinned
 * assets, then the home page, the setup flow from a downloaded file and the
 * integrity rejections in an isolated headless agent-browser session.
 *
 * Plain `vp test` skips this file. Run `vp run build:web`, then `vp run test:web`.
 * Pages load their pinned assets from the preview server's copy of www/cdn/, so
 * a build can be checked before it is published; set UNDUO_PUBLISHED=1 to load
 * them from jsDelivr. It never submits a Duo activation.
 */
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { jsQR } from "@-/com.npmjs.jsqr";
import { QRCode } from "@-/com.npmjs.qrcode";
import { init, parse as parseModules } from "es-module-lexer";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { jsPlugin, scriptComments } from "#auditable-build";
import { getBuildUniversities } from "#build-universities";
import { installedPackage, readCdnSource } from "#cdn-source";
import { reviewedStylesheet, selfContained, trimUikit, usedUikitClasses } from "#self-contained";
import { repoRoot, webOutput } from "#web-paths";

const enabled = Boolean(process.env.UNDUO_TEST_WEB);
const published = process.env.UNDUO_PUBLISHED === "1";
const output = process.env.UNDUO_WEB_OUTPUT
  ? pathToFileURL(join(process.env.UNDUO_WEB_OUTPUT, "/"))
  : webOutput;

const cdn = readCdnSource();
const universities = getBuildUniversities();
const sri = (bytes: Buffer) => `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
const read = (name: string) => readFile(new URL(name, output), "utf8");

let outputFiles: string[];
let schoolFiles: string[];
let assets: { base: string; files: Record<string, string> };
let publishedFiles: string[];
/** The home page's assets commit, apart from the setup files'. */
let homeAssets: { base: string; files: Record<string, string> };
let homePublishedFiles: string[];
let pluginName: string;
let pluginBytes: Buffer;
let html: string;

beforeAll(async () => {
  if (!enabled) return;
  await init();
  outputFiles = await readdir(output);
  schoolFiles = await readdir(new URL("files/", output));
  assets = JSON.parse(await read("cdn.json"));
  publishedFiles = (await readdir(new URL("cdn/", output))).sort();
  homeAssets = JSON.parse(await read("cdn-home.json"));
  homePublishedFiles = (await readdir(new URL("cdn-home/", output))).sort();
  pluginName = publishedFiles.find((name) => name.endsWith(".wasm"))!;
  pluginBytes = await readFile(new URL(`cdn/${pluginName}`, output));
  html = await read("files/unduo");
});

/** Whether a built page is a setup file, which mounts in `#setup`. */
const isSetupPage = (document: string) => /<div id="setup"/.test(document);
/** The assets commit a page pins: the setup files' or the home page's. */
const pinsOf = (document: string) =>
  isSetupPage(document)
    ? { ...assets, published: publishedFiles }
    : { ...homeAssets, published: homePublishedFiles };

/** The setup page's program runs as this many script elements; see `setupParts`. */
const setupPartCount = jsPlugin ? 7 : 6;

/** A screenshot in the setup file's screenshot list. */
interface ListedShot {
  file: string;
  integrity: string;
}
/** Every screenshot in a screenshot list, in each of its sets. */
const listedShots = (list: {
  sets: Record<string, { signedIn: ListedShot[]; settings: ListedShot; steps: ListedShot[] }>;
}) =>
  Object.values(list.sets).flatMap(({ signedIn, settings, steps }) => [
    ...signedIn,
    settings,
    ...steps,
  ]);
/** An attribute's value as the build writes it: `&`, `<` and `"` escaped. */
const unescaped = (value: string) =>
  value.replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&amp;", "&");

/**
 * The setup file names no screenshot: it pins its screenshot list by SHA-256,
 * and the list names every published screenshot with its SHA-256.
 */
function expectScreenshotList(document: string) {
  const url = /\bdata-screenshots-url="([^"]+)"/.exec(document)?.[1] ?? "";
  const name = url.slice(assets.base.length);
  expect(url.startsWith(assets.base) && name.endsWith(".json"), "A published list").toBe(true);
  expect(
    /\bdata-screenshots-integrity="([^"]+)"/.exec(document)?.[1],
    "The screenshot list is pinned by SHA-256",
  ).toBe(assets.files[name]);
  const shots = listedShots(JSON.parse(readFileSync(new URL(`cdn/${name}`, output), "utf8")));
  expect(
    [...new Set(shots.map(({ file }) => file))].sort(),
    "The list names every published portal screenshot",
  ).toEqual(publishedFiles.filter((file) => file.endsWith(".webp")));
  for (const { file, integrity } of shots) expect(integrity, file).toBe(assets.files[file]);
  expect(document, "The file names no screenshot").not.toMatch(/setup-\d-[\w-]+\.[\w-]+\.webp/);
  expect(
    document.includes(`connect-src ${assets.base};`),
    "Fetches may reach only the files of the assets commit",
  ).toBe(true);
}

/** Every document carries all the code it runs; no script loads by URL. */
function expectSelfContained(document: string, name: string) {
  const sources = [...document.matchAll(/<script\b([^>]*)>/gi)].flatMap(([, attributes]) => {
    const url = attributes.match(/\b(?:src|href)\s*=\s*["']?([^"'\s>]+)/i)?.[1];
    return url === undefined ? [] : [url];
  });
  expect(sources, `${name} loads no script by URL`).toEqual([]);
  expect(
    [...document.matchAll(/<script\b[^>]*data-app="unduo"[^>]*>([\s\S]*?)<\/script>/g)].filter(
      ([, code]) => code.trim(),
    ).length,
    `${name} must embed its program in inline script elements`,
  ).toBe(name.endsWith("index.html") && !/\d/.test(name) ? 2 : setupPartCount);
}

/**
 * The experimental self-contained page: its styles and screenshots are in the
 * file, the same bytes the normal build publishes (UIkit trimmed to what the
 * markup uses), and its CSP allows no URL but data: images and Duo's forms.
 */
function expectLoadsNothingByUrl(document: string) {
  const hash = "'sha256-[A-Za-z0-9+/]{43}='";
  const policy = document.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)![1]!;
  expect(policy).toMatch(new RegExp(`(?:^|; )script-src ${hash}(?: ${hash})*;`));
  expect(policy).toMatch(new RegExp(`; style-src-elem ${hash}(?: ${hash})*;`));
  for (const directive of [
    "img-src data:;",
    "connect-src 'none';",
    "form-action https://*.duosecurity.com;",
    // Only setup pages build the frame for Duo's reply.
    ...(document.includes('name: "duo-reply"') ? ["frame-src https://*.duosecurity.com;"] : []),
  ])
    expect(policy).toContain(directive);
  expect(document, "No stylesheet loads by URL").not.toMatch(/<link\b[^>]*rel="stylesheet"/);
  const styles = Object.fromEntries(
    [...document.matchAll(/<style data-vendor="(\w+)"[^>]*>([\s\S]*?)<\/style>/g)].map(
      ([, vendor, css]) => [vendor!, css!],
    ),
  );
  const pins = pinsOf(document);
  const appStyle = pins.published.find((name) => name.endsWith(".css"))!;
  expect(sri(Buffer.from(styles.app!)), "The app stylesheet's published bytes").toBe(
    pins.files[appStyle],
  );
  const uikit = reviewedStylesheet(Object.keys(cdn.assets)[0]!);
  expect(styles.uikit, "UIkit, trimmed to the classes the markup uses").toBe(
    trimUikit(uikit.css, usedUikitClasses(document)),
  );
  const inline = /\bdata-screenshots="([^"]*)"/.exec(document)?.[1];
  if (inline !== undefined)
    expect(
      [
        ...new Set(
          listedShots(JSON.parse(unescaped(inline))).map(({ file }) =>
            sri(Buffer.from(file.slice("data:image/webp;base64,".length), "base64")),
          ),
        ),
      ].sort(),
      "Every institution's portal screenshots, as published",
    ).toEqual(
      publishedFiles
        .filter((name) => name.endsWith(".webp"))
        .map((name) => assets.files[name])
        .sort(),
    );
  expect(document, "No image loads by URL").not.toMatch(/\sdata-image-src=/);
}

/** The page pins its plugin, scripts and styles, and its CSP allows nothing else. */
function expectPinned(document: string) {
  expect(document, "No session storage in the built app").not.toMatch(/\bsessionStorage\b/);
  expect(document).toMatch(/http-equiv="Content-Security-Policy"/);
  expect(document).not.toMatch(/'unsafe-eval'/);
  const pluginUrl = document.match(/\bdata-plugin-url="([^"]+)"/)?.[1];
  /** The experimental build's setup pages run the TypeScript logic and fetch only screenshots. */
  const jsSetup = jsPlugin && isSetupPage(document) && !selfContained;
  if (jsSetup) {
    expect(document).not.toMatch(/\bdata-plugin-(?:url|integrity)=/);
    expectScreenshotList(document);
    expect(document, "No WebAssembly is compiled").not.toMatch(/wasm-unsafe-eval/);
    expect(document, "The inline code documents its guard on the logic's output").toMatch(
      /\/\*\*\n\s*\* Plugin output check\. `guard` checks each output before any other code sees/,
    );
  } else if (pluginUrl) {
    expect(pluginUrl).toBe(assets.base + pluginName);
    expect(
      document.match(/\bdata-plugin-integrity="([^"]+)"/)?.[1],
      "The plugin is pinned by SHA-256",
    ).toBe(sri(pluginBytes));
    expectScreenshotList(document);
    expect(document).toMatch(/'wasm-unsafe-eval'/);
    expect(document, "The inline code documents its guard on plugin output").toMatch(
      /\/\*\*\n\s*\* Plugin output check\. `guard` checks each output before any other code sees/,
    );
  } else {
    // The home page fetches only the AI replies' screenshots, or nothing when they're data: URLs.
    const replies = [
      ...document.matchAll(/\bdata-image-src="([^"]+)" data-image-integrity="([^"]+)"/g),
    ];
    if (!selfContained)
      expect(
        replies.map(([, url]) => /\/(ai-reply-\w+)\./.exec(url!)?.[1]),
        "The AI replies' screenshots",
      ).toEqual(["ai-reply-chatgpt", "ai-reply-claude", "ai-reply-gemini"]);
    for (const [, url, integrity] of replies)
      expect(integrity, url).toBe(homeAssets.files[url!.slice(homeAssets.base.length)]);
    const fetched = replies.map(([, url]) => url!).sort();
    expect(
      document.includes(`connect-src ${fetched.join(" ") || "'none'"};`),
      "Only the screenshot files may be fetched",
    ).toBe(true);
    expect(document).not.toMatch(/wasm-unsafe-eval/);
  }
  if (selfContained) expectLoadsNothingByUrl(document);
  expect(
    document.includes(
      /\sdata-(?:image-src|screenshots-url)=/.test(document)
        ? "img-src data: blob:;"
        : "img-src data:;",
    ),
    "Images are data: URLs or blob: URLs of fetched screenshots",
  ).toBe(true);
  expect(document, "The page declares no import map").not.toMatch(/type="importmap"/i);
  const scripts = [...document.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  expect(
    scripts.every(([, attributes]) => attributes!.includes('data-app="unduo"')),
    "The page runs only its own scripts",
  ).toBe(true);
  expect(document, "No markup sets inline styles").toMatch(/style-src-attr 'none'/);
  for (const [, attributes, code] of scripts) {
    expect(attributes, "Every script is inline").not.toMatch(/\bsrc=/);
    expect(
      parseModules(code)[0].every((entry) => entry.type === "import-meta"),
      "The page's script imports nothing",
    ).toBe(true);
    const hash = createHash("sha256").update(code).digest("base64");
    expect(document.includes(`'sha256-${hash}'`), "CSP allows the script by its hash").toBe(true);
  }
  for (const [, attributes] of document.matchAll(/<link\b([^>]*)>/g)) {
    if (!attributes.includes('rel="stylesheet"')) continue;
    const url = attributes.match(/\bhref="([^"]+)"/)?.[1];
    expect(url, "Stylesheets require an href").toBeTruthy();
    if (cdn.assets[url!]) {
      expect(attributes).toContain(`integrity="${cdn.assets[url!]!.integrity}"`);
      continue;
    }
    const pins = pinsOf(document);
    expect(url!.startsWith(pins.base), "Only reviewed CDN styles and published assets").toBe(true);
    const integrity = pins.files[url!.slice(pins.base.length)];
    expect(
      Boolean(integrity) && attributes.includes(`integrity="${integrity}"`),
      "Published styles require SRI",
    ).toBe(true);
  }
}

describe.runIf(enabled)("static output", () => {
  test("one setup file, files/unduo, serves every institution", () => {
    expect(outputFiles.some((name) => name.startsWith("IAU-"))).toBe(false);
    expect(schoolFiles).toEqual(["unduo"]);
  });

  test("the site has no setup page: its one document is the home page", () => {
    expect(outputFiles.filter((name) => name.endsWith(".html"))).toEqual(["index.html"]);
    expect(
      outputFiles.filter((name) => /^\d{6}/.test(name)),
      "No institution folders",
    ).toEqual([]);
    // Without an extension, GitHub Pages serves a file as application/octet-stream, so it never
    // runs on the site. Deploy checks that on the live file.
    expect(schoolFiles.filter((name) => name.includes("."))).toEqual([]);
  });

  test("every page embeds its own application code", async () => {
    for (let offset = 0; offset < schoolFiles.length; offset += 64) {
      await Promise.all(
        schoolFiles.slice(offset, offset + 64).map(async (id) => {
          const name = `files/${id}`;
          const document = await read(name);
          expect(document.length, `Missing document: ${name}`).toBeGreaterThan(0);
          expectSelfContained(document, name);
        }),
      );
    }
    for (const name of outputFiles.filter((file) => file.endsWith(".html")))
      expectSelfContained(await read(name), name);
  });

  test("www/cdn/ and www/cdn-home/ match their manifests, and pages load nothing same-origin", async () => {
    for (const [directory, manifest, files] of [
      ["cdn", assets, publishedFiles],
      ["cdn-home", homeAssets, homePublishedFiles],
    ] as const) {
      expect(files).toEqual(Object.keys(manifest.files).sort());
      for (const name of files)
        expect(sri(await readFile(new URL(`${directory}/${name}`, output))), name).toBe(
          manifest.files[name],
        );
    }
    // A setup file pins only the setup files' commit, so nothing on the home page changes it.
    expect(html.includes(homeAssets.base), "The setup file pins nothing of the home page's").toBe(
      false,
    );
    expect(Object.keys(homeAssets.files).filter((name) => name.startsWith("setup"))).toEqual([]);
    expect(Object.keys(assets.files).filter((name) => name.startsWith("ai-reply"))).toEqual([]);
    expect(outputFiles, "Pages load published assets, never same-origin ones").not.toContain(
      "assets",
    );
    expect(
      [...publishedFiles, ...homePublishedFiles].filter((name) => /\.m?js$/.test(name)),
      "Application code is inline in each page, never a published script",
    ).toEqual([]);
  });

  test.skipIf(jsPlugin)(
    "the setup plugin imports exactly the kernel functions its comment lists and the page defines",
    () => {
      const imports = WebAssembly.Module.imports(
        new WebAssembly.Module(new Uint8Array(pluginBytes)),
      );
      expect(imports.filter((entry) => entry.module !== "extism:host/env")).toEqual([]);
      const names = imports.map((entry) => entry.name).sort();
      const listed =
        /refuses a module unless it imports exactly ([\w, ]+) and (\w+), which kernel\(\)/.exec(
          html.match(/<div id="root"[^>]*data-comment="([^"]*)"/)![1]!,
        )!;
      expect(names).toEqual([...listed[1]!.split(", "), listed[2]].sort());
      const kernel = html.slice(
        html.indexOf("function kernel("),
        html.indexOf("\treturn {\n\t\timports,"),
      );
      const defined = [...kernel.matchAll(/^\t\t(\w+)(?:\(|: \()/gm)].map((match) => match[1]);
      expect(defined.sort(), "kernel() defines exactly the imported functions").toEqual(names);
    },
  );

  test.skipIf(selfContained)("every class the pages name has a rule in a stylesheet", async () => {
    const url = Object.keys(readCdnSource().assets)[0]!;
    const uikitCss = reviewedStylesheet(url).css;
    for (const name of ["index.html", "files/unduo"]) {
      const document = await read(name);
      // Each page's own stylesheet: the setup files' or the home page's.
      const { published } = pinsOf(document);
      const directory = isSetupPage(document) ? "cdn" : "cdn-home";
      const appCss = await read(`${directory}/${published.find((file) => file.endsWith(".css"))!}`);
      const css = `${appCss}${uikitCss}`;
      const defined = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(([, found]) => found!));
      // UIkit also styles some classes through selectors such as [class*=uk-modal-close-].
      const partial = [...css.matchAll(/\[class\*=["']?([\w-]+)["']?\]/g)].map(([, part]) => part!);
      const hasRule = (token: string) =>
        defined.has(token) || partial.some((part) => token.includes(part));
      if (isSetupPage(document))
        for (const state of ["code-type-on", "code-type-off"]) expect(defined).toContain(state);
      const used = new Set(
        [
          ...document.matchAll(/\bclass(?:Name)?(?:: (?:\(\) =>\s*)?|=)["'`]([^"'`]*)["'`]/g),
          ...document.matchAll(
            /\b(?:\w*[Cc]lass|primary|secondary|card|alert|advice|textButton|instruction) = ["'`]([^"'`]*)["'`]/g,
          ),
        ].flatMap(([, list]) =>
          list!
            // A template's fixed classes come first; what follows is an expression.
            .split("${")[0]!
            .split(/\s+/)
            .filter((token) => /^[a-zA-Z][\w-]*$/.test(token)),
        ),
      );
      expect(used.size, `${name} names classes`).toBeGreaterThan(5);
      expect(
        [...used].filter((token) => !hasRule(token)),
        `${name}'s classes`,
      ).toEqual([]);
    }
  });

  test("the setup page's script elements say what they hold, and VanJS is as published", async () => {
    const document = await read("files/unduo");
    const elements = [
      ...document.matchAll(/<script\b([^>]*\bdata-app="unduo"[^>]*)>([\s\S]*?)<\/script>/g),
    ];
    const attribute = (attributes: string, name: string) =>
      new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1];
    const parts = elements.map(([, attributes]) => attribute(attributes!, "data-part"));
    expect(parts).toEqual(
      jsPlugin
        ? ["vanjs", "plugin-checks", "setup-logic", "qr-codes", "steps", "duo-form", "page"]
        : ["vanjs", "plugin-checks", "qr-codes", "steps", "duo-form", "page"],
    );
    for (const [, attributes, code] of elements) {
      expect(attributes, "Each part is a classic script").not.toMatch(/\btype=/);
      expect(attribute(attributes!, "data-comment"), "Each part says what it holds").toBeTruthy();
      expect(
        attribute(attributes!, "data-requests"),
        "Each part says what it requests",
      ).toBeTruthy();
      if (attribute(attributes!, "data-part") === "vanjs") continue;
      expect(code, "Each part of ours is a strict classic script").toMatch(/^"use strict";\n/);
      expect(attribute(attributes!, "data-source"), "Each part names its sources").toBeTruthy();
    }
    const [, vanjsAttributes, vanjsCode] = elements[0]!;
    const version = installedPackage("vanjs-core").version;
    const published = readFileSync(
      new URL(`packages/com/npmjs/vanjs-core/van-${version}.nomodule.js`, repoRoot),
      "utf8",
    );
    expect(vanjsCode, "The VanJS element holds the published file, byte for byte").toBe(published);
    expect(attribute(vanjsAttributes!, "data-upstream-sha256")).toBe(
      createHash("sha256").update(published).digest("hex"),
    );
    expect(attribute(vanjsAttributes!, "data-upstream")).toMatch(
      new RegExp(
        `^https://raw\\.githubusercontent\\.com/vanjs-org/van/[0-9a-f]{40}/public/van-${version}\\.nomodule\\.js$`,
      ),
    );
    expect(
      elements.slice(1).every(([, , code]) => !code!.includes("addAndScheduleOnFirst")),
      "No other element holds a copy of VanJS",
    ).toBe(true);
    const forms = elements.flatMap(([, attributes, code]) =>
      /\baction: /.test(code!) ? [attribute(attributes!, "data-part")] : [],
    );
    expect(forms, "Only the duo-form element builds a form with an action").toEqual(["duo-form"]);
  });

  test.each([
    ["files/unduo", "setup"],
    ["index.html", "home"],
  ] as const)("%s's script holds and does what its data-comment says", async (name, entry) => {
    const document = await read(name);
    const elements = [
      ...document.matchAll(/<script\b([^>]*\bdata-app="unduo"[^>]*)>([\s\S]*?)<\/script>/g),
    ];
    const comment = scriptComments[entry]!;
    expect(
      elements.map(([, attributes]) => /\bdata-comment="([^"]*)"/.exec(attributes!)?.[1]),
      "One element describes the whole script",
    ).toContain(comment);
    const code = elements.map(([, , held]) => held).join("\n");
    for (const [, names] of comment.matchAll(/\(([\w, ]+)\)/g))
      for (const fn of names!.split(", "))
        expect(code, `the script defines ${fn}`).toMatch(
          new RegExp(`function ${fn}\\(|^\\s+${fn}\\(`, "m"),
        );
    const count = (pattern: RegExp, text = code!) => text.match(pattern)?.length ?? 0;
    // The home page's AI replies are prose that may name these APIs ("Nothing in the
    // page uses innerHTML, eval…"), so a reply string that starts with its verdict doesn't count.
    const withoutReplies = code!.replace(
      /\breply: "(?:\*\*)?Safe: (?:yes|no)\b(?:\\.|[^"\\\n])*"/g,
      'reply: ""',
    );
    expect(
      count(
        /\b(?:XMLHttpRequest|WebSocket|WebTransport|EventSource|sendBeacon|RTCPeerConnection|Worker|importScripts|eval|Function|innerHTML|outerHTML|insertAdjacentHTML|requestSubmit)\b|document\.write|\.submit\(/g,
        withoutReplies,
      ),
      "No other request, code or HTML APIs",
    ).toBe(0);
    // The experimental build's QR decoder declares a local variable named location.
    const navigation = jsPlugin
      ? /(?<![\w.]|(?:const|let|var) )location\s*=|location\.(?:href\s*=|assign\(|reload\()/g
      : /(?<![\w.])location\s*=|location\.(?:href\s*=|assign\(|reload\()/g;
    expect(count(navigation)).toBe(0);
    // Elements are built in the script, so its properties name every URL they can hold.
    const urls = [
      ...code!.matchAll(
        /(?<![\w$.\-"'`])(?:href|src|action|formAction|srcset|poster)(?:: [^\n]*|,)/g,
      ),
    ].map(([property]) => property.replace(/,$/, ""));
    const markup = document
      .replace(/<script\b[\s\S]*?<\/script>/g, "")
      .replace(/<style\b[\s\S]*?<\/style>/g, "");
    expect(markup, "No attribute in the markup holds an expression").not.toMatch(
      /\s(?:x-[\w.-]+|:[\w.-]+|@[\w.-]+)=/,
    );
    expect(code, "The script holds VanJS").toMatch(
      /\baddAndScheduleOnFirst\b[\s\S]*\bupdateDoms\b/,
    );
    if (entry === "setup") {
      if (jsPlugin)
        expect(count(/\bfetch\(/g), "Fetches of the screenshots and the CSP probe").toBe(2);
      else
        expect(
          count(/\bfetch\(/g),
          "Fetches of the plugin, the screenshots and the CSP probe",
        ).toBe(3);
      expect(code).toContain('fetch("data:,")');
      expect(count(/createObjectURL\(/g), "blob: URLs only for screenshots").toBe(1);
      expect(count(/(?<![\w$])(?:window\.)?open\(/g), "One window.open, the portal popup").toBe(1);
      expect(count(/location\.replace\(/g)).toBe(0);
      expect(urls.sort()).toEqual([
        'action: () => view.val.request?.url ?? ""',
        'href: "#setup-card"',
        'href: "https://github.com/UnDuoMe/unduo.me"',
        'href: () => view.val.account?.uri ?? ""',
        "href: home",
        "href: portalUrl",
        "href: school.sourceUrl",
        "src: qr.val",
      ]);
      expect(count(/\.src = /g), "The only other source is a screenshot's blob: URL").toBe(1);
    } else {
      expect(count(/\bfetch\(/g), "Fetches of the AI replies' screenshots").toBe(1);
      expect(count(/(?<![\w$])(?:window\.)?open\(/g), "One window.open, the chosen AI's").toBe(1);
      expect(count(/createObjectURL\(/g), "blob: URLs only for screenshots").toBe(1);
      expect(count(/\.src = /g), "The only source is a screenshot's blob: URL").toBe(1);
      expect(count(/location\.replace\(/g), "Old ?university= links stay on this page").toBe(0);
      expect(count(/history\.pushState\(/g), "The chosen institution and step").toBe(1);
      expect(urls.sort()).toEqual([
        'href: "./files/unduo"',
        'href: "https://chatgpt.com/"',
        'href: "https://claude.ai/"',
        'href: "https://gemini.google.com/"',
        'href: "https://github.com/UnDuoMe/unduo.me"',
        'href: "mailto:contact@unduo.me"',
        "href: choice.href",
      ]);
    }
  });

  test.each(["index.html", "files/unduo"])(
    "%s pins its plugin, scripts, styles and CSP",
    async (name) => expectPinned(await read(name)),
  );

  test("UIkit supplies styles only, and the markup holds each institution's details", async () => {
    expect(html, "UIkit supplies styles only, never scripts").not.toMatch(/<script[^>]*uikit/);
    expect(
      html,
      "The script reads each institution's portal link from the page's own markup",
    ).toMatch(
      /<template id="setup-schools"><div data-school-id="IAU-020599"[^>]*\sdata-portal-url="https:\/\/enroll\.utormfa\.utoronto\.ca\/"/,
    );
    expect(
      /<div id="setup"[^>]*>/.exec(html)?.[0],
      "The #setup element pins the screenshot list and holds no institution's details",
    ).toMatch(
      selfContained
        ? /^<div id="setup" data-screenshots="[^"]+"(?![^>]*data-school)/
        : /^<div id="setup" data-screenshots-url="[^"]+" data-screenshots-integrity="[^"]+"(?![^>]*data-school)/,
    );
    // An AI reads the downloaded file, so it must not hold the question put to that AI.
    expect(await read("index.html")).toContain("Safe: yes");
    expect(html).not.toMatch(/Safe: (?:yes|no)|The attached file is from a website/);
  });
});

describe.runIf(enabled)("browser", { timeout: 180_000 }, () => {
  let temporary: string;
  let isolated: string;
  let fixture: string;
  let config: string;
  let hosted: string;
  let cdnBase: string;
  let homeCdnBase: string;
  let preview: ReturnType<typeof spawn> | undefined;
  const session = `unduo-auditable-${process.pid}`;
  /** The download, saved under the name the home page gives it for UofT. */
  const downloaded = "UnDuo - University of Toronto.html";
  const environment = { ...process.env };
  for (const key of [
    "AGENT_BROWSER_HEADED",
    "AGENT_BROWSER_AUTO_CONNECT",
    "AGENT_BROWSER_CDP",
    "AGENT_BROWSER_PROFILE",
    "AGENT_BROWSER_PROVIDER",
  ])
    delete environment[key];

  const localCopy = (document: string) =>
    published
      ? document
      : document.replaceAll(assets.base, cdnBase).replaceAll(homeAssets.base, homeCdnBase);

  function browser(...args: string[]): string {
    if (args[0] === "wait") browser("tab", "t1");
    const result = execFileSync(
      process.env.AGENT_BROWSER_BIN || "agent-browser",
      ["--config", config, "--session", session, ...args],
      { encoding: "utf8", timeout: 45_000, maxBuffer: 16 * 1024 * 1024, env: environment },
    ).trim();
    // Select only this managed headless tab so CSS transitions can complete.
    if (args[0] === "open") browser("tab", "t1");
    return result;
  }
  function evaluate(expression: string): unknown {
    return JSON.parse(browser("--json", "eval", expression)).data.result;
  }
  function click(role: string, name: string) {
    const snapshot = browser("snapshot", "-i");
    const line = snapshot.split("\n").find((entry) => entry.includes(`${role} "${name}"`));
    const ref = line?.match(/\bref=(e\d+)\]/)?.[1];
    expect(ref, `Missing ${role}: ${name}\n${snapshot}`).toBeTruthy();
    browser("click", `@${ref}`);
  }
  function waitForHeading(heading: string) {
    browser(
      "wait",
      "--fn",
      `document.querySelector('#step-title')?.textContent === ${JSON.stringify(heading)}`,
    );
  }
  /** Write a changed copy of the download next to it and open it. */
  async function openVariant(name: string, document: string) {
    const file = join(isolated, name);
    await writeFile(file, document);
    browser("open", pathToFileURL(file).href);
  }

  beforeAll(async () => {
    temporary = await mkdtemp(join(tmpdir(), "unduo-auditable-"));
    isolated = join(temporary, "isolated");
    await mkdir(isolated);
    fixture = join(temporary, "activation.png");
    await QRCode.toFile(fixture, "https://m-12345678.duosecurity.com/activate/TESTCODE123", {
      width: 400,
    });
    config = join(temporary, "browser.json");
    await writeFile(
      config,
      JSON.stringify({ headed: false, autoConnect: false, engine: "chrome" }),
    );
    const server = spawn(process.execPath, [new URL("../preview.mjs", import.meta.url).pathname], {
      env: { ...process.env, PORT: "0", UNDUO_LOCAL_CDN: published ? "" : "1" },
      stdio: ["ignore", "pipe", "inherit"],
    });
    preview = server;
    hosted = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Preview failed to start")), 5_000);
      server.once("error", reject);
      server.stdout.on("data", (chunk: Buffer) => {
        const url = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
        if (url) {
          clearTimeout(timeout);
          resolve(url);
        }
      });
    });
    cdnBase = published ? assets.base : `${hosted}/cdn/`;
    homeCdnBase = published ? homeAssets.base : `${hosted}/cdn-home/`;
    await writeFile(join(isolated, downloaded), localCopy(html));
    expect(await readdir(isolated), "The download is one file").toEqual([downloaded]);
  }, 60_000);

  afterAll(async () => {
    preview?.kill();
    if (config) {
      try {
        browser("close");
      } catch {
        // The session never started.
      }
    }
    if (temporary) await rm(temporary, { recursive: true, force: true });
  });

  /** The QR code the page drew, read back by an independent decoder, is the guarded link. */
  function expectQrMatchesLink() {
    const image = `document.querySelector('img[alt*="authenticator QR code"]')`;
    browser("wait", "--fn", `${image}?.complete && ${image}.naturalWidth > 0`);
    const drawn = evaluate(`(() => {
      const image = ${image};
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let dark = '';
      for (let index = 0; index < data.length; index += 4) dark += data[index] < 128 ? '1' : '0';
      const link = document.querySelector('a[href^="otpauth:"]')?.getAttribute('href');
      return { width: canvas.width, height: canvas.height, dark, link };
    })()`) as { width: number; height: number; dark: string; link: string };
    const pixels = new Uint8ClampedArray(drawn.width * drawn.height * 4);
    for (let index = 0; index < drawn.dark.length; index++) {
      pixels.fill(drawn.dark[index] === "1" ? 0 : 255, index * 4, index * 4 + 3);
      pixels[index * 4 + 3] = 255;
    }
    expect(drawn.link).toMatch(/^otpauth:\/\/totp\/Duo:ACME%20University\?secret=ON2XAZLS/);
    expect(jsQR(pixels, drawn.width, drawn.height)?.data, "The QR code encodes the link").toBe(
      drawn.link,
    );
  }

  function verifyFlow(urlForFlow: string) {
    const query = "location.hash.slice(1)";
    /** Whether the page asks before unloading, as it should while it holds an activation or key. */
    const guardsLeaving = "!window.dispatchEvent(new Event('beforeunload', { cancelable: true }))";
    /** The activation and key never reach the address, history state or browser storage. */
    const keepsSecretsInMemory = `!/TESTCODE|ON2X|supersecret|ACME/i.test(decodeURIComponent(
      location.href + JSON.stringify([history.state, { ...localStorage }, { ...sessionStorage }])))`;
    const pasteReply = `(() => {
      const data = new DataTransfer();
      data.setData('text/plain', JSON.stringify({stat:'OK',response:{customer_name:'ACME University',hotp_secret:'supersecretkey'}}));
      document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true}));
    })()`;
    browser("network", "requests", "--clear");
    browser("open", `${urlForFlow}?type=totp`);
    browser("set", "media", "light", "reduced-motion");
    waitForHeading("Open your Duo device portal");
    // The page drops the query once as it opens, and never changes its address after that.
    expect(evaluate("location.search")).toBe("");
    expect(evaluate("location.hash")).toBe("");
    const entries = evaluate("history.length");
    expect(evaluate("!!document.querySelector('a[download]')")).toBe(false);
    expect(evaluate("document.querySelectorAll('#setup-progress li').length")).toBe(5);
    expect(
      evaluate("!!document.querySelector('#university')"),
      "Setup has no university picker",
    ).toBe(false);
    expect(evaluate("document.querySelector('main p').textContent")).toBe("University of Toronto");
    expect(evaluate("document.activeElement === document.body"), "Nothing steals focus").toBe(true);
    const back = "[...document.querySelectorAll('button')].find((b) => b.textContent === 'Back')";
    expect(evaluate(`!${back}.checkVisibility()`), "The first step has no Back").toBe(true);
    expect(
      evaluate(
        "document.querySelector('a[href=\"https://enroll.utormfa.utoronto.ca/\"]')?.textContent",
      ),
    ).toBe("Open University of Toronto's Duo portal");
    browser("focus", 'a[href="#setup-card"]');
    browser("press", "Enter");
    browser("wait", "--fn", "document.activeElement.id === 'step-title'");

    browser("wait", "--fn", "!!document.querySelector('[data-vendor=app]').sheet");
    expect(evaluate("getComputedStyle(document.body).backgroundColor")).toBe("rgb(248, 250, 252)");
    // The help dialogs are native popovers: no script opens or closes them.
    click("button", "How it works");
    browser(
      "wait",
      "--fn",
      "document.querySelector('#setup-guide').matches(':popover-open:focus-within')",
    );
    expect(evaluate("document.querySelector('#setup-guide').getAttribute('role')")).toBe("dialog");
    click("button", "Got it");
    browser("wait", "--fn", "!document.querySelector('#setup-guide').matches(':popover-open')");
    click("button", "Privacy");
    browser(
      "wait",
      "--fn",
      "document.querySelector('#setup-privacy').matches(':popover-open:focus-within')",
    );
    browser("press", "Escape");
    browser("wait", "--fn", "!document.querySelector('#setup-privacy').matches(':popover-open')");

    // The portal opens in a popup beside the steps, with no handle back to this page;
    // a blocked popup follows the link instead. window.open is stubbed to stay offline.
    const openPortal = (opened: string) =>
      evaluate(`(() => {
        const open = window.open;
        const calls = [];
        const opened = ${opened};
        window.open = (...args) => (calls.push(args), opened);
        let followed;
        const stop = (event) => { followed = !event.defaultPrevented; event.preventDefault(); };
        document.addEventListener('click', stop);
        document.querySelector('a[href="https://enroll.utormfa.utoronto.ca/"]').click();
        document.removeEventListener('click', stop);
        window.open = open;
        const [url, name, features] = calls[0] ?? [];
        return { followed, url, name, popup: /^popup,/.test(features), opener: opened?.opener };
      })()`);
    expect(openPortal("{ opener: window }")).toEqual({
      followed: false,
      url: "https://enroll.utormfa.utoronto.ca/",
      name: "duo-portal",
      popup: true,
      opener: null,
    });
    expect(openPortal("null")).toMatchObject({ followed: true, popup: true });
    // Instead of guidance, an example of Duo once signed in, with only the device blurred.
    expect(evaluate("document.querySelector('.signed-in-text').textContent")).toBe(
      "Press Continue when you see a page like this:",
    );
    browser(
      "wait",
      "--fn",
      "[...document.querySelectorAll('.signed-in-example img')].every((img) => img.naturalWidth > 0)",
    );
    expect(
      evaluate(
        "[...document.querySelectorAll('.signed-in-example figure')].map((figure) => [figure.querySelector('figcaption').textContent, figure.querySelector('img').alt, figure.querySelector('img').src.slice(0, 5)])",
      ),
    ).toEqual(
      [
        [
          "In a narrow window",
          "Duo's sign-in prompt in a narrow window, with the device's name and number blurred",
        ],
        [
          "In a wide window",
          "Duo's sign-in prompt in a wide window, with the device's name and number blurred",
        ],
      ].map((figure) => [...figure, selfContained ? "data:" : "blob:"]),
    );
    expect(evaluate("document.querySelector('#setup-card').textContent")).not.toMatch(
      /Choose a different university|Manage devices/,
    );
    expect(evaluate("document.querySelector('#portal-url').value")).toBe(
      "https://enroll.utormfa.utoronto.ca/",
    );
    click("button", "Copy");
    browser(
      "wait",
      "--fn",
      "document.querySelector('#portal-url + button').textContent === 'Copied'",
    );

    click("button", "Continue");

    // 2: authenticate as usual until Duo shows My Settings & Devices, as the blurred example shows.
    waitForHeading("Authenticate with Duo");
    expect(evaluate("document.querySelector('#setup-card .intro').textContent")).toBe(
      "Authenticate with Duo as you normally would, with either a passcode or a push.",
    );
    expect(evaluate("document.querySelector('.signed-in-text').textContent")).toBe(
      "Press Continue once you land on the My Settings & Devices page:",
    );
    browser("wait", "--fn", "document.querySelector('.signed-in-example img')?.naturalWidth > 0");
    expect(
      evaluate(
        "(({ alt, src }) => [alt, src.slice(0, 5)])(document.querySelector('.signed-in-example img'))",
      ),
    ).toEqual([
      "Duo's My Settings & Devices page, with the devices' names and numbers blurred",
      selfContained ? "data:" : "blob:",
    ]);
    browser("wait", "--fn", "document.activeElement.id === 'step-title'");
    click("button", "Continue");
    waitForHeading("Copy the activation QR code");
    // The page scrolls to the step's title and focuses it a task later.
    browser("wait", "--fn", "document.activeElement.id === 'step-title'");
    browser(
      "wait",
      "--fn",
      "[...document.querySelectorAll('[aria-label=\"Duo portal example screenshots\"] img')].every(img => img.naturalWidth > 0)",
    );
    if (selfContained)
      expect(
        evaluate(
          `[...document.querySelectorAll('[aria-label="Duo portal example screenshots"] img')].filter(img => img.src.startsWith('data:image/webp;base64,')).length`,
        ),
        "Each screenshot is in the file",
      ).toBe(5);
    else
      expect(
        evaluate(
          `[...document.querySelectorAll('[aria-label="Duo portal example screenshots"] img')].filter(img => img.src.startsWith('blob:') && ${JSON.stringify(publishedFiles)}.includes(img.dataset.screenshot)).length`,
        ),
        "Each screenshot shows its fetched file",
      ).toBe(5);
    browser("upload", "input[type=file]", fixture);
    waitForHeading("Activate with Duo");
    expect(evaluate("document.querySelector('form').action")).toBe(
      "https://api-12345678.duosecurity.com/push/v2/activation/TESTCODE123?customer_protocol=1",
    );
    // The native POST to Duo, built in the script: the attributes the browser submits with.
    expect(
      evaluate(
        "(({ method, enctype, target, rel }) => [method, enctype, target, rel])(document.querySelector('form'))",
      ),
    ).toEqual(["post", "application/x-www-form-urlencoded", "duo-reply", "noopener noreferrer"]);
    // Duo's reply goes to the one sandboxed frame, not a new tab, whose address would enter history.
    expect(
      evaluate(
        "[...document.querySelectorAll('iframe')].flatMap(frame => [frame.name, frame.getAttribute('sandbox'), frame.getAttribute('src')])",
      ),
    ).toEqual(["duo-reply", "", null]);
    // No button sends the form anywhere else, such as a new tab.
    expect(
      evaluate(
        "[...document.querySelectorAll('button')].filter(button => button.formTarget).map(button => button.formTarget)",
      ),
    ).toEqual([]);
    // A second policy then limits forms to that one Duo host.
    expect(
      evaluate(
        "[...document.querySelectorAll('meta[http-equiv=\"Content-Security-Policy\"]')].map(meta => meta.content).slice(1)",
      ),
    ).toEqual([
      "form-action https://api-12345678.duosecurity.com; frame-src https://api-12345678.duosecurity.com",
    ]);
    // The guard writes the fields and the page's key; the plugin names only the URL.
    expect(evaluate("[...new FormData(document.querySelector('form')).keys()].join()")).toBe(
      "pkpush,pubkey,jailbroken,architecture,region,app_id,full_disk_encryption,passcode_status,platform,app_version,app_build_number,version,manufacturer,language,model,security_patch_level",
    );
    expect(evaluate("new FormData(document.querySelector('form')).get('pubkey')")).toMatch(
      /^-----BEGIN PUBLIC KEY-----\n(?:[A-Za-z0-9+/]{64}\n)+[A-Za-z0-9+/=]{1,64}\n-----END PUBLIC KEY-----\n$/,
    );
    expect(evaluate(query), "The step never reaches the address").toBe("");
    expect(evaluate("history.length"), "Setup adds no history entries").toBe(entries);
    expect(evaluate(keepsSecretsInMemory)).toBe(true);
    expect(evaluate(guardsLeaving)).toBe(true);
    expect(
      evaluate("document.querySelector('#duo-reply')?.getClientRects().length ?? 0"),
      "Reply controls stay hidden until submission",
    ).toBe(0);
    // A refresh discards the activation and opens the portal.
    browser("reload");
    waitForHeading("Open your Duo device portal");
    expect(evaluate("document.querySelectorAll('form').length")).toBe(0);
    expect(evaluate(query)).toBe("");
    expect(evaluate(guardsLeaving)).toBe(false);
    click("button", "Continue");
    waitForHeading("Authenticate with Duo");
    browser("wait", "--fn", "document.activeElement.id === 'step-title'");
    click("button", "Continue");
    waitForHeading("Copy the activation QR code");
    browser("upload", "input[type=file]", fixture);
    waitForHeading("Activate with Duo");
    browser("wait", "--fn", "document.querySelector('form')?.action.includes('duosecurity.com')");

    // Exercise the reply form without submitting anything to Duo.
    // Synthetic events exercise the guard without invoking native submission.
    expect(
      evaluate(`(() => {
      const form = document.querySelector('form');
      const options = { bubbles: true, cancelable: true };
      const accepted = form.dispatchEvent(new SubmitEvent('submit', options));
      const duplicate = form.dispatchEvent(new SubmitEvent('submit', options));
      window.__unduoSubmittedForm = form;
      return { accepted, duplicate };
    })()`),
    ).toEqual({ accepted: true, duplicate: false });
    browser("wait", "--fn", "document.querySelector('#duo-reply').checkVisibility()");
    expect(
      evaluate("window.__unduoSubmittedForm.isConnected && window.__unduoSubmittedForm.hidden"),
    ).toBe(true);
    browser("fill", "#duo-reply", "not a Duo reply");
    evaluate("(window.__unduoReply = document.querySelector('#duo-reply'), 0)");
    click("button", "Create my authenticator");
    browser("wait", "#reply-error");
    browser("wait", "--fn", "document.querySelector('#reply-error').checkVisibility()");
    expect(
      evaluate("document.querySelector('#duo-reply') === window.__unduoReply"),
      "A new view updates the step's elements instead of rebuilding them",
    ).toBe(true);
    expect(evaluate("document.querySelector('#duo-reply').getAttribute('aria-invalid')")).toBe(
      "true",
    );
    browser(
      "fill",
      "#duo-reply",
      JSON.stringify({
        stat: "OK",
        response: { customer_name: "ACME University", hotp_secret: "supersecretkey" },
      }),
    );
    click("button", "Create my authenticator");
    waitForHeading("Add it to your authenticator");
    browser(
      "wait",
      "--fn",
      `document.querySelector('img[alt*="authenticator QR code"]')?.naturalWidth > 0`,
    );
    click("radio", "Time-based");
    browser("wait", "--fn", "document.querySelector('input[value=totp]').checked");
    expect(evaluate(keepsSecretsInMemory)).toBe(true);
    expectQrMatchesLink();
    expect(evaluate(query), "Neither the step nor the code type reaches the address").toBe("");
    expect(evaluate("history.length"), "Setup adds no history entries").toBe(entries);
    click("button", "Show");
    expect(
      evaluate("document.querySelector('[role=group][aria-label=\"Setup key\"] code').textContent"),
    ).toMatch(/ON2X AZLS/);
    click("button", "Hide");
    click("button", "Start over");
    waitForHeading("Open your Duo device portal");
    expect(evaluate("document.querySelectorAll('form').length")).toBe(0);
    expect(evaluate(query)).toBe("");
    expect(evaluate(guardsLeaving)).toBe(false);
    expect(evaluate("history.length"), "Setup adds no history entries").toBe(entries);

    // Refreshing at the last step clears the key, and its address cannot restore it.
    // Start a fresh page before reusing the synthetic fixture from the first flow.
    browser("reload");
    waitForHeading("Open your Duo device portal");
    click("button", "Continue");
    waitForHeading("Authenticate with Duo");
    browser("wait", "--fn", "document.activeElement.id === 'step-title'");
    click("button", "Continue");
    waitForHeading("Copy the activation QR code");
    browser("upload", "input[type=file]", fixture);
    waitForHeading("Activate with Duo");
    expect(
      evaluate(
        "document.querySelector('form').dispatchEvent(new SubmitEvent('submit', {bubbles:true,cancelable:true}))",
      ),
    ).toBe(true);
    browser("wait", "--fn", "document.querySelector('#duo-reply').checkVisibility()");
    evaluate(pasteReply);
    waitForHeading("Add it to your authenticator");
    expect(evaluate(keepsSecretsInMemory)).toBe(true);
    expect(evaluate(guardsLeaving)).toBe(true);
    const finishedHref = String(evaluate("location.href"));
    browser("reload");
    waitForHeading("Open your Duo device portal");
    expect(evaluate(query)).toBe("");
    browser("open", finishedHref);
    waitForHeading("Open your Duo device portal");
    expect(evaluate(query)).toBe("");
    // Links from the earlier base64 format carried the key: it is ignored and dropped from the address.
    const oldLink = Buffer.from(
      JSON.stringify({
        version: 1,
        search: { step: "add" },
        session: { account: { customer: "ACME University", secret: "ON2XAZLSONSWG4TFORVWK6I" } },
      }),
    ).toString("base64");
    browser("open", `${urlForFlow}#${oldLink}`);
    browser("reload");
    waitForHeading("Open your Duo device portal");
    expect(evaluate("location.hash")).toBe("");
    expect(evaluate(keepsSecretsInMemory)).toBe(true);
    expect(browser("errors")).toBe("");
    const messages: { type: string }[] = JSON.parse(browser("--json", "console")).data.messages;
    expect(
      messages.filter(
        (message) =>
          message.type === "error" &&
          // The CSP blocking the page's own data: probe, as it must.
          !/Refused to connect to 'data:,'/.test((message as { text?: string }).text ?? ""),
      ),
      "No console errors expected",
    ).toEqual([]);
    const requests: unknown = JSON.parse(browser("--json", "network", "requests")).data;
    const urls = evaluate(
      "performance.getEntriesByType('resource').map(entry => entry.name).filter(url => /^https?:/.test(url))",
    ) as string[];
    expect(evaluate("document.querySelectorAll('script[src]').length")).toBe(0);
    for (const url of urls) {
      expect(
        Boolean(
          cdn.assets[url] ||
          (url.startsWith(cdnBase) && Object.hasOwn(assets.files, url.slice(cdnBase.length))) ||
          (url.startsWith(homeCdnBase) &&
            Object.hasOwn(homeAssets.files, url.slice(homeCdnBase.length))),
        ),
        `Unexpected runtime request: ${url}`,
      ).toBe(true);
      expect(
        new URL(url).pathname,
        "Only reviewed style, image and plugin assets and the screenshot list may be requested",
      ).toMatch(/\.(css|webp|wasm)$|\/screenshots\.[\w-]+\.json$/);
    }
    expect(JSON.stringify(requests), "No activation requests expected").not.toContain(
      "duosecurity.com",
    );
    if (jsPlugin)
      expect(
        urls.filter((url) => url.endsWith(".wasm")),
        "The experimental build fetches no WebAssembly",
      ).toEqual([]);
    if (selfContained) expect(urls, "The self-contained page requests nothing").toEqual([]);
  }

  test("home: a searchable dropdown, a dialog per institution, old links and unpublished institutions", async () => {
    const inDialog = (button: string) =>
      `[...document.querySelectorAll('#home-dialog .step-nav button')].find((b) => b.textContent === ${JSON.stringify(button)})`;
    const visible = (button: string) => evaluate(`!!${inDialog(button)}?.checkVisibility()`);
    const dialogOpen = () => evaluate("document.querySelector('#home-dialog').open");
    /**
     * The dialog at `heading`, settled: each step change ends a task later by
     * focusing the step's title, which can scroll the dialog, so a click aimed
     * before then can miss.
     */
    const waitForStep = (heading: string) => {
      waitForHeading(heading);
      browser("wait", "--fn", "document.activeElement.id === 'step-title'");
    };
    /**
     * The dialog is closed as soon as close() returns, but the address follows in
     * its close event, a task later. Waiting for both keeps the next step from
     * racing that pushState, which would also cancel a navigation started first.
     */
    const waitForClosed = () =>
      browser(
        "wait",
        "--fn",
        "!document.querySelector('#home-dialog').open && location.pathname + location.search + location.hash === '/'",
      );
    const dropdownOpen = () => evaluate("!document.querySelector('#university-dropdown').hidden");
    const address = () => evaluate("location.pathname + location.search + location.hash");
    const focused = () =>
      evaluate("document.activeElement.id || document.activeElement.textContent");

    // The page: the name, the line, why to trust it and one search field, with nothing open and nothing to download.
    browser("open", hosted);
    browser("wait", "#university");
    expect(evaluate("document.querySelector('h1').textContent")).toBe("UnDuo");
    expect(evaluate("document.querySelector('.home-tagline').textContent")).toBe(
      "A secure way to use any 2FA app for your school login.",
    );
    expect(evaluate("document.querySelector('.home-tagline strong').textContent")).toBe("secure");
    expect(evaluate("document.querySelector('.home-tagline em').textContent")).toBe("any");
    expect(evaluate("document.querySelector('.home-subtext').textContent")).toBe(
      "UnDuo is a secure, single file that you can audit and use locally.",
    );
    expect(
      evaluate(
        "[document.querySelector('.home-start-text').textContent, !!document.querySelector('.home-start #university')]",
      ),
      "The search is in a card of its own, under the line that says to start there",
    ).toEqual(["Select your university below to get started:", true]);
    expect(
      evaluate(
        "[...document.querySelectorAll('.home-hero input, .home-hero button, .home-hero a')].map((field) => [field.id, field.getAttribute('role'), field.placeholder, field.labels[0].textContent])",
      ),
      "The hero shows one search field",
    ).toEqual([
      ["university", "combobox", "Search for your university...", "Select Your University"],
    ]);
    expect(
      evaluate(
        "[...document.querySelectorAll('footer a')].map(({ href, ariaLabel, textContent }) => [href, ariaLabel ?? textContent])",
      ),
      "The footer has an email link to contact UnDuo and GitHub's mark for the source",
    ).toEqual([
      ["mailto:contact@unduo.me", "contact@unduo.me"],
      ["https://github.com/UnDuoMe/unduo.me", "Source on GitHub"],
    ]);
    expect(dropdownOpen()).toBe(false);
    expect(dialogOpen()).toBe(false);
    expect(evaluate("!!document.querySelector('.step-item')"), "No stepper").toBe(false);
    expect(evaluate("!!document.querySelector('a[download]')")).toBe(false);
    expect(evaluate("document.activeElement === document.body"), "Nothing steals focus").toBe(true);
    // Under the hero: what ChatGPT, Claude and Gemini said, each screenshot a pinned file.
    browser(
      "wait",
      "--fn",
      "[...document.querySelectorAll('.reply-card .reply-shot')].every((image) => image.src.startsWith('blob:') && image.naturalWidth > 0)",
    );
    expect(
      evaluate(
        "[...document.querySelectorAll('.reply-card')].map((card) => [card.querySelector('.reply-name').textContent, card.querySelector('.reply-verdict').textContent, card.querySelectorAll('.reply-shot').length])",
      ),
    ).toEqual([
      ["ChatGPT", "Safe: yes", 1],
      ["Claude", "Safe: yes", 1],
      ["Gemini", "Safe: yes", 1],
    ]);
    expect(evaluate("document.querySelector('#ai-replies-title').textContent")).toBe(
      "Fully safe, but don't take our word for it.",
    );
    expect(
      evaluate("[...document.querySelectorAll('.section-lead')].map((line) => line.textContent)"),
    ).toEqual([
      "You can audit UnDuo with all the major AIs: ChatGPT, Claude, and Gemini.",
      "All three classify it as fully safe.",
    ]);
    // Each card shows the whole reply, nothing cut off or scrolled, and the whole screenshot.
    expect(
      evaluate(
        "[...document.querySelectorAll('.reply-card')].map((card) => card.querySelector('.reply-text').textContent.startsWith('Safe: yes'))",
      ),
    ).toEqual([true, true, true]);
    expect(
      evaluate(
        "[...document.querySelectorAll('.reply-text')].map((text) => [getComputedStyle(text).overflowY, getComputedStyle(text).maxHeight, text.scrollHeight <= text.clientHeight + 1])",
      ),
    ).toEqual([
      ["visible", "none", true],
      ["visible", "none", true],
      ["visible", "none", true],
    ]);
    expect(
      evaluate(
        "[...document.querySelectorAll('.reply-card .reply-shot')].every((image) => Math.abs(image.clientHeight / image.clientWidth - image.naturalHeight / image.naturalWidth) < 0.01)",
      ),
      "Screenshots keep their shape, uncropped",
    ).toBe(true);
    // A screenshot opens larger, and Escape closes it.
    evaluate("document.querySelector('.reply-shot-button').click()");
    expect(
      evaluate(
        "[document.querySelector('#reply-viewer').open, document.querySelector('#reply-viewer img').src.startsWith('blob:')]",
      ),
    ).toEqual([true, true]);
    browser("press", "Escape");
    expect(evaluate("document.querySelector('#reply-viewer').open")).toBe(false);
    // A carousel shows one reply at a time: the arrows wrap around, and each AI's button jumps to it.
    const slides = () =>
      evaluate(
        "[document.querySelector('.reply-track').dataset.slide, [...document.querySelectorAll('.reply-card')].map((card) => card.inert), [...document.querySelectorAll('.reply-pick')].map((pick) => pick.ariaCurrent)]",
      );
    expect(slides()).toEqual(["0", [false, true, true], ["true", "false", "false"]]);
    evaluate("document.querySelector('[aria-label=\"Previous reply\"]').click()");
    browser("wait", "--fn", "document.querySelector('.reply-track').dataset.slide === '2'");
    expect(slides()).toEqual(["2", [true, true, false], ["false", "false", "true"]]);
    evaluate("document.querySelector('[aria-label=\"Next reply\"]').click()");
    browser("wait", "--fn", "document.querySelector('.reply-track').dataset.slide === '0'");
    evaluate("document.querySelectorAll('.reply-pick')[1].click()");
    browser("wait", "--fn", "document.querySelector('.reply-track').dataset.slide === '1'");
    expect(slides()).toEqual(["1", [true, false, true], ["false", "true", "false"]]);
    // Once the track has slid, the carousel is as tall as the reply in view, not the longest one.
    browser(
      "wait",
      "--fn",
      "Math.abs(document.querySelector('.reply-track').offsetHeight - document.querySelector('.reply-card:not([inert])').offsetHeight) < 2",
    );
    // How UnDuo works: stacked cards, each with a drawing that's hidden from screen readers.
    expect(
      evaluate(
        "[...document.querySelectorAll('.how-step')].map((step) => [step.querySelector('.how-number').textContent, step.querySelector('.how-title').textContent, step.querySelector('.how-art').getAttribute('aria-hidden')])",
      ),
    ).toEqual([
      ["Step 1", "Get a new QR code from Duo.", "true"],
      ["Step 2", "UnDuo converts it to a 2FA QR Code.", "true"],
      ["Step 3", "Scan this 2FA QR Code with your favorite 2FA app.", "true"],
    ]);
    // Get Started, at the bottom under its call to action, jumps straight back to the search, focuses it and opens its list.
    expect(evaluate("document.querySelector('.cta-title').textContent")).toBe(
      "Ready to replace Duo with a secure 2FA app?",
    );
    expect(evaluate("document.querySelector('.cta-button').textContent")).toBe("Get Started");
    evaluate("document.querySelector('footer').scrollIntoView({ behavior: 'instant' })");
    evaluate("document.querySelector('.cta-button').click()");
    expect(
      evaluate(
        "(({ top, bottom }) => top >= 0 && bottom <= innerHeight)(document.querySelector('#university').getBoundingClientRect())",
      ),
      "The field is in view at once, with no smooth scroll to wait for",
    ).toBe(true);
    browser("wait", "--fn", "document.querySelector('#university').ariaExpanded === 'true'");
    expect(focused()).toBe("university");
    expect(dropdownOpen()).toBe(true);
    browser("press", "Escape");
    browser("wait", "--fn", "document.querySelector('#university').ariaExpanded === 'false'");
    expect(dropdownOpen()).toBe(false);

    // A click on the field opens the list under it, and Escape closes it.
    browser("click", "#university");
    browser("wait", "--fn", "document.activeElement.id === 'university'");
    expect(dropdownOpen()).toBe(true);
    expect(evaluate("document.querySelector('#university').ariaExpanded")).toBe("true");
    expect(evaluate("document.querySelector('#university-description').textContent")).toMatch(
      new RegExp(`${universities.length.toLocaleString("en-US")} institution`),
    );
    // Other, whose file names no institution, is always last.
    expect(
      evaluate(
        "document.querySelector('#university-choices [role=option]:last-child').textContent",
      ),
    ).toBe("OtherAny other school or company");
    if (universities.length === 1) {
      expect(
        evaluate("document.querySelectorAll('#university-choices [role=option]').length"),
      ).toBe(2);
      expect(evaluate("document.querySelector('#university-description').textContent")).toMatch(
        /^1 institution\./,
      );
    }
    browser("press", "Escape");
    expect(dropdownOpen()).toBe(false);
    expect(focused()).toBe("university");
    // Typing searches, and Enter chooses the highlighted match. With no match, Other is still offered.
    browser("fill", "#university", "zzzz-no-such-school");
    browser("wait", "--text", "No matching university");
    expect(dropdownOpen()).toBe(true);
    expect(
      evaluate(
        "[...document.querySelectorAll('#university-choices [role=option]')].map((option) => option.querySelector('.picker-name').textContent)",
      ),
    ).toEqual(["Other"]);
    browser("fill", "#university", "utoronto.ca");
    browser("wait", "#university-choices [role=option]");
    expect(
      evaluate(
        "(({ id, ariaSelected, textContent }) => [id, ariaSelected, textContent])(document.querySelector('#university-choices [role=option]'))",
      ),
    ).toEqual([
      evaluate("document.querySelector('#university').getAttribute('aria-activedescendant')"),
      "true",
      "University of TorontoOntario, Canada · Portal link available",
    ]);
    browser("press", "Enter");

    // 1: the file, in a dialog for the institution, which mustn't be opened yet, with nowhere to go back to.
    waitForStep("Download");
    expect(dialogOpen()).toBe(true);
    expect(dropdownOpen()).toBe(false);
    expect(address()).toBe("/?university=IAU-020599#step=download");
    browser("wait", "--fn", "document.activeElement.id === 'step-title'");
    expect(evaluate("document.title")).toMatch(/University of Toronto/);
    expect(evaluate("document.querySelector('.dialog-school').textContent")).toBe(
      "University of Toronto",
    );
    // Three lines: the sentence with the file's name as a badge, the link, which is the
    // file's name, underlined, and what comes next.
    expect(
      evaluate(
        "[...document.querySelectorAll('#home-dialog .dialog-copy > p')].map((line) => line.textContent)",
      ),
    ).toEqual([
      "Click the link below to download UnDuo's secure webpage, UnDuo - University of Toronto.html, but don't open it yet:",
      "UnDuo - University of Toronto.html",
      "Next, we'll show you how to verify it's safe to use.",
    ]);
    expect(
      evaluate(
        "(({ className }, badge) => [className, badge.textContent, getComputedStyle(document.querySelector('a[download]')).textDecorationLine])(document.querySelector('a[download]'), document.querySelector('.dialog-copy .file-badge'))",
      ),
    ).toEqual(["home-download", "UnDuo - University of Toronto.html", "underline"]);
    expect(
      evaluate("(({ href, download }) => [href, download])(document.querySelector('a[download]'))"),
    ).toEqual([`${hosted}/files/unduo`, "UnDuo - University of Toronto.html"]);
    // Every step has a drawing beside its text: here, the Downloads panel with the file.
    expect(
      evaluate(
        "(({ textContent }, art) => [art.getAttribute('aria-hidden'), textContent.includes('Downloads'), !!art.querySelector('.download-pop')])(document.querySelector('.dialog-art'), document.querySelector('.dialog-art'))",
      ),
    ).toEqual(["true", true, true]);
    expect(
      evaluate("[...document.querySelectorAll('#home-dialog .home-step-text')].at(-1).textContent"),
    ).toBe("Next, we'll show you how to verify it's safe to use.");
    expect(
      evaluate("/Trust unduo/.test(document.body.textContent)"),
      "Setup isn't offered on the site",
    ).toBe(false);
    expect(visible("Back")).toBe(false);
    click("button", "Continue");

    // 2: the prompt, which a button copies to the clipboard for the next step.
    waitForStep("Copy prompt");
    expect(address()).toBe("/?university=IAU-020599#step=prompt");
    expect(evaluate("!!document.querySelector('a[download]')")).toBe(false);
    expect(evaluate("document.querySelector('.dialog-copy .home-step-text').textContent")).toBe(
      "The prompt below validates that UnDuo - University of Toronto.html is safe to use.",
    );
    expect(evaluate("document.querySelector('#ai-question').value")).toBe(
      [
        "The attached file is from a website for setting up Duo two-factor authentication with my own authenticator app instead of Duo Mobile.",
        "Please read its code, including everything it loads and runs. Judge each part by what the code allows it to do or restricts it from doing.",
        "Will this file keep my Duo activation code and secret key safe, so they stay between me, Duo and my authenticator app?",
        "Answer “Safe: no” only if you can point to how UnDuo's file itself would let them reach anyone else. Judge UnDuo only, not other services it can't control, such as a clipboard or browser that syncs to the cloud. Start your reply with “Safe: yes” or “Safe: no”, then explain why in a few short sentences to someone who may not be technical.",
        "P.S. UnDuo has screenshots of other AIs responding to this exact prompt, but the file isn't visible. If you have the ability to, attach the file's SHA256 hash at the end of your response (compute it by running code, not by guessing), and briefly explain why if the hashes match, it means the files are the same.",
      ].join("\n\n"),
    );
    expect(
      evaluate("!!document.querySelector('.question-actions button .button-icon')"),
      "The copy button has a clipboard icon",
    ).toBe(true);
    expect(
      evaluate("!!document.querySelector('#home-dialog a[target=_blank]')"),
      "The AI is next",
    ).toBe(false);
    click("button", "Copy prompt to clipboard");
    browser(
      "wait",
      "--fn",
      "document.querySelector('.question-actions button').textContent === 'Copied'",
    );
    click("button", "Continue");

    // 3: the file and the copied prompt go to an AI.
    waitForStep("Verify");
    expect(address()).toBe("/?university=IAU-020599#step=verify");
    expect(
      evaluate("!!document.querySelector('#ai-question')"),
      "The prompt was the step before",
    ).toBe(false);
    // Tabs choose the AI, ChatGPT first; each has a drawing of its page and, but for Other, a link.
    const aiTabs = () =>
      evaluate(
        "[...document.querySelectorAll('#home-dialog [role=tab]')].map((tab) => tab.textContent + (tab.ariaSelected === 'true' ? '*' : ''))",
      );
    const aiLinks = () =>
      evaluate(
        "[...document.querySelectorAll('#home-dialog a[target=_blank]')].map((link) => [link.textContent, link.href, link.rel])",
      );
    const instruction = () =>
      evaluate("document.querySelector('.dialog-copy .home-step-text').textContent");
    expect(evaluate("document.querySelector('#home-dialog').dataset.step")).toBe("verify");
    expect(aiTabs()).toEqual(["ChatGPT*", "Claude", "Gemini", "Other"]);
    // The file's name, in full, is a badge in the sentence, as on the Continue step.
    expect(
      evaluate("document.querySelector('.dialog-copy .home-step-text .file-badge').textContent"),
    ).toBe("UnDuo - University of Toronto.html");
    expect(instruction()).toBe(
      "Open ChatGPT in a new window, press your browser's download button, then drag UnDuo - University of Toronto.html into ChatGPT and paste in the prompt you copied.",
    );
    expect(aiLinks()).toEqual([
      ["Open ChatGPT (opens in a new window)", "https://chatgpt.com/", "noopener noreferrer"],
    ]);
    expect(
      evaluate("!!document.querySelector('#home-dialog a[target=_blank] .button-icon')"),
      "An icon says the link opens in a new window",
    ).toBe(true);
    // ⌘N on Apple devices, Ctrl+N elsewhere, and the AI's address, if the window doesn't open.
    const keys = evaluate("/Mac|iPhone|iPad/.test(navigator.platform)") ? "⌘N" : "CtrlN";
    expect(evaluate("document.querySelector('.fallback-note').textContent")).toBe(
      `If that button doesn't work, press ${keys} to open a new window and type chatgpt.com into the address bar.`,
    );
    // The link opens a popup window of its own, with no handle back to this page; a blocked
    // window, or a modified click, follows the link to a new tab instead. window.open is stubbed.
    const openAi = (opened: string, modifier = false) =>
      evaluate(`(() => {
        const open = window.open;
        const calls = [];
        const opened = ${opened};
        window.open = (...args) => (calls.push(args), opened);
        let followed;
        const stop = (event) => { followed = !event.defaultPrevented; event.preventDefault(); };
        document.addEventListener('click', stop);
        document.querySelector('#home-dialog a[target=_blank]').dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: ${modifier} }),
        );
        document.removeEventListener('click', stop);
        window.open = open;
        const [url, name, features] = calls[0] ?? [];
        return { followed, url, name, popup: /^popup,/.test(features), opener: opened?.opener };
      })()`);
    expect(openAi("{ opener: window }")).toEqual({
      followed: false,
      url: "https://chatgpt.com/",
      name: "unduo-ai",
      popup: true,
      opener: null,
    });
    expect(openAi("null")).toMatchObject({ followed: true, popup: true });
    expect(openAi("null", true), "A ⌘-click opens no window").toEqual({
      followed: true,
      popup: false,
    });
    expect(evaluate("document.querySelector('.dialog-art').getAttribute('aria-hidden')")).toBe(
      "true",
    );
    for (const [name, href] of [
      ["Claude", "https://claude.ai/"],
      ["Gemini", "https://gemini.google.com/"],
    ]) {
      const tab = `#ai-tab-${name!.toLowerCase()}`;
      evaluate(`document.querySelector('${tab}').click()`);
      browser("wait", "--fn", `document.querySelector('${tab}').ariaSelected === 'true'`);
      expect(instruction()).toBe(
        `Open ${name} in a new window, press your browser's download button, then drag UnDuo - University of Toronto.html into ${name} and paste in the prompt you copied.`,
      );
      expect(aiLinks()).toEqual([
        [`Open ${name} (opens in a new window)`, href, "noopener noreferrer"],
      ]);
      expect(evaluate("document.querySelector('.fallback-note em').textContent")).toBe(
        new URL(href!).host,
      );
    }
    // Arrow keys move between the tabs and wrap around.
    browser("focus", "#ai-tab-gemini");
    browser("press", "ArrowRight");
    browser(
      "wait",
      "--fn",
      "document.activeElement.id === 'ai-tab-other' && document.activeElement.ariaSelected === 'true'",
    );
    expect(
      evaluate(
        "[...document.querySelectorAll('.dialog-copy .home-step-text')].map((line) => line.textContent)",
      ),
    ).toEqual([
      `Open your favorite AI in a new window: press ${keys} and type its address into the address bar.`,
      "Then press your browser's download button, drag UnDuo - University of Toronto.html into it and paste in the prompt you copied.",
    ]);
    expect(aiLinks()).toEqual([]);
    browser("press", "ArrowRight");
    browser(
      "wait",
      "--fn",
      "document.activeElement.id === 'ai-tab-chatgpt' && document.activeElement.ariaSelected === 'true'",
    );
    click("button", "Continue");

    // 4: open it from the Downloads, set up the 2FA app, then the closing advice, and Done.
    waitForStep("Continue");
    expect(
      evaluate(
        "[...document.querySelectorAll('.dialog-copy .home-step-text:not(.stay-safe)')].map((line) => line.textContent)",
      ),
    ).toEqual([
      "Open your Downloads and double click the UnDuo - University of Toronto.html file to open UnDuo's secure webpage.",
      "Follow the webpage's instructions to set up a new 2FA app for University of Toronto.",
    ]);
    expect(
      evaluate(
        "[document.querySelector('.dialog-art').getAttribute('aria-hidden'), !!document.querySelector('.dialog-art .open-window'), document.querySelectorAll('.dialog-art .click-ring').length]",
      ),
    ).toEqual(["true", true, 2]);
    expect(evaluate("document.querySelector('.stay-safe').textContent")).toBe(
      "Remember: Never trust any website with your sensitive school login credentials without a way for you to verify it's 100% safe. Stay safe out there!",
    );
    expect(evaluate("document.querySelector('.stay-safe em strong').textContent")).toBe(
      "Remember:",
    );
    expect(visible("Done")).toBe(true);
    expect(visible("Back")).toBe(true);

    // The address holds the place: reload, Back, Forward and the dialog's Back all keep to it.
    browser("reload");
    waitForStep("Continue");
    expect(dialogOpen()).toBe(true);
    browser("back");
    waitForStep("Verify");
    browser("forward");
    waitForStep("Continue");
    click("button", "Back");
    waitForStep("Verify");
    click("button", "Back");
    waitForStep("Copy prompt");
    click("button", "Back");
    waitForStep("Download");

    // Escape, the close button and Done each close the dialog, and the address and focus follow.
    browser("press", "Escape");
    waitForClosed();
    expect(address()).toBe("/");
    expect(focused()).toBe("university");
    expect(dropdownOpen(), "Focus comes back without opening the list").toBe(false);
    expect(evaluate("document.querySelector('#university').value")).toBe("");
    expect(evaluate("document.title")).not.toMatch(/University of Toronto/);
    browser("back");
    waitForStep("Download");
    expect(dialogOpen()).toBe(true);
    click("button", "Close");
    waitForClosed();
    browser("open", `${hosted}/?university=IAU-020599#step=continue`);
    waitForStep("Continue");
    click("button", "Done");
    waitForClosed();
    expect(address()).toBe("/");

    // The site serves the file as a download; it has no page that runs setup.
    const file = await fetch(`${hosted}/files/unduo`);
    expect(file.headers.get("content-type")).toBe("application/octet-stream");
    if (published) expect(await file.text()).toBe(html);
    for (const path of [
      "020599/",
      "020599/index.html",
      "020599/download.html",
      "download.html",
      "files/020599",
      "files/other",
    ])
      expect((await fetch(`${hosted}/${path}`)).status, path).toBe(404);

    // A shared link opens the download, and steps that earlier pages named lead to theirs.
    for (const [step, heading] of [
      ["", "Download"],
      ["university", "Download"],
      ["overview", "Download"],
      ["prompt", "Copy prompt"],
      ["check", "Verify"],
      ["open", "Continue"],
      ["safe", "Continue"],
    ]) {
      browser("open", `${hosted}/?university=UofT${step && `#step=${step}`}`);
      waitForStep(heading!);
      expect(dialogOpen()).toBe(true);
    }

    // Other, chosen when nothing matches, downloads the file that names no institution.
    browser("open", `${hosted}/`);
    browser("wait", "#university");
    browser("fill", "#university", "zzzz-no-such-school");
    browser("wait", "--text", "No matching university");
    browser("press", "Enter");
    waitForStep("Download");
    expect(address()).toBe("/?university=other#step=download");
    expect(evaluate("document.title")).toBe("Download UnDuo");
    expect(evaluate("document.querySelector('.dialog-school').textContent")).toBe("Other");
    expect(
      evaluate("(({ href, download }) => [href, download])(document.querySelector('a[download]'))"),
    ).toEqual([`${hosted}/files/unduo`, "UnDuo - Other.html"]);
    click("button", "Close");
    waitForClosed();
    browser("open", `${hosted}/?university=other#step=continue`);
    waitForStep("Continue");
    expect(
      evaluate("[...document.querySelectorAll('#home-dialog .home-step-text')][1].textContent"),
    ).toBe("Follow the webpage's instructions to set up a new 2FA app for your organization.");
    click("button", "Done");
    waitForClosed();
    const stMichaels = universities.find(({ id }) => id === "IAU-020599-020519");
    if (stMichaels) {
      const branch = join(temporary, `UnDuo - ${stMichaels.name}.html`);
      await writeFile(branch, localCopy(html));
      browser("open", pathToFileURL(branch).href);
      waitForHeading("Open your Duo device portal");
      expect(evaluate("document.title")).toMatch(/St\. Michael/);
      expect(evaluate("document.querySelector('#setup-card').textContent")).toMatch(
        /don't have a verified Duo portal/,
      );
    } else {
      expect(
        (await fetch(`${hosted}/files/020599-020519`)).status,
        "Unpublished UofT branches must not survive an earlier build",
      ).toBe(404);
    }
    if (!universities.some(({ id }) => id === "IAU-011447")) {
      expect(
        (await fetch(`${hosted}/files/011447`)).status,
        "Other institutions must not survive an earlier build",
      ).toBe(404);
      browser("open", `${hosted}/?university=MIT#step=open`);
      browser("wait", "#university");
      expect(dialogOpen(), "No dialog for an unpublished institution").toBe(false);
      expect(evaluate("!!document.querySelector('a[download]')"), "No unpublished file").toBe(
        false,
      );
      browser("fill", "#university", "MIT");
      browser("wait", "--text", "No matching university");
    }
  });

  test("setup flow from a downloaded file", () =>
    verifyFlow(pathToFileURL(join(isolated, downloaded)).href));

  test("the file opens at its portal under its download name, and links home to the site", async () => {
    const folder = join(temporary, "institution");
    await mkdir(folder);
    const file = join(folder, "UnDuo - University of Toronto.html");
    await writeFile(file, localCopy(html));
    browser("open", pathToFileURL(file).href);
    waitForHeading("Open your Duo device portal");
    expect(evaluate("document.title")).toMatch(/University of Toronto/);
    expect(evaluate("document.querySelector('a[aria-label=\"unduo home\"]').href")).toBe(
      "https://unduo.me/",
    );
    expect(
      evaluate(
        "[...document.querySelectorAll('#setup-progress li [aria-hidden]')].map((n) => n.textContent)",
      ),
    ).toEqual(["1", "2", "3", "4", "5"]);
    expect(evaluate("location.hash")).toBe("");
    click("button", "Continue");
    waitForHeading("Authenticate with Duo");
    browser("wait", "--fn", "document.activeElement.id === 'step-title'");
    click("button", "Continue");
    waitForHeading("Copy the activation QR code");
    expect(evaluate("location.hash")).toBe("");
    expect(browser("errors")).toBe("");
  });

  /** The one setup file, saved as `name` in a folder of its own and opened from disk. */
  async function openAs(name: string) {
    const file = join(await mkdtemp(join(temporary, "named-")), name);
    await writeFile(file, localCopy(html));
    browser("open", pathToFileURL(file).href);
    waitForHeading("Open your Duo device portal");
    browser(
      "wait",
      "--fn",
      "[...document.querySelectorAll('.signed-in-example img')].every((image) => image.naturalWidth > 0)",
    );
  }
  /**
   * The set each example screenshot on the current step is from, by its file's
   * name, which the self-contained experiment's data: URLs don't carry.
   */
  const expectShown = (selector: string, sets: string[]) => {
    if (!selfContained) expect(shownSets(selector)).toEqual(sets);
  };
  const shownSets = (selector: string) =>
    evaluate(
      `[...new Set([...document.querySelectorAll(${JSON.stringify(selector)})].map((image) => /-(generic|universal|western)./.exec(image.dataset.screenshot)?.[1] ?? "traditional"))]`,
    );

  test("a name that names no institution shows Other: no name, no portal link, no logo", async () => {
    for (const name of ["UnDuo - Other.html", "download.html"]) {
      await openAs(name);
      expect(evaluate("document.title"), name).toBe("Duo setup — unduo");
    }
    expect(evaluate("document.querySelector('#school').value")).toBe("");
    expect(evaluate("!!document.querySelector('.eyebrow')"), "No institution's name").toBe(false);
    expect(evaluate("document.querySelector('.disclaimer').textContent")).toBe(
      "unduo is an independent open-source tool. It isn't affiliated with your organization, Duo Security or Cisco.",
    );
    expect(evaluate("document.querySelector('.school-card').textContent")).toBe(
      "Open it in a new window, so you can keep these steps in view. If you don't know its address, ask your IT help desk where to manage your Duo devices.",
    );
    expect(
      evaluate("[...document.querySelectorAll('#setup-card a')].length"),
      "No portal or source link",
    ).toBe(0);
    expectShown(".signed-in-example img", ["generic"]);
    click("button", "Continue");
    waitForHeading("Authenticate with Duo");
    expectShown(".signed-in-example img", ["generic"]);
    click("button", "Continue");
    waitForHeading("Copy the activation QR code");
    expect(browser("errors")).toBe("");
  });

  test("Waterloo's name shows Duo's Universal Prompt, with Waterloo's screenshots", async () => {
    // A browser's mark for a second copy doesn't matter.
    await openAs("UnDuo - University of Waterloo (1).html");
    expect(evaluate("document.title")).toBe("Duo setup for University of Waterloo — unduo");
    expect(evaluate("document.querySelector('#school').value")).toBe("IAU-020623");
    expect(evaluate("document.querySelector('#portal-url').value")).toBe(
      "https://uwaterloo.login.duosecurity.com/devices",
    );
    expect(
      evaluate(
        "[...document.querySelectorAll('.signed-in-example figure')].map((figure) => [figure.querySelector('figcaption'), figure.querySelector('img').alt])",
      ),
    ).toEqual([[null, "Duo's prompt for a verification code, with the device's name blurred"]]);
    click("button", "Continue");
    waitForHeading("Authenticate with Duo");
    expect(evaluate("document.querySelector('.signed-in-text').textContent")).toBe(
      "Press Continue once you land on the page with Add a device:",
    );
    expectShown(".signed-in-example img", ["universal"]);
    click("button", "Continue");
    waitForHeading("Copy the activation QR code");
    expect(evaluate("document.querySelector('.instructions li').textContent")).toBe(
      "Add a device: choose Add a device → Duo Mobile → I have a tablet → Next.Labels vary; any option that shows a Duo Mobile QR code works.",
    );
    expect(
      evaluate(
        "[...document.querySelectorAll('[aria-label=\"Duo portal example screenshots\"] figcaption')].map((caption) => caption.textContent)",
      ),
    ).toEqual([
      "1. Choose “Add a device”",
      "2. Choose Duo Mobile",
      "3. Choose “I have a tablet”",
      "4. Choose Next",
      "5. Right-click the QR code and copy it",
    ]);
    expectShown('[aria-label="Duo portal example screenshots"] img', ["universal"]);
    expect(browser("errors")).toBe("");
  });

  test("Western's name sends students through Western Identity Manager, with its own devices page", async () => {
    await openAs("UnDuo - University of Western Ontario.html");
    expect(evaluate("document.title")).toBe("Duo setup for University of Western Ontario — unduo");
    expect(evaluate("document.querySelector('#portal-url').value")).toBe(
      "https://identity.uwo.ca/",
    );
    expect(
      evaluate("[...document.querySelectorAll('.school-card .school-note')].at(-1).textContent"),
    ).toBe(
      "After you sign in, open the Security tab, choose Manage My MFA, then Launch Duo Manager.",
    );
    expectShown(".signed-in-example img", ["generic"]);
    click("button", "Continue");
    waitForHeading("Authenticate with Duo");
    expect(evaluate("document.querySelector('.signed-in-text').textContent")).toBe(
      "Press Continue once you land on the My Settings & Devices page:",
    );
    expect(evaluate("document.querySelector('.signed-in-example figcaption').textContent")).toBe(
      "In Western Identity Manager: Security → Manage My MFA → Launch Duo Manager",
    );
    expectShown(".signed-in-example img", ["western"]);
    click("button", "Continue");
    waitForHeading("Copy the activation QR code");
    expect(evaluate("document.querySelector('.instructions li').textContent")).toMatch(
      /^Add a device: choose Tablet → Android → I have Duo Mobile installed\./,
    );
    expectShown('[aria-label="Duo portal example screenshots"] img', ["traditional"]);
    expect(browser("errors")).toBe("");
  });

  test("the first step's menu changes the institution the file shows", async () => {
    await openAs("download.html");
    const choose = (id: string) =>
      evaluate(
        `(() => { const menu = document.querySelector('#school'); menu.value = ${JSON.stringify(id)}; menu.dispatchEvent(new Event('change')); })()`,
      );
    expect(
      evaluate(
        "[...document.querySelectorAll('#school option')].map((option) => option.textContent)",
      ),
    ).toEqual([...universities.map(({ name }) => name), "Other school or company"]);
    choose("IAU-020623");
    browser(
      "wait",
      "--fn",
      "document.querySelector('.eyebrow')?.textContent === 'University of Waterloo'",
    );
    expect(evaluate("document.title")).toBe("Duo setup for University of Waterloo — unduo");
    expect(evaluate("document.querySelector('#portal-url').value")).toBe(
      "https://uwaterloo.login.duosecurity.com/devices",
    );
    expectShown(".signed-in-example img", ["universal"]);
    choose("");
    browser("wait", "--fn", "!document.querySelector('.eyebrow')");
    expect(evaluate("document.title")).toBe("Duo setup — unduo");
    expect(evaluate("!!document.querySelector('#portal-url')")).toBe(false);
    expect(browser("errors")).toBe("");
  });

  test("CSP rejects modified application code", async () => {
    await openVariant(
      "tampered-app.html",
      localCopy(html).replace(
        /(<script\b[^>]*data-app="unduo"[^>]*>)/,
        "$1window.__unduoTamper = true;\n",
      ),
    );
    expect(evaluate("typeof window.__unduoTamper")).toBe("undefined");
    expect(evaluate("document.querySelector('#setup').childElementCount")).toBe(0);
    expect(evaluate("document.querySelector('h1')"), "The script builds everything visible").toBe(
      null,
    );
  });

  test.runIf(selfContained)("CSP rejects a changed style element", async () => {
    for (const vendor of ["uikit", "app"]) {
      await openVariant(
        `tampered-${vendor}-style.html`,
        localCopy(html).replace(
          new RegExp(`(<style data-vendor="${vendor}"[^>]*>)`),
          "$1html{color:red}",
        ),
      );
      waitForHeading("Open your Duo device portal");
      expect(evaluate(`document.querySelector('style[data-vendor=${vendor}]').sheet`)).toBeNull();
      expect(
        evaluate(
          `!!document.querySelector('style[data-vendor=${vendor === "app" ? "uikit" : "app"}]').sheet`,
        ),
      ).toBe(true);
    }
  });

  test.skipIf(selfContained)("SRI rejects a changed UIkit stylesheet", async () => {
    const uikit = Object.values(cdn.assets)[0]!;
    await openVariant(
      "tampered-uikit.html",
      localCopy(html).replaceAll(uikit.integrity, `sha256-${"A".repeat(43)}=`),
    );
    waitForHeading("Open your Duo device portal");
    expect(evaluate("document.querySelector('link[data-vendor=uikit]').sheet")).toBeNull();
  });

  test.skipIf(selfContained)("SRI rejects a changed published stylesheet", async () => {
    const styleName = publishedFiles.find((name) => name.endsWith(".css"))!;
    await openVariant(
      "tampered-style.html",
      localCopy(html).replace(assets.files[styleName]!, `sha256-${"A".repeat(43)}=`),
    );
    waitForHeading("Open your Duo device portal");
    expect(evaluate("document.querySelector('link[data-vendor=app]').sheet")).toBeNull();
  });

  test.runIf(jsPlugin)("the experimental build's CSP refuses to compile WebAssembly", async () => {
    browser("open", pathToFileURL(join(isolated, downloaded)).href);
    waitForHeading("Open your Duo device portal");
    browser(
      "eval",
      "WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])).then(() => { window.__unduoWasm = 'compiled'; }, (error) => { window.__unduoWasm = error.name; })",
    );
    browser("wait", "--fn", "!!window.__unduoWasm");
    expect(evaluate("window.__unduoWasm")).toBe("CompileError");
  });

  test.skipIf(jsPlugin)(
    "the browser rejects a plugin whose bytes differ from its pinned SHA-256",
    async () => {
      await openVariant(
        "tampered-plugin.html",
        localCopy(html).replace(
          /data-plugin-integrity="sha256-[^"]+"/,
          `data-plugin-integrity="sha256-${"A".repeat(43)}="`,
        ),
      );
      browser("wait", "--text", "couldn't load its setup code");
      expect(
        evaluate("!!document.querySelector('#setup-card')"),
        "No step renders without the plugin",
      ).toBe(false);
    },
  );
});
