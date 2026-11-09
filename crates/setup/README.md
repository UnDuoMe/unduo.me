# unduo-setup

The logic of unduo's web setup, five steps, compiled to a WebAssembly
[Extism](https://extism.org) plugin. The page's JavaScript only performs browser
I/O; everything it shows and every link it builds comes from here. The plugin
reads the step from the address the page opened with, and nothing writes it. The
plugin keeps the page's state in its own memory between calls.

| Module          | Does                                                                          |
| --------------- | ----------------------------------------------------------------------------- |
| `core.rs`       | The step state machine and scan loop: browser events in, view and effects out |
| `state.rs`      | Reads the URL hash (step only), validated field by field                      |
| `activation.rs` | Duo activation links, QR image addresses and `CODE-BASE64HOST` values         |
| `response.rs`   | Duo's pasted reply and errors, the base32 secret and the `otpauth://` link    |
| `request.rs`    | The Duo Mobile activation URL; the host adds the device fields and its key    |
| `html.rs`       | The first `<img src>` in copied HTML                                          |

The plugin exports `update` (a browser event as JSON). The page reads QR codes
itself and sends their text in a `decoded` event, so the plugin never receives
pixels. `qr.rs` holds an rqrr reader behind the `qr-reader` feature, which the
published module is built without. It imports only Extism's kernel functions for input, output, memory
and errors (`alloc`, `input_length`, `input_load_u8`, `input_load_u64`,
`store_u8`, `store_u64`, `output_set` and `error_set`). The page adds no host
functions, no WASI and no allowed hosts, and the browser's `fetch` checks its
SHA-256 before the page compiles it. One guard in
`packages/me/unduo/components/setup/plugin/setup-plugin.ts` checks every output
and stops the page unless the Duo form and the authenticator link match strict
rules.

## Build

```sh
vp run test:plugin   # cargo test
vp run build:plugin  # writes packages/me/unduo/components/setup/plugin/setup.wasm
vp run check:plugin  # rebuilds in a temporary directory and compares the bytes
```

`rust-toolchain.toml` pins the compiler, target and `rust-src`. The build
starts from an empty target directory, remaps local paths, and runs rustc through
`packages/me/unduo/configs/web/rustc-wrapper.mjs`, which replaces Cargo's
host-dependent crate metadata hashes. The same sources then produce the same
`setup.wasm` on macOS and Linux, on Arm and x86. The build fails if the plugin imports anything beyond Extism's kernel.
The web build refuses a plugin older than these sources.

The terminal commands in `packages/me/unduo/components/setup/help/terminal-commands.ts`
send Duo the same request without the plugin; keep them in step when Duo's
formats change.
