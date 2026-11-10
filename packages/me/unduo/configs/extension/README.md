# @-/me.unduo.configs.extension

A Playwright test of UnDuo Autofill ([`apps/unduo-extension`](../../../../../apps/unduo-extension/README.md)):
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
