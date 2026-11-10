# @-/me.unduo.lib.duo-prompt

What UnDuo Autofill ([`apps/unduo-extension`](../../../../../apps/unduo-extension/README.md))
does on Duo's Universal Prompt.

## API

```ts
export {
  followDuoPrompt,
  letPasswordManagersFill,
  passwordManagerIgnoreAttributes,
} from "#duo-prompt";
```

`followDuoPrompt(document)` watches the page with a `MutationObserver`. Until it reaches the
passcode screen, or you click anything yourself, it clicks **Other options** and then **Duo
Mobile passcode**, each element at most once. On the passcode screen it calls
`letPasswordManagersFill` on the field every time Duo renders or changes it, and focuses it
again once if Duo had already focused it. It returns a function that stops watching.

`letPasswordManagersFill(input)` removes `passwordManagerIgnoreAttributes` (`data-1p-ignore`,
`data-lpignore`, `data-bwignore`, `data-protonpass-ignore`) and sets
`autocomplete="one-time-code"`.

## Duo's markup

As served on 2026-11-10 at `/frame/v4/auth/prompt?sid=…`, one page that swaps screens with
`history.pushState`:

| Screen                              | Element                                                                                                                                                                                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Push (or another method Duo picked) | `.other-options-link a`, "Other options", linking to `/frame/v4/auth/all_methods?sid=…`                                                                                                                                                         |
| Method list                         | `ul.all-auth-methods-list`; its rows render about 160 ms later. Duo Mobile passcode is `li[data-testid="test-id-mobile-otp"] a.auth-method-link`, labelled "Duo Mobile passcode"                                                                |
| Passcode                            | `<input id="passcode-input" name="passcode-input" inputmode="numeric" maxlength="6" autocomplete="off" data-lpignore="true" data-1p-ignore="true">` inside a `<form>`, focused as it appears; `button.other-options-link` goes back to the list |

Duo opened on a push each time, even right after a passcode was chosen in the same session.
If Duo renames these, update the selectors here and the mock in
[`@-/me.unduo.configs.extension`](../../configs/extension/README.md).
