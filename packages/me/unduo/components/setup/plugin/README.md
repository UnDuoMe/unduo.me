# @-/me.unduo.components.setup.plugin

The setup flow's logic, compiled from Rust in [`crates/setup`](../../../../../../crates/setup)
to the committed `setup.wasm`. The page runs it and only renders what it returns.

## Usage

Import the documented public API from `@-/me.unduo.components.setup.plugin`. Package-local modules use `#...` imports.

## API

```ts
export { createSetupLogic, loadJsSetupPlugin } from "#js-plugin";
export { defaultPluginLimits, guard, loadSetupPlugin, newPublicKey } from "#setup-plugin";
export type { DuoRequest, PluginLimits, SetupEffect, SetupEvent, SetupPlugin, SetupView, … } from "#entities";
```

`loadSetupPlugin(url, integrity, limits?)` fetches the plugin with `fetch`'s
`integrity` option, so the browser refuses bytes whose SHA-256 differs, and
instantiates it with its own `kernel()` and memory. It returns a `SetupPlugin`: a
function that passes a browser event to the module's `update` export as JSON and
returns the view to render and the effects to perform. The page reads QR codes
itself, with `readQrCodes` from `@-/me.unduo.lib.qr-reader`, and sends their text
in a `decoded` event, so the plugin never receives pixels. The plugin keeps the
page's state in its own memory.

The plugin is built with Extism's Rust PDK and imports only Extism's kernel
functions for input, output, memory and errors (`alloc`, `input_length`,
`input_load_u8`, `input_load_u64`, `store_u8`, `store_u64`, `output_set` and
`error_set`). The page doesn't load the Extism SDK: `kernel()` implements those
eight functions, and they are the only imports the module is instantiated
with. They copy one event in and the output or error out, through blocks of
one buffer; reading or writing outside them ends the call.

**Limits.** `defaultPluginLimits` gives each call 1024 memory pages (64 MiB)
and 5 seconds; the page's Advanced panel can change them. `maxPages` caps the
kernel's blocks for a call (its input, output and error), and the module's own
WebAssembly memory, which holds the plugin's state, is checked against it after
each call. The plugin runs on the page's thread, so `guard(call, timeoutMs)`
times each call and fails one that ran too long. Nothing on the page can
interrupt a call while it runs, but late output is never used. A worker could
interrupt it, but the CSP allows none. `loadSetupPlugin` throws a `RangeError`
unless every limit is a positive whole number, and refuses an `integrity` that
isn't one SHA-256.

The guard also caps each output: at most 1,048,576 UTF-16 code units of JSON
(checked before parsing), 16 effects and 65,536 units in any string. `crates/setup`
clears the text field instead of echoing longer pasted text.

**Security boundary.** `guard(call)` runs calls one at a time and checks every
output before any other code sees it. `call` returns the plugin's output as
a string, and the guard parses it. The guard throws on a violation; after one,
every later call fails, so the page stops.
Each output must match the schema `Output`, written as plain checks in the guard, exactly: every field
the plugin returns, no others, each with its type, pattern or allowed values.
Within that, it checks the two values that can leave the page. The address isn't
one: the page changes it only once, when it opens and before anything is pasted.

- the Duo form (`view.request`): the plugin names only its URL,
  `https://api-XXXXXXXX.duosecurity.com/push/v2/activation/CODE?customer_protocol=1`,
  and the guard writes Duo Mobile's 16 standard device fields and this page's
  key from `newPublicKey()` itself, ignoring anything else the plugin sends. The
  browser sends the host name unencrypted (DNS and TLS), so it must be Duo's
  eight-character account ID and stay the same for the page's lifetime: the
  plugin gets one choice of host per page load. A new URL must also come from
  text the page read since it loaded or started over: pasted text or HTML, or
  the text of a QR code that `readQrCodes` read from an image or screen frame.
  After
  percent-decoding twice, one such text holds the URL's code as a whole word and
  its host as `-XXXXXXXX.duosecurity.com` or in base64. TLS encrypts the path,
  which holds the activation code. A form before the page has a key is refused;
- the authenticator link (`view.account.uri`) is an `otpauth://` link with only
  the standard parameters, and its secret equals `view.account.secret`. Text
  pasted since the page loaded or started over must hold the text the secret
  encodes and the link's organization name, as written or JSON-escaped
  (`fromReply`): Duo's reply arrives that way.

Everything else is rendered as text, booleans and classes. `newPublicKey()`
generates the RSA key pair for the Duo form with WebCrypto and keeps its public
key in the guard; the plugin never sees it, and the private key is never
exported or used. `__tests__` drives the guard with a fake plugin, and runs the
real `setup.wasm` through a whole setup so the schema and `crates/setup` agree.

**Readable logic without WebAssembly (an experiment).** `js-plugin.ts` ports
`crates/setup` function by function to TypeScript for the build
`UNDUO_JS_PLUGIN=1 vp run build:web`. `createSetupLogic()` returns a function
that takes one event as JSON and returns the JSON the plugin's `update` export
returns, keeping the page's state in its closure. `loadJsSetupPlugin(limits)`
returns it through the same `guard`, so the page checks the port's output as it
checks the plugin's. In that build the pages carry no `data-plugin-url`, their CSP has no
`'wasm-unsafe-eval'` and `connect-src` lists only the screenshots. Without the
variable the build is unchanged: the bundler drops the loader the page doesn't
use, and the stylesheet and assets commit stay the same.

`__tests__/js-plugin.test.ts` gives the committed `setup.wasm` and the port the
same events (every event type, the inputs of the Rust tests, cases where
JavaScript's built-ins differ from Rust's, and seeded random walks) and requires
the same JSON byte for byte, or that both refuse the event. One difference is
known. The platform's URL parser keeps a host label that starts with `xn--` but
isn't valid punycode, which the `url` crate refuses, so the port names a
different reason for refusing such a link.

Build-time code imports `@-/me.unduo.components.setup.plugin/server`:

```ts
export {
  readSetupPlugin,
  setupPluginFile,
  setupPluginManifestFile,
  setupPluginSourceHash,
  setupPluginSources,
  type SetupPluginManifest,
} from "#plugin-file";
```

`readSetupPlugin()` returns the plugin's bytes and SHA-256 and throws when
`setup.wasm.json` no longer matches the Rust sources. Rebuild with
`vp run build:plugin`; `vp run check:plugin` rebuilds in a temporary directory
and fails unless the committed bytes are reproduced exactly. The layout reads
`setup.wasm.json` to pin the plugin in each page.
