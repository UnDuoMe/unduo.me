# @-/me.unduo.configs.extension

Packs and releases UnDuo Autofill, and tests it. The test is a Playwright test of UnDuo Autofill ([`apps/unduo-extension`](../../../../../apps/unduo-extension/README.md)):
the built extension, loaded into Playwright's Chromium, on a mock of Duo's Universal Prompt.

```sh
vp run install:e2e       # once, downloads Chromium
vp run test:extension    # builds the extension, then runs the test headless
```

`mock-prompt.ts` serves the prompt at `api-e2efake0.duosecurity.com`, a host no Duo customer
has. Its push, method list and passcode screens copy the live prompt's markup as seen on
2026-11-10: tags, ids, classes, `data-testid`s, labels, the passcode field's attributes, the
list's rows arriving 160 ms after the list, and the field taking focus as it appears. It has no
branding, account or device names. `--host-resolver-rules` makes every host fail to resolve,
and the route aborts any other request, so nothing reaches Duo.

The test checks that a push screen ends on a fillable, focused passcode field; that the field's
last focus came after it became fillable; that a new field gets fixed again; that the extension
leaves the method list alone after you click **Other options**; and that it waits on a list
with no Duo Mobile passcode. Its files end in `.e2e.ts`, so plain `vp test` doesn't run it.

`UNDUO_EXTENSION_DIR=<folder> vpx playwright test` (from this package) runs the same test on
another copy, such as a release zip unzipped.

## Releases

```sh
vp run pack:extension      # builds, then writes .output/unduo-autofill.zip and its SHA-256
vp run release:extension   # builds, then publishes that zip as a GitHub release
```

`extension-zip.ts` zips the build without compression, sorted, with every entry dated
1980-01-01 and mode 0644, so the same build always gives the same bytes. `release-command.ts`
refuses uncommitted extension changes and commits that aren't on `origin/main`, then creates
the release `autofill-v<version>` at that commit as the UnDuoMe Automation App, with install
steps and the zip's SHA-256, and uploads `unduo-autofill.zip`. It never replaces a release: bump
`version` in `apps/unduo-extension/public/manifest.json` first. The asset keeps one name, so
`releases/latest/download/unduo-autofill.zip` always gets the newest.
