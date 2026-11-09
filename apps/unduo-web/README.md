# @-apps/unduo-web

Thin Vite adapter. `vite.config.ts` hands the site to the `auditableBuild` plugin.
`src/pages.ts` lists its documents: the home page and each institution's setup file. `src/page-layout.ts` writes each page's HTML, which
holds only what the build must write, and `src/main.ts` and `src/home.ts` start
the scripts that build everything the page shows.
Shared components live in `packages/me/unduo/components`, as TypeScript functions that build
their elements with VanJS. There is no activation API or application server.

Run `vp run dev` for the mprocs stack, or `vp run dev:web`
for Vite alone. Build with `vp run build:web` and serve that output with `vp run preview`
from the repository root.

Command scripts and build helpers live in
[`@-/me.unduo.configs.web`](../../packages/me/unduo/configs/web/README.md).
The publication scope lives there in `build-universities.ts`. Both `src/pages.ts`
and the package’s `university-catalog.ts` use it; the full source directory stays available for future
expansion. To test a full-directory build, also set `UNDUO_UNIVERSITIES=all` when
running `vp run test:web`.

The build emits:

- `www/index.html`: the home page, a short intro and a stepper from choosing an institution
  to its download, a prompt to ask an AI about it, and opening it.
- `www/files/unduo`: the one setup UI for every institution, which the home page downloads as
  `UnDuo - <institution name>.html` (`UnDuo - Other.html` for **Other**). It has no extension, so
  GitHub Pages serves it as a download: setup never runs on the website. It shows the institution
  its saved name names, even with a browser's ` (1)`, and Other otherwise: no institution's name,
  no portal link, and signed-in screenshots with the logo painted out. Its first step has a menu
  to change the institution.
- `www/cdn/` and `www/cdn.json`: the Tailwind CSS, WebP help images and setup
  plugin that setup files load from a content-addressed jsDelivr commit.
- `www/cdn-home/` and `www/cdn-home.json`: the home page's Tailwind CSS (the setup
  files' rules plus its own) and images, in a commit of their own, so a home-page
  change never changes a setup file. No JavaScript is published in either;
  `vp run publish:assets` pushes both commits.
- `www/CNAME` and `www/.nojekyll`: static hosting metadata.

Each setup page's script elements are inline and import nothing, and the home page's are too. VanJS is the only third-party code, in its own element, byte for byte as published.
UIkit's CSS loads from jsDelivr as a version-pinned npm file, byte-identical to the npm
release; no UIkit JavaScript runs. Stylesheet links carry SHA-256 integrity, anonymous
CORS and no referrer. jsDelivr tags name their file in jsDelivr's SHA-256 listing with `data-integrity-source` and
`data-integrity-file`, and a shared `data-comment` explains the check to auditors. Setup
files load their logic from the Rust setup plugin, pinned by SHA-256. A file
opens through `file://` and requires internet for its pinned files.

`src/cdn-resources.html` is the reviewed stylesheet URL and hash, and may not
load scripts. The configs package’s `cdn-libraries.ts` fails the build if the page's code
imports an npm package or a URL. `auditable-build.ts` bundles the app's own setup and home page code
separately and inlines the matching bundle into every document, so each one
shows all the JavaScript unduo runs. Setup files never include the university
search catalog.

The configs package’s `html-security.mjs` checks document attributes and template contents. It rejects
script URLs, import maps, inline scripts that import anything, mismatched SRI, native
event handlers and embedded documents. CSP allows only the inline scripts' hashes, the
pinned styles, `data:` and `blob:` images, fetches only from the setup assets commit's folder
(the plugin, the screenshot list and the screenshots it names, each checked by SHA-256) and of the
home page's AI screenshots, WebAssembly only on pages with the plugin, and form submissions only to Duo. Compiled Tailwind CSS
cannot import further resources.

Update UIkit through the root catalog, run `vp run update:cdn`, and review the
resulting URL and hash. Normal builds do not fetch CDN code or update pins.

GitHub Pages publishes `www/`; the deploy workflow publishes the assets commit
first and then checks that the live setup file is served as a download.

`vp run test:web` uses an isolated headless agent-browser session to check the home
page and its downloads, the setup flow from a local file, branch files, QR decoding, synthetic reply import,
the time-based result, history, reset and help popovers, with assets served locally until
they are published. It checks that SRI rejects changed styles, CSP
rejects changed application code, and `fetch` rejects a changed plugin. No real
activation request is submitted.

The default build publishes only the home page and one setup file, `/files/unduo`,
for the University of Toronto, the University of Waterloo, Western and any other
school or company. `UNDUO_UNIVERSITIES=published` is
the default; use `UNDUO_UNIVERSITIES=all vp run build:web` to put the full
directory in the picker and the file. The flag also controls development routes and the picker, so it never
links to omitted institutions. Unknown flag values fail the build.

The optional full-directory build shares application scripts and CDN dependencies
across institution files. Keep the default UofT scope for the current Pages
deployment.
