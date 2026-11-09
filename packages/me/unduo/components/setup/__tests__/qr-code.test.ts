import { decodeQRBatch } from "@-/com.npmjs.qr";
import { readQrCodes } from "@-/me.unduo.lib.qr-reader";
import { expect, test } from "vite-plus/test";
import { qrImage, qrModules } from "#qr-code";

/** Read `modules` back with paulmillr's qr, at 4 pixels a module inside an 8-module quiet zone. */
async function read(modules: boolean[][]) {
  const scale = 4;
  const border = 8;
  const width = (modules.length + border * 2) * scale;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  modules.forEach((row, y) =>
    row.forEach((on, x) => {
      if (!on) return;
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const at = (((y + border) * scale + dy) * width + (x + border) * scale + dx) * 4;
          data.fill(0, at, at + 3);
        }
    }),
  );
  // decodeQRBatch ends each image's list with an Error once it finds no more codes.
  const [found = []] = await decodeQRBatch([{ width, height: width, data }]);
  return found.filter((text) => typeof text === "string");
}

/** Level M byte capacity by version, as ISO/IEC 18004 lists it. */
const capacity = [
  14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 666,
  711, 779, 857, 911, 997, 1059, 1125, 1190, 1264, 1370, 1452, 1538, 1628, 1722, 1809, 1911, 1989,
  2099, 2213, 2331,
];

test.each(capacity.map((bytes, i) => [i + 1, bytes]))(
  "fills version %i with %i bytes that read back",
  async (version, bytes) => {
    // Printable ASCII from a seeded pseudo-random sequence.
    let seed = version;
    const text = Array.from({ length: bytes }, () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return String.fromCharCode(32 + (seed % 95));
    }).join("");
    const modules = qrModules(text);
    expect(modules.length).toBe(version * 4 + 17);
    // One more byte needs the next version.
    if (version < 40) expect(qrModules(`${text}.`).length).toBe(version * 4 + 21);
    expect(await read(modules)).toEqual([text]);
  },
  20_000,
);

test("reads back an authenticator link and UTF-8", async () => {
  for (const text of [
    "otpauth://totp/Duo:University%20of%20Toronto?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Duo&algorithm=SHA1&digits=6&period=30",
    "École · 東京 · 🔑",
    "a",
  ])
    expect(await read(qrModules(text))).toEqual([text]);
});

test("refuses text longer than version 40 holds", () => {
  expect(() => qrModules("a".repeat(2332))).toThrow("too long");
});

test("draws an SVG data: URL with a white quiet zone", () => {
  const url = qrImage("a");
  expect(url.startsWith("data:image/svg+xml,")).toBe(true);
  const svg = decodeURIComponent(url.slice("data:image/svg+xml,".length));
  // Version 1 is 21 modules, plus 2 on each side, at 6 pixels each.
  expect(svg).toContain('width="150" height="150" viewBox="0 0 25 25"');
  expect(svg).not.toMatch(/<script|href|url\(/);
});

test("reads back with the page's own reader", () => {
  const scale = 3;
  for (const text of [
    "duo://ABCDEFGHIJKLMNOPQRST-YXBpLWFiY2QxMjM0LmR1b3NlY3VyaXR5LmNvbQ",
    "x".repeat(900),
  ]) {
    const modules = qrModules(text);
    const width = (modules.length + 8) * scale;
    const gray = new Uint8Array(width * width).fill(255);
    modules.forEach((row, y) =>
      row.forEach((on, x) => {
        if (!on) return;
        for (let dy = 0; dy < scale; dy++)
          gray.fill(
            0,
            ((y + 4) * scale + dy) * width + (x + 4) * scale,
            ((y + 4) * scale + dy) * width + (x + 5) * scale,
          );
      }),
    );
    expect(readQrCodes(gray, width, width)).toEqual([text]);
  }
});
