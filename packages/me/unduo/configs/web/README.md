# @-/me.unduo.configs.web

The Vite plugin that writes the site, preview, dependency updates and browser
verification. The web adapter consumes the plugins through this package's
root API and the publication scope through `/universities`. Implementation files
and command scripts stay flat in this package.

Run commands from the repository root:

```sh
vp run dev:web --port 3000
vp run preview
vp run update:cdn
vp run verify:cdn
vp run update:universities
vp run build:web
vp run test:web
vp run build:plugin
vp run check:plugin
vp run publish:assets
```

`preview.mjs`
serves the generated `www/` directory on localhost; `PORT` selects the port and
`UNDUO_WEB_OUTPUT` can override the output directory for preview and verification.
`UNDUO_LOCAL_CDN=1` makes its pages load pinned assets from its own `/cdn/` copy.
Paths resolve from the package location so these commands work from any working
directory.

`build-universities.ts` selects the published institutions. The default
`UNDUO_UNIVERSITIES=published` includes only the main UofT and Waterloo records; `all` enables the
full directory. Use the same scope for building and running `test:web`.

`university-catalog.ts` supplies the scoped browser catalog. `cdn-libraries.ts`
fails the build if the page's code imports an npm package or a URL, and `auditable-build.ts` is the Vite plugin that serves the adapter's pages in
development and, in a build, keeps the CSS Vite compiled, embeds the application's
code in each HTML document, and points the
stylesheet, images and setup plugin at the content-addressed jsDelivr commits
that `cdn-assets.ts` computes: one for the setup files (`www/cdn/`) and one for
the home page (`www/cdn-home/`), so home-page changes never change a setup file.
`publish-assets.mjs` pushes each commit as an `assets/<sha>` tag and checks
jsDelivr serves it.
`build-plugin.mjs` compiles `crates/setup` reproducibly into the committed
`setup.wasm`; `--check` rebuilds it in a temporary directory and compares.
`rustc-wrapper.mjs` replaces Cargo's host-dependent crate metadata so builds
match across operating systems and CPU architectures. `cdn-source.mjs`
reads the reviewed URLs and hashes in the web adapter's
`src/cdn-resources.html`. `html-security.mjs` validates resources and adds
SRI and CSP protection. `self-contained.ts` serves the experimental
`UNDUO_SELF_CONTAINED=1` build: it finds the `uk-` classes a page's markup uses
and trims UIkit's CSS to them, so the build can put every stylesheet in the page.

`update-cdn.mjs` refreshes pinned CDN versions, hashes and integrity sources
after root catalog changes, and fails unless jsDelivr serves the installed npm
file with the SHA-256 its data API lists. `verify-cdn.mjs` reads only the
generated HTML (or the pages given as arguments): for each element's
`data-integrity-source` it checks that the pinned hash (`integrity`, or the
plugin's `data-plugin-integrity`) is jsDelivr's listed SHA-256, that the served bytes
match it, and that they equal the file in the npm registry tarball (after
checking its SHA-512) or, for unduo's own assets, GitHub's copy of the commit.
It shares no code with the build. `update-universities.mjs` downloads the WHED snapshot into the university
data package. Review their output diffs before publishing.

`__tests__/auditable.test.ts` (`vp run test:web`; plain `vp test` skips it) checks
generated output, starts its own preview server and uses an isolated headless
agent-browser session for the home page, the setup flow from a downloaded file and integrity
rejection checks. Assets come from the preview server unless `UNDUO_PUBLISHED=1`
is set. It closes that session and server when finished and never submits a real
Duo activation.
