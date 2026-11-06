# @-/me.unduo.components.result

Shared authenticator result markup: the `otpauth://` QR code, a counter-based
(HOTP, default) / time-based (TOTP) switch, the setup key (shown on request), and test
instructions.
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
draws the QR code from that link. Code type and reveal send
events to the plugin, which keeps the code type in the address.
