# @-/me.unduo.lib.qr-reader

Reads the text of QR codes in a gray image, written for the setup page, so the
page reads every QR code in its own readable code and the setup plugin only ever
gets text.

## Usage

Import the documented public API from `@-/me.unduo.lib.qr-reader`. Package-local modules use `#...` imports.

## API

```ts
export { alignmentCentres, dataModules, masks, maxCodes, maxSide, readQrCodes } from "#qr-reader";
```

`readQrCodes(gray, width, height)` takes one byte of gray per pixel, row by row,
and returns the text of up to `maxCodes` (16) distinct QR codes, or nothing for an
image wider or taller than `maxSide` (1920) pixels or whose pixels don't match its
size. It wipes its copies of the pixels once read.

`alignmentCentres`, `dataModules` and `masks` are the parts of ISO/IEC 18004 that
the page's QR encoder (`components/setup/qr-code.ts`) shares with the reader.

## How it reads

1. It splits the image into dark and light by one overall level (Otsu's method),
   then, if no code turned up, by the light around each pixel, for photos.
2. It finds corner patterns: runs of dark, light, dark, light and dark in the
   ratio 1:1:3:1:1, across a row and down a column through the same centre.
3. For every three patterns that could be one code's corners, it works out the
   size from the timing line, and maps the grid, using the alignment pattern
   when it finds one so that a tilted code still lines up.
4. It reads the format and version, removes the mask, separates the blocks,
   corrects errors with Reed–Solomon, and reads the numeric, alphanumeric and
   byte segments as UTF-8. A code whose errors can't be corrected reads as nothing.

Light codes on a dark background are tried only when no dark ones are found. The
number of patterns and attempts per image is capped, so an image can't make it
run for long.

The tests read every version at all four levels at full capacity, and codes that
are resized, turned, tilted, blurred, noisy, faint, unevenly lit or damaged.
