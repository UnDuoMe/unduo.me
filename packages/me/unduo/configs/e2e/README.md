# @-/me.unduo.configs.e2e

A Playwright test of a student's whole path on the live site, from a browser with
nothing in it: `unduo.me`'s home page, the downloaded file opened from disk, and a
passcode from the resulting authenticator signing in.

```sh
vp run install:e2e   # once, downloads Chromium
vp run test:e2e      # headless, against https://unduo.me/
```

`UNDUO_E2E_URL` points it at another copy of the site. Plain `vp test` doesn't run it:
its files end in `.e2e.ts`. The report and traces land in `.output/`, and each
instruction's screenshot is attached to the report. A failure at the very first
navigation can mean a network that blocks `unduo.me`, as UofT's wifi has.

## What's real and what isn't

`unduo.me`, jsDelivr and Chromium are real. These are answered in the test's process,
at their real host names:

- `mock-duo.ts`: UofT's weblogin, its UTORMFA enrollment site with Duo's frame inside it,
  the device pages in that frame, its QR codes and Duo's activation endpoint. They follow the
  real pages as seen on 2026-11-05: the frame at `/frame/web/v1/auth`, "Send Me a Push", every
  step's heading and label, and a QR code whose image is `/frame/qr?value=CODE-BASE64HOST` and
  which holds that same value. The passcode form, the listing of a new tablet and the activation
  email weren't seen, and are made up.
- `mock-assistant.ts`: an AI assistant with a canned "Safe: yes". It shows the student
  can do what the page says, and says nothing about whether the file is safe.

Every code, secret and credential is made up for the run. The mock copies the real
pages' labels and steps, which the test follows, but no branding, and every page has a
fixture banner. To compare it with the real portal again, sign in through `neko-browser`'s
viewer yourself and stop at the QR code: never activate it, and keep captures out of the repo.

Nothing can reach the real school or Duo. `--host-resolver-rules` in
`playwright.config.ts` makes every host but the real ones fail to resolve, which
holds even for what Playwright's routes miss: it doesn't route the request after a
redirect, so the mock must never send an HTTP redirect. `network-guard.ts` also
refuses and records any request to an unexpected host, which fails the test.

Where the pages name what to click, the test reads the name from the page, so it fails
if an instruction stops matching what the portal shows.

`browser-actions.ts` stands in for what a browser test can't click: the context menu's
Copy Image, a drag from the desktop and a phone's camera, which reads the pixels on
screen. Headless Chromium's clipboard is its own, so the tests leave yours alone.

## Not covered

- A real activation, or anything real Duo does with the request. A real run enrolls a
  device on someone's account.
- **Scan my screen**, which needs a screen-share picker.
- Browsers other than Chromium, including Safari, and phones.
- Whether real assistants clear the file.
