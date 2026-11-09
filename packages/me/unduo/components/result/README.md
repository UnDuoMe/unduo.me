# @-/me.unduo.components.result

Shared authenticator result markup: the `otpauth://` QR code selected by Duo, the setup
key (shown on request), a local six-digit code check, and Duo sign-in instructions.
Nothing copies the key or its link: some systems sync the clipboard to the cloud. It stores nothing itself.

## Usage

Import the documented public API from `@-/me.unduo.components.result`. Package-local modules use `#...` imports.

## API

```ts
export { authenticatorResult } from "#authenticator-result";
```

`authenticatorResult(page)` builds the step from a `SetupPage`. It shows the setup plugin's
`view.account`, which the plugin guard has already checked: its `otpauth://`
link has only the standard parameters and carries `account.secret`, so the QR
code, the touch-only "Open in authenticator app" link and the copied text
cannot send a phone's camera or an authenticator app to a web page. The host
draws the QR code from that link. Reveal sends an event to the plugin, which keeps
the account in memory.

The account is always time-based (TOTP): the plugin makes one only when Duo's reply sets
`use_totp` to `true`, and the guard accepts only `otpauth://totp/` links. There is no type selector.

The local code check uses the browser's Web Crypto HMAC-SHA-1 implementation and the
current and adjacent 30-second windows (RFC 6238). It keeps the entered code and
result in memory, resets them when the account changes or the step closes, and
sends nothing over the network. A match confirms the app has the right key; the
separate Duo sign-in checks whether the organization accepts time-based codes.
