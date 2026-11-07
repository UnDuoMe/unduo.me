# Development

This repository follows the Flatcap conventions used in ImproveLabs/Haniverse, scaled to a static web app. `unduo.me` maps to the reverse-DNS scope `@-/me.unduo`.

## Layout

- `apps/unduo-web`: thin Vite adapter: its config, the entry scripts, each page's HTML shell and the list of pages. Common screenshots and the favicon live in `src/assets`; institution-specific assets belong in `public/<WHED-number>/`.
- `packages/me/unduo/configs/web`: the Vite plugin that writes the site, the preview command, CDN and WHED updaters, and browser verification. Keep command scripts here rather than in the web adapter.
- `packages/me/unduo/configs/dev`: the `_dev` mprocs launcher for Vite, with per-session control ports and pane logs.
- `packages/me/unduo/configs/e2e`: a Playwright test of a student's whole path on the live site, with a mock Duo.
- `packages/me/unduo/data/universities`: canonical WHED catalog snapshot with domain enrichment and optional verified enrollment URLs.
- `packages/me/unduo/lib/universities`: local search and shared-link validation.
- `crates/setup`: the setup flow's logic in Rust (state machine, URL hash, activation and reply parsing, Duo request, `otpauth://` link and the screen-scan loop), and its QR code reader, compiled to a WebAssembly module with Extism's plugin interface.
- `packages/me/unduo/components/setup`: the setup page's browser host, its QR code encoder and Tailwind stylesheet entrypoint. The nested `plugin` package holds the committed `setup.wasm`, its loader, the security guard on its output and message types; `portal`, `link`, `activate`, `help` and `shortcuts` build the steps and dialogs, and `help` also owns the terminal commands that do the same setup without unduo's code; shared types live in their feature’s `+entities` package.
- `packages/me/unduo/lib/dom`: the element functions and state the pages build their interactive UI from, on VanJS (`packages/com/npmjs/vanjs-core`).
- `packages/me/unduo/components/home`: the home page, a short intro and its own stepper that takes a student from choosing a university to opening its file. `components/stepper` is the numbered stepper it and the setup file each use.
- `packages/me/unduo/components/result` and `components/university-picker`: the authenticator result and the school search.
- `packages/com/npmjs/*`: explicitly declared third-party wrappers.

## Package conventions

A package name matches its path below `packages/`, joined with dots and prefixed by `@-/`. For example, `packages/me/unduo/lib/universities` is `@-/me.unduo.lib.universities`.

Keep schemas and types in nested `+entities` packages under the feature that owns them, following Haniverse. The leading `+` marks a detached package and is omitted from the package name: `packages/me/unduo/data/universities/+entities` is `@-/me.unduo.data.universities.entities`. Detached packages can be imported independently of their parent's implementation and cannot consume protected or private packages. Do not collect unrelated entities in a top-level `entities/` package.

Each package has a README titled with its full name, a `package.json` with `imports` and `exports`, and an explicit `+.ts` public API. Server-only packages use `+server.ts`. Public APIs list named exports; npm wrappers may re-export their upstream package. Implementation files are flat and use descriptive kebab-case names. `__tests__` directories hold co-located tests.

Import local files through `#...` entries in the owning package's `imports` map. Import other workspaces through their package exports, and declare them with `workspace:*`. Do not reach into another package's files. An `_` path segment protects a package to the parent scope; `__` limits it to its exact parent package.

Versions live in the root Bun catalog. Package dependencies use `catalog:` for upstream libraries and `workspace:*` for local code. Framework adapters may use their standard framework imports. The root TypeScript configuration checks the whole workspace; shared packages do not carry individual TypeScript configurations.

The published `eslint-plugin-flatcap` runs inside `vp check` through the root Vite+ lint configuration. It verifies names, entrypoints, README titles, flat files, internal import maps, declared dependencies, public subpaths and protected/private boundaries. No repository-specific checker package is needed. `apps/` contains the Vite web adapter.

## HTML and VanJS

Build everything a page shows with TypeScript functions on `@-/me.unduo.lib.dom`, whose README
lists the rules for reading state. A page's HTML holds only what the build must write: the head
with its CSP and stylesheet pins, `#root` with the plugin's pin and description, a mount element
whose data attributes hold the values only the build knows, and pinned asset URLs in a
`<template>`, because `html-security.mjs` checks them there. A page shows nothing without
JavaScript, apart from its `<noscript>` line.

`apps/unduo-web/src/page-layout.ts` writes that HTML and `src/pages.ts` lists the documents.
Packages export the functions that build their elements from their root `+.ts` API, and what the
build writes through `/server` (`+server.ts`), which no page's script contains. `setupMount()`
writes the setup page's mount element, `startSetupPage()` in `setup-app.ts` builds the page around
it, and `apps/unduo-web/src/main.ts` calls that once.

`auditableBuild()`, the Vite plugin in the web configs package, serves those pages in development.
In a build Vite compiles only the stylesheet, and the plugin keeps the CSS, bundles each page's
script and writes the site.

A page's script elements hold its own code and VanJS, which is
`public/van-<version>.nomodule.js` from github.com/vanjs-org/van, byte for byte, in its own
element, in the dev server as in a build. Code uses the global `van` it sets without
importing it (`packages/com/npmjs/vanjs-core/global.d.ts` declares it). VanJS is small
enough to read in the page, and it uses neither eval nor HTML strings. The build fails if that element differs from the
SHA-256 it names, and `vp run verify:cdn` compares it with GitHub's copy.
`vp check` validates the TypeScript APIs and Flatcap boundaries.

## Commands

All Git authors and committers must be
`cursoragent <199161495+cursoragent@users.noreply.github.com>`.
`vp install` configures this identity locally and installs Vite+ hooks; it does
not change global Git settings. Pushes require the UnDuoMe Automation GitHub App:
run `vp run setup:github-app` once and approve installation on only `unduo.me`.
Run `vp run check:git` and `vp run check:github-app` before pushing to
`https://github.com/UnDuoMe/unduo.me.git`. See
[the Git policy package](packages/me/unduo/configs/git/README.md) for enforcement
and the distinction between commit attribution and push authentication.

`vp run dev` (or `vpx _dev`) opens the Vite pane in mprocs.
Its default control port is 2999 and Vite stays on 3000. Use `vpx _dev --port
14999` for an isolated session at control 14999 / web 15000, or `vp run dev:web`
for Vite without a TUI. `vpx _dev --print-config` prints the generated config.
See [the dev package](packages/me/unduo/configs/dev/README.md) for log paths,
remote control and shutdown behavior.

```sh
vp install
vp run dev
vp check
vp test
vp run build:web
vp run preview
vp run test:web          # headless browser checks of www/
vp run test:e2e          # a student's whole path on https://unduo.me/, with a mock Duo
vp run test:plugin       # Rust tests for crates/setup
vp run build:plugin      # after changing crates/setup
vp run check:plugin      # rebuild and compare with the committed setup.wasm
vp run publish:assets    # push www/cdn/ and www/cdn-home/ as the pinned jsDelivr commits
vp run verify:cdn        # check www/ CDN files against jsDelivr's API and npm
```

Changing `crates/setup` needs Rust (rustup installs the pinned toolchain).
Other web changes use the committed `setup.wasm`.

The web build outputs `www/index.html` for the home page,
`www/files/<WHED-number>`, the setup file to download, for each published institution (UofT by default), `www/cdn/` with `www/cdn.json`: the stylesheet, images and setup plugin that setup files load from a pinned jsDelivr commit, and `www/cdn-home/` with `www/cdn-home.json`: the home page's stylesheet and images, in a commit of their own. A home-page change never changes a setup file's bytes or its SHA-256.
Generated HTML is kept in `www/` for inspection and downloads.
`vp run preview` serves the whole `www/` directory at `http://127.0.0.1:3000`; with
`UNDUO_LOCAL_CDN=1` pages load their pinned assets from its `/cdn/` copy.

## Duo protocol facts

These were verified against Duo's live endpoints with invalid (unenrollable)
codes and against reference implementations; keep them in mind when changing
the activation code:

- Duo validates passcodes of a device registered this way as **HOTP** with a
  counter starting at 0, so the default export is `otpauth://hotp/…&counter=0`.
  Organizations that enabled Duo's time-based passcodes accept TOTP from the
  same secret, which the UI and the terminal commands offer as a fallback.
- Duo's QR codes contain `https://m-<id>.duosecurity.com/activate/<CODE>`; the
  portal's QR image address is `https://api-<id>.duosecurity.com/frame/qr?value=…`
  whose `value` may be that link, `duo://CODE-BASE64HOST`, or a raw value, often
  URL-encoded. `/activate/`, `/android/` and `/iphone/` pages only embed
  `CODE-base64("api-<id>.duosecurity.com")`, so they are parsed locally.
- `POST /push/v2/activation/<CODE>?customer_protocol=1` returns JSON without CORS
  headers. Failures look like `{"code": 40403, "message": "Unknown activation
  code", "stat": "FAIL"}` (404). Successful replies embed the organization logo,
  so they can exceed 64 KB.

## Client-side activation

The page is five steps: open the Duo device portal, authenticate with Duo until
it shows My Settings & Devices, copy the QR code, activate, and add the result to
an authenticator. The flow's logic runs in the setup
plugin (`crates/setup`), which keeps its state in its own memory; the page's
JavaScript only performs browser I/O. Each browser event goes to the plugin's
`update(event)`, which returns the view to render and a closed list of
effects: write the URL hash, generate a key, read the QR codes in an image or a
screen frame, stop sharing, set the text field, move focus, and send an event
later.

Every output passes the security guard in
`packages/me/unduo/components/setup/plugin/setup-plugin.ts` before other code
sees it. The guard treats the plugin as hostile and throws on a violation, so
the page stops and shows an error. Each output must match its schema, plain
checks written in the guard, exactly: every field, no others, with its type, pattern or allowed
values. Within that, it checks the three values that can leave the page: the URL hash may hold only the step and code type; the plugin names
only the Duo form's URL, and the guard writes Duo Mobile's standard device
fields and the page's own key, so only the activation code (seen only by Duo)
and one Duo host per page load come from the plugin; and the authenticator link must be an `otpauth://` link
with only the standard parameters, whose secret is the account's secret.
Everything else is rendered as text, booleans and classes; there is no
`x-html`. Its tests feed it crafted output from a fake plugin, and run the
real plugin through a whole setup so the schema and `crates/setup` cannot drift.

The generated CSP `<meta>` and the setup plugin's root element each carry a
`data-comment` that states facts a reader can check, not conclusions: the
CSP's says what its hash-only `script-src` blocks, including a dependency's own
imports, and the root's says how the plugin is pinned and isolated and which
of its output the page sends to a server. `finalizeHtml` writes the
first and refuses a plugin root without the second.

The QR step accepts anything pasted anywhere on the page (a copied QR image, its
HTML `<img src>`, an address, a link or Duo's reply), dropped or uploaded
screenshots, or a shared screen. A valid value makes the plugin ask for a key:
the host generates an RSA key pair with WebCrypto (the private key is never
exported) and keeps the public key from the plugin. The plugin then names the
activation URL, which the guard passes only if it matches Duo's activation
endpoint,
`https://api-XXXXXXXX.duosecurity.com/push/v2/activation/CODE?customer_protocol=1`,
with an eight-character account ID and the same host as any earlier form, since
DNS and TLS send the host name unencrypted. The guard then writes the form's
fields and key itself. The user's click POSTs it directly to Duo
into the page's sandboxed `duo-reply` frame, with no referrer. A frame, not a new
tab, because browsers write a new tab's address to history and it holds the code;
Chrome and Firefox don't write the frame's there. Nothing sends the form to a new
tab. The host's submit guard prevents
duplicate submissions, and the form stays connected while the browser submits.
Never try a real activation with `fetch` and retry through a form: a CORS
failure can occur after Duo has already consumed the code.

The user copies Duo's reply back: browsers refuse a drag from another origin's frame
into the page. The plugin accepts JSON (also with browser
labels around it, or Firefox's JSON-viewer text), explains Duo errors (40403
means "get a new QR code"), and keeps only the customer and base32 secret. Step
4 renders the authenticator QR with a counter-based/time-based switch. The
plugin formats the `otpauth://` link and the host draws the QR code from the
guarded link, so a QR code cannot send a phone's camera to a web page.

The URL hash holds only public navigation, form-encoded like a query
(`#step=add&type=totp`), and is validated field by field. The session (the
activation value, submitted flag and parsed account) lives only in the plugin's
memory. The page never writes it to its URL, history state or browser
storage, so the page's copied links and history entries never carry it. The
Duo request's own URL holds the activation code, but only the sandboxed frame
navigates to it, and Duo accepts each code once.
Back and Forward change the step and leave the session alone. Refreshing or
closing the tab discards it, so the host asks the browser to confirm leaving
once there is an activation or account. Legacy `?step=` and `#/?step=` links
migrate to the hash. Older base64 hashes are ignored and replaced on load,
which also removes their secrets from that history entry. **Start over** clears
the session. The app never fetches a pasted URL, sends credentials to an unduo
endpoint or logs replies.

## Terminal commands

The README's **In a terminal** section and the page's **Terminal** dialog show
the same three shell commands, from `terminalCommands` in
`components/setup/help/terminal-commands.ts`. They replace the former npm CLI:
`openssl` makes the key pair and keeps only its public key, `curl` posts it with
the page's Duo form fields from the user's machine, and `python3` turns Duo's
reply into the base32 key and `otpauth://` link. The blocks carry no `#`
comments, because zsh runs a pasted `#` line as a command unless
`interactivecomments` is set. The help package's test runs them in `sh` against
a local stand-in for Duo, checks every posted field and the printed link, and
fails unless the README contains each block verbatim. Change the commands, the
README and the guard's `duoFields` together.

The HTML meta CSP restricts forms to Duo and fetches to the plugin's file.
Hosting requires only the static HTML. Unit tests use synthetic responses. Real
enrollment is not automated and still needs a controlled successful check
before release.

## QR decoding and portal scanning

The host draws pasted, dropped and uploaded images, and frames of a window
shared with **Scan my screen**, onto a white canvas at most 1920 pixels across,
so transparent pixels read as white. A second instance of the plugin, which
shares no memory with the one running setup, reads every QR code there (its
`read` export, built on rqrr). The host wipes the pixels and sends the setup
instance a `decoded` event with the codes' text, so it never receives pixels.
The guard binds the Duo form's URL to text read this way or from a paste. The plugin skips unrelated codes and validates the
activation. It asks for a frame every half second and stops sharing after a
Duo code, an error or 600 frames (at least five minutes). Each image or frame
carries a ticket, so results of cancelled work are dropped.
The scan click requests `getDisplayMedia` before any `await` to retain user
activation, and **Stop sharing** stops the capture in the host before telling
the plugin. Capture stays in the browser. A validated Duo value only prepares
the request; all capture tracks stop first, and submission requires a separate
click.

## Setup plugin

`crates/setup` compiles to `wasm32-unknown-unknown` with the toolchain pinned in
`rust-toolchain.toml`. `vp run build:plugin` writes
`packages/me/unduo/components/setup/plugin/setup.wasm` and its manifest, which
records the bytes' SHA-256 and a hash of the Rust sources. The web build refuses
a plugin older than its sources. The build also refuses a plugin that imports
anything except Extism's kernel functions for input, output, memory and errors
(`alloc`, `input_length`, `input_load_u8`, `input_load_u64`, `store_u8`,
`store_u64`, `output_set` and `error_set`) or exports anything except `update`.

The page doesn't load the Extism SDK. `kernel()` in the plugin package
implements those eight functions in a few dozen lines of inline code, and the
module is instantiated with nothing else to import. `fetch` checks the plugin's
SHA-256 (`data-plugin-integrity`) before the page compiles it, and the CSP lets
the page fetch only that file and compile only WebAssembly. A call can only
return a value, and the host's guard checks each one, so an audit of a page
covers its inline host code and the CSP rather than the plugin.

`vp run test:plugin` runs the Rust tests. `vp run check:plugin` rebuilds the
plugin in a temporary directory and fails unless the bytes match the committed
file, so anyone can reproduce the published plugin from source. Both builds
remap local paths and run rustc through `configs/web/rustc-wrapper.mjs`: for
stable toolchains Cargo hashes `rustc -vV`, which names the host, into each
crate's `-C metadata`, which would otherwise make macOS and Linux builds differ.

### Experimental build without WebAssembly

`UNDUO_JS_PLUGIN=1 vp run build:web` builds pages whose setup logic is the
TypeScript port in `components/setup/plugin/js-plugin.ts`, inlined in each
page's script, with QR codes read by paulmillr's decoder copied into
`lib/qr-reader`. The pages load and compile no WebAssembly: they carry no
`data-plugin-url`, their CSP has no `'wasm-unsafe-eval'`, and `connect-src`
lists only the screenshots. The port's output passes the same `guard()` and
`check()`. The root element's `data-comment` describes this logic instead of
the module. Without the variable the output is byte for byte the normal build,
and both builds pin the same assets commit. `js-plugin.test.ts` compares the
port with `setup.wasm` event by event; run
`UNDUO_TEST_WEB=1 UNDUO_JS_PLUGIN=1 vp test run auditable` in
`packages/me/unduo/configs/web` (with `UNDUO_WEB_OUTPUT` for a copy of that
build) for the browser checks. The deploy workflow never sets the variable.

Adding `UNDUO_SELF_CONTAINED=1` builds pages that load nothing over the network.
`configs/web/self-contained.ts` puts the app stylesheet and UIkit's CSS in style
elements, which the CSP allows by hash, and the screenshots in `data:` URLs.
UIkit is trimmed with postcss to the selectors whose `.uk-` classes all appear in
the page's `class` attributes and script, the selectors with no `.uk-` class,
and the `@keyframes` they name, after checking the installed file against the
SHA-256 the normal pages pin. The CSP then has `connect-src 'none'`, `img-src
data:` and hashes only in `script-src` and `style-src-elem`, and both data-comments
state what the page's script can request. The variable needs
`UNDUO_JS_PLUGIN=1`. Without it, both other builds stay byte for byte the same.

## Static website and setup files

`vp run build:web` runs `vp build` with the config in
`apps/unduo-web/vite.config.ts`. `src/pages.ts` enumerates the selected WHED records,
generating one file per published institution. The default is the main UofT record only; the full scope
includes compound branch IDs. `www/index.html` contains only the
home page: a short intro and a stepper from choosing an institution to opening its file, with `?university=` and `#step=` holding the place.
Each file embeds its own record and renders the setup flow.

**Setup runs only from a file, never on the website.** Students shouldn't get used to doing
something this sensitive through a website. A file has no extension, so GitHub Pages serves it as
`application/octet-stream` and the browser downloads it rather than running it. The Deploy workflow
checks that on the live file. No server routing or SPA fallback is needed. The same paths work in
`vp dev`, which does serve a file as a page, for development.

`packages/me/unduo/configs/web/auditable-build.ts` inlines each page's application
script, so the HTML alone shows all the JavaScript unduo runs, and adds SRI and
CSP. The Tailwind stylesheet, the help screenshots (lossless WebP) and the setup
plugin are published as one git commit with a fixed author, date and message, so
its SHA follows from the files: `configs/web/cdn-assets.ts` computes it at build
time. Pages load these files from
`https://cdn.jsdelivr.net/gh/UnDuoMe/unduo.me@<commit>/`, the stylesheet with
SRI and the plugin with its SHA-256. Both name jsDelivr's listing of that commit
with `data-integrity-source` and `data-integrity-file` and explain the check in
`data-comment`; `finalizeHtml` refuses them otherwise. `vp run publish:assets` recreates that
commit with git plumbing, checks its SHA, pushes it as the `assets/<commit>` tag
and confirms jsDelivr serves every file with the expected hash and lists the commit, which
can take several minutes. Publish before deploying a build whose assets changed.

The build copies `CNAME` and `.nojekyll` into `www/`.

The home page's download link saves an institution's file as `UnDuo - <institution name>.html`. A file
keeps setup state in memory, with only the step in hash history, and links home to
`https://unduo.me/`.

Each page's inline scripts import nothing. A setup page runs six classic script elements in
order, sharing one scope: `vanjs`, `plugin-checks`, `qr-codes`, `steps`, `duo-form` and
`page` (`setupParts` in `configs/web/auditable-build.ts`). Each names its sources and its
requests in `data-source` and `data-requests`, and the build fails if one marked `none`
holds a way to send a request or navigate. The home page runs `vanjs` and one module.
VanJS is the only third-party JavaScript, inlined unminified. UIkit's CSS loads from jsDelivr as a version-pinned npm file.
No UIkit JavaScript runs: help dialogs are native popovers and the example
screenshots use `<details>`, so the CSP allows no style attributes.
`src/cdn-resources.html` contains the stylesheet's URL and SHA-256 integrity
attribute, and may not load scripts. Each `cdn.jsdelivr.net/npm` tag
also carries `data-integrity-source` (jsDelivr's file listing for that package
version) and `data-integrity-file`, which must match its URL, plus one
`data-comment`, shared by every tag, that says how they relate to `integrity`. `configs/web/cdn-libraries.ts`
fails the build if the page's code imports an npm package or a URL, and unless each
jsDelivr SRI hash matches the same file in the installed npm package.
`configs/web/auditable-build.ts` builds setup and home independently so
institution files do not carry the search catalog, then inlines the matching
bundle into every page, with a `data-comment` that lists what the script holds and
every request and navigation it makes; the auditable test checks it against the code.
The bundle keeps doc comments but no bundler annotations or module markers. Pages need
internet to load their pinned files.

`configs/web/html-security.mjs` parses attributes and template contents, requires every
script to be an inline module that imports nothing, and adds CSP hashes.
Script URLs, import maps, missing/mismatched SRI, images or
stylesheets outside the pinned commit, an unpinned plugin, native event handlers
and embedded documents fail the build. `connect-src` allows only the plugin's
file, and `'wasm-unsafe-eval'` appears only on pages that load it. Activation
forms submit directly to Duo. Compiled CSS cannot import further resources.
Normal builds never fetch CDN code or update versions. After changing
dependencies in the root catalog, run `vp run update:cdn` to verify standalone
CDN bundles and refresh their hashes and integrity sources, then review the diff.
`vp run verify:cdn` checks the generated pages' jsDelivr files against jsDelivr's
SHA-256 listing and the npm registry tarball.

`vp run update:universities` downloads all records from the existing WHED
Mix'n'match catalog, including unmatched Wikidata records. The versioned
snapshot and provenance live in `packages/me/unduo/data/universities`. Empty-name
records are excluded from publication. Domain aliases and reviewed Duo metadata
are merged only into unambiguous institutions; no enrollment URL is inferred.

`vp run test:web` runs `configs/web/__tests__/auditable.test.ts`, which plain
`vp test` skips. Run it after `vp run build:web`. It checks the generated pages and
their pinned assets, then uses an isolated headless agent-browser session to check the
home page, its downloads, branch files, legacy query links and the setup flow from a
local file. Its preview server serves `www/cdn/` and `www/cdn-home/` in place of jsDelivr, so a build
can be checked before publishing; `UNDUO_PUBLISHED=1 vp run test:web` uses jsDelivr. It exercises
help popovers, screenshots, QR decoding in the page, synthetic reply import,
TOTP, history, reset and that refreshing clears progress, plus rejection of changed styles,
application code and plugins. It never submits a Duo activation.

## GitHub Pages

The default build publishes only the home page and the confirmed University of
Toronto file at `/files/020599`. `UNDUO_UNIVERSITIES=uoft` is
the default; use `UNDUO_UNIVERSITIES=all vp run build:web` to generate the full
directory. The flag also controls development routes and the picker, so it never
links to omitted institutions. Unknown flag values fail the build.

The optional full-directory build shares application scripts and CDN dependencies
across institution files. Keep the default UofT scope for the current Pages
deployment.

In **Settings → Pages**, set **Source** to **GitHub Actions**. The deploy workflow
builds the website and publishes `www/`. The root `CNAME` contains `unduo.me`;
Cloudflare remains the DNS provider. Commit source changes and push to `main`.
Generated HTML does not need to be committed, but the committed `www/` must have
its assets published too. No deployment CLI or separate publishing branch is needed.

The check workflow runs `vp check`, `vp test` and
`vp run build:web`, and in a second job the Rust tests and the reproducible
plugin check. The deploy workflow builds `www/`, attests the setup files and
assets, publishes its assets commit, deploys Pages, and checks that the live setup
file is served as a download. It uses GitHub's built-in credentials. No remote settings are changed by a local build.
