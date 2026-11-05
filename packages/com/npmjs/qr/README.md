# @-/com.npmjs.qr

Workspace wrapper for [qr](https://github.com/paulmillr/qr), used only in tests: they read back the page's own QR code encoder and draw QR images for the plugin's reader. The page doesn't load it. The upstream dependency version is owned by the root Bun catalog.

## Usage

Import the documented public API from `@-/com.npmjs.qr`. Package-local modules use `#...` imports.

## API

```ts
export { encodeQR } from "qr";
export { decodeQRBatch } from "qr/decode.js";
```
