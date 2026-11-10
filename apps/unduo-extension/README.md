# @-apps/unduo-extension

**UnDuo Autofill**, a browser extension to install alongside 1Password. On Duo's sign-in
prompt (the Universal Prompt at `https://api-XXXXXXXX.duosecurity.com/frame/v4/…`) it:

1. clicks **Other options**, then **Duo Mobile passcode**, so every sign-in lands on the
   passcode field instead of waiting on a push. Duo often picks a push to the device unduo
   registered, which never gets one.
2. lets 1Password fill that field. Duo marks it `data-1p-ignore` (and `data-lpignore`,
   `autocomplete="off"`), which tells 1Password to skip it. The extension removes those
   marks, sets `autocomplete="one-time-code"`, and focuses the field again so 1Password
   offers your code.

It stops choosing at the passcode screen, and as soon as you click anything yourself, so
**Other options** still takes you to every method. It doesn't type, read or send codes, press
**Verify**, or use the network, and it asks for no permissions beyond running on those Duo
pages. It leaves Duo's older Traditional Prompt (`/frame/web/v1/auth`) alone, including the
one in the enrollment portal you use with unduo.

## Install

UnDuo Autofill isn't in any extension store. Install it from its release zip:

1. Download [**unduo-autofill.zip**](https://github.com/UnDuoMe/unduo.me/releases/latest/download/unduo-autofill.zip)
   from the [latest release](https://github.com/UnDuoMe/unduo.me/releases/latest) and unzip it.
   Keep the folder somewhere it can stay: the browser runs the extension from it.
2. Add it to your browser:
   - **Chrome, Edge, Brave, Arc:** open `chrome://extensions` (`edge://extensions` in Edge),
     turn on **Developer mode**, click **Load unpacked** and choose the unzipped folder, the
     one holding `manifest.json`.
   - **Firefox:** open `about:debugging#/runtime/this-firefox`, click **Load Temporary
     Add-on…** and choose `unduo-autofill.zip`. Firefox removes it when it quits.
3. Let 1Password match Duo's page. 1Password stops filling when a sign-in moves to another
   domain, and Duo's prompt is on `duosecurity.com`, not your school's site. Edit the login
   that holds your unduo one-time password and add the prompt's address as a website, for
   example `https://api-XXXXXXXX.duosecurity.com` (copy the host from the address bar).

To update, unzip the new release over the same folder and click the extension's reload
button in `chrome://extensions`.

Each release lists its zip's SHA-256. The zip is reproducible: at the release's tag,
`vp install && vp run pack:extension` builds the same bytes and prints their SHA-256.

### Build it yourself

```sh
vp install
vp run build:extension   # writes apps/unduo-extension/dist
```

Load `apps/unduo-extension/dist` the same way, or its `manifest.json` in Firefox.

## Code

`src/content.ts` is the content script: it calls `followDuoPrompt(document)` from
[`@-/me.unduo.lib.duo-prompt`](../../packages/me/unduo/lib/duo-prompt/README.md).
`public/` holds `manifest.json` and the icons, drawn from the site's favicon.
`vite.config.ts` builds one unminified classic script, `dist/content.js`, since content
scripts can't be modules. `vp run test:extension` builds it and runs
[its test](../../packages/me/unduo/configs/extension/README.md) in Chromium.
