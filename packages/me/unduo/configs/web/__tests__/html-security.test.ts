import { createHash } from "node:crypto";
import { expect, test } from "vite-plus/test";
import { finalizeHtml, validateStylesheet } from "../html-security.mjs";

const page = (body: string) => `<!doctype html><html><head></head><body>${body}</body></html>`;

test("inline scripts receive CSP hashes of exactly the bytes the browser sees", () => {
  const code = "const value = 1;\r\nconsole.log(value);";
  const hash = createHash("sha256").update(code.replaceAll("\r\n", "\n")).digest("base64");
  const html = finalizeHtml(page(`<script type="module">${code}</script>`));
  expect(html).toContain(`script-src 'sha256-${hash}'`);
  expect(html).toContain("connect-src 'none'");
  expect(html).toContain("script-src-attr 'none'");
  expect(html).not.toContain("unsafe-eval");
  expect(html).toContain("style-src-elem 'none'");
});

test.each([
  '<script src="https://example.com/app.js"></script>',
  '<script SRC="../assets/app.js"></script>',
  '<script type="module" src="/assets/setup.js"></script>',
  '<svg><script href="../assets/app.js"></script></svg>',
  '<svg><script xlink:href="../assets/app.js"></script></svg>',
  '<template><script src="data:text/javascript,alert(1)"></script></template>',
  '<script type="importmap">{}</script>',
  '<button onclick="alert(1)">Unsafe</button>',
  '<iframe src="https://example.com"></iframe>',
])("rejects hidden or external executable sources: %s", (markup) => {
  expect(() => finalizeHtml(page(markup))).toThrow();
});

test.each([
  'import "https://example.com/app.js";',
  'import "constructor";',
  'export { value } from "./dependency.js";',
  'import("./dependency.js");',
  "import(window.unreviewedModule);",
])("rejects every kind of runtime dependency: %s", (code) => {
  expect(() => finalizeHtml(page(`<script type="module">${code}</script>`))).toThrow(/import/);
});

const assetBase =
  "https://cdn.jsdelivr.net/gh/UnDuoMe/unduo.me@0123456789abcdef0123456789abcdef01234567/";
const listing =
  "https://data.jsdelivr.com/v1/packages/gh/UnDuoMe/unduo.me@0123456789abcdef0123456789abcdef01234567?structure=flat";
const listed = (file: string) =>
  `data-integrity-source="${listing}" data-integrity-file="/${file}" data-comment="Listed."`;

test("permits SRI-locked published styles and rejects missing or mismatched hashes", () => {
  const href = `${assetBase}app.css`;
  const link = `<link rel="stylesheet" href="${href}" integrity="sha256-known" crossorigin="anonymous" ${listed("app.css")}>`;
  const html = finalizeHtml(page(link), { assetBase, stylesheets: { [href]: "sha256-known" } });
  expect(html).toContain(`style-src-elem ${href};`);
  expect(() => finalizeHtml(page(link), { assetBase })).toThrow(/SRI/);
  expect(() =>
    finalizeHtml(page(link), { assetBase, stylesheets: { [href]: "sha256-different" } }),
  ).toThrow(/SRI/);
  // A matching hash is not enough outside the pinned commit.
  const other = link.replace(href, "https://example.com/app.css");
  expect(() =>
    finalizeHtml(page(other), {
      assetBase,
      stylesheets: { "https://example.com/app.css": "sha256-known" },
    }),
  ).toThrow(/SRI/);
  // Auditors need jsDelivr's listing for the file, so it must name this one.
  const stylesheets = { [href]: "sha256-known" };
  for (const unlisted of [
    link.replace(/ data-integrity-source="[^"]*"/, ""),
    link.replace('data-integrity-file="/app.css"', 'data-integrity-file="/other.css"'),
    link.replace(/ data-comment="[^"]*"/, ""),
  ])
    expect(() => finalizeHtml(page(unlisted), { assetBase, stylesheets })).toThrow(
      /data-integrity/,
    );
});

test("images are data: URLs or SHA-256-pinned screenshots fetched as blob: URLs", () => {
  const pin = `data-image-integrity="sha256-${"a".repeat(43)}="`;
  const screenshot = `<img data-image-src="${assetBase}a.webp" ${pin} alt="">`;
  const html = finalizeHtml(page(`${screenshot}<img alt="">`), { assetBase });
  // Stylesheets can request nothing; the script fetches the screenshot.
  expect(html).toContain("img-src data: blob:;");
  expect(html).toContain(`connect-src ${assetBase}a.webp;`);
  expect(finalizeHtml(page('<img alt="">'), { assetBase })).toContain("img-src data:;");
  for (const markup of [
    `<img src="${assetBase}a.webp" alt="">`,
    '<img src="https://example.com/a.webp" alt="">',
  ])
    expect(() => finalizeHtml(page(markup), { assetBase })).toThrow(/Images/);
  for (const markup of [
    screenshot.replace(assetBase, "https://example.com/"),
    screenshot.replace(`${assetBase}a.webp`, `${assetBase}../x.webp`),
    screenshot.replace(pin, ""),
  ])
    expect(() => finalizeHtml(page(markup), { assetBase })).toThrow(/Screenshots/);
});

test("links the script reads from the markup must be web addresses", () => {
  const school = (url: string) => `<div id="setup" data-portal-url="${url}"></div>`;
  expect(() => finalizeHtml(page(school("https://example.edu/duo")))).not.toThrow();
  expect(() => finalizeHtml(page(school("javascript:alert(1)")))).toThrow(/web address/);
  expect(() => finalizeHtml(page('<div data-source-url="data:text/html,x"></div>'))).toThrow(
    /web address/,
  );
});

test("only a SHA-256-pinned plugin from the pinned commit may be fetched and compiled", () => {
  const plugin = `<div data-plugin-url="${assetBase}setup.wasm" data-plugin-integrity="sha256-${"a".repeat(43)}=" data-integrity-source="${listing}" data-integrity-file="/setup.wasm" data-comment="Isolated."></div>`;
  const html = finalizeHtml(page(plugin), { assetBase });
  expect(html).toContain(`connect-src ${assetBase}setup.wasm;`);
  expect(html).toContain("'wasm-unsafe-eval'");
  expect(html).not.toContain("'unsafe-eval'");
  expect(() =>
    finalizeHtml(page(plugin.replace(assetBase, "https://example.com/")), { assetBase }),
  ).toThrow(/plugin/);
  expect(() =>
    finalizeHtml(page(plugin.replace(/"sha256-a{43}="/, '"sha256-short"')), { assetBase }),
  ).toThrow(/SHA-256/);
  expect(finalizeHtml(page("<p>picker</p>"), { assetBase })).not.toContain("wasm-unsafe-eval");
  expect(() =>
    finalizeHtml(page(plugin.replace(/ data-comment="[^"]*"/, "")), { assetBase }),
  ).toThrow(/data-comment/);
  expect(() =>
    finalizeHtml(page(plugin.replace(/ data-integrity-source="[^"]*"/, "")), { assetBase }),
  ).toThrow(/data-integrity/);
});

test("the CSP explains itself, and script-src holds only hashes as its comment says", () => {
  const plugin = `<div data-plugin-url="${assetBase}setup.wasm" data-plugin-integrity="sha256-${"a".repeat(43)}=" data-integrity-source="${listing}" data-integrity-file="/setup.wasm" data-comment="Isolated."></div>`;
  for (const body of ['<script type="module">1;</script>', plugin]) {
    const meta = finalizeHtml(page(body), { assetBase }).match(
      /<meta http-equiv="Content-Security-Policy" content="([^"]*)" data-comment="([^"<>]+)">/,
    );
    expect(meta, "The policy meta carries its comment").toBeTruthy();
    const sources = meta![1]!.match(/script-src ([^;]*)/)![1]!.split(" ");
    for (const source of sources)
      expect(source).toMatch(/^'(?:sha(?:256|384|512)-[A-Za-z0-9+/=]+|wasm-unsafe-eval|none)'$/);
    expect(meta![2]!.includes("wasm-unsafe-eval")).toBe(sources.includes("'wasm-unsafe-eval'"));
  }
});

test.each([
  '<script type="module" src="https://cdn.jsdelivr.net/npm/qr@0.7.2/index.js" integrity="sha256-Pj04w37MVpGx7cxbDdaIK3goDcfyEwFovX3wdNGyHkc=" crossorigin="anonymous"></script>',
  '<script type="importmap">{"imports":{}}</script>',
  "<script>1;</script>",
  '<script type="text/javascript">1;</script>',
  '<script data-requests="none">"use strict";</script>',
])("runs only inline modules, even pinned CDN files: %s", (markup) => {
  expect(() => finalizeHtml(page(markup))).toThrow(/inline/);
});

test("same-origin scripts are rejected even with SRI; application code stays inline", () => {
  const script =
    '<script type="module" src="../assets/setup.js" integrity="sha256-known" crossorigin="anonymous"></script>';
  expect(() => finalizeHtml(page(script))).toThrow(/must be inline/);
  // Hashes accepted for local stylesheets never authorize a script with the same path.
  expect(() =>
    finalizeHtml(page(script), { stylesheets: { "../assets/setup.js": "sha256-known" } }),
  ).toThrow(/must be inline/);
});

test("CSS may contain embedded images but cannot load more resources", () => {
  expect(() =>
    validateStylesheet('.icon { background: url("data:image/svg+xml,abc"); }'),
  ).not.toThrow();
  expect(() => validateStylesheet('@import "https://example.com/app.css";')).toThrow(/imports/);
  expect(() => validateStylesheet('.key { background: url("https://example.com/leak"); }')).toThrow(
    /resources/,
  );
});

test("accepts a strict classic script only as a named part that says what it requests", () => {
  const part = (attributes: string, code: string) =>
    finalizeHtml(page(`<script ${attributes}>${code}</script>`));
  const named = 'data-part="steps" data-requests="none"';
  expect(part(named, '"use strict";\nconst a = 1;\n')).toContain("script-src 'sha256-");
  expect(part('data-part="page" data-requests="fetch()"', '"use strict";\nfetch("x");')).toContain(
    "script-src 'sha256-",
  );
  expect(() => part(named, "const a = 1;")).toThrow(/strict/);
  expect(() => part('data-part="steps"', '"use strict";')).toThrow(/requests/);
});

test.each([
  'fetch("https://example.com")',
  "new XMLHttpRequest()",
  "navigator.sendBeacon(url)",
  "new WebSocket(url)",
  "new EventSource(url)",
  "new Worker(url)",
  'import("https://example.com/x.js")',
  "window.open(url)",
  "open(url)",
  "location.href = url",
  "history.pushState(0, '', url)",
  "form({ action: url })",
  "a.submit()",
  "a.requestSubmit()",
])("refuses %s in a part that says it requests nothing", (code) => {
  expect(() =>
    finalizeHtml(
      page(`<script data-part="steps" data-requests="none">"use strict";\n${code};</script>`),
    ),
  ).toThrow(/requests nothing/);
});

test("accepts a published script part only if its bytes match the hash it names", () => {
  const code = "window.van = {};\n";
  const hash = createHash("sha256").update(code).digest("hex");
  const element = (sha: string) =>
    page(
      `<script data-part="vanjs" data-upstream-sha256="${sha}" data-requests="none">${code}</script>`,
    );
  expect(finalizeHtml(element(hash))).toContain("script-src 'sha256-");
  expect(() => finalizeHtml(element("0".repeat(64)))).toThrow(/published file/);
});
