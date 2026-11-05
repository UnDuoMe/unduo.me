/**
 * The authenticator QR code, drawn by this page's own code: the text as UTF-8
 * bytes, error correction level M, the smallest version (1 to 40) that holds
 * it and the mask with the lowest penalty, as ISO/IEC 18004 specifies.
 */

import { alignmentCentres, dataModules, masks } from "@-/me.unduo.lib.qr-reader";

/** Level M: error correction codewords in each block, by version (index 0 unused). */
const eccPerBlock = [
  0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28,
  28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
];
/** Level M: the number of blocks, by version. */
const blockCount = [
  0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25,
  26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
];

const dataCodewords = (version: number) =>
  Math.floor(dataModules(version) / 8) - eccPerBlock[version]! * blockCount[version]!;

/** Multiplication in GF(256) modulo x⁸ + x⁴ + x³ + x² + 1. */
function multiply(x: number, y: number) {
  let product = 0;
  for (let bit = 7; bit >= 0; bit--) {
    product = (product << 1) ^ ((product >>> 7) * 0x11d);
    product ^= ((y >>> bit) & 1) * x;
  }
  return product;
}

/** The Reed–Solomon generator polynomial of `degree`, without its leading 1. */
function generator(degree: number) {
  const coefficients = Array.from({ length: degree }, (_, i): number => (i === degree - 1 ? 1 : 0));
  let root = 1;
  for (let round = 0; round < degree; round++) {
    for (let i = 0; i < degree; i++) {
      coefficients[i] = multiply(coefficients[i]!, root) ^ (coefficients[i + 1] ?? 0);
    }
    root = multiply(root, 2);
  }
  return coefficients;
}

/** The error correction codewords for one block. */
function correction(block: number[], divisor: number[]) {
  const remainder = divisor.map(() => 0);
  for (const codeword of block) {
    const factor = codeword ^ remainder.shift()!;
    remainder.push(0);
    divisor.forEach((coefficient, i) => {
      remainder[i] = remainder[i]! ^ multiply(coefficient, factor);
    });
  }
  return remainder;
}

/** Split the data into blocks, add each block's correction, and interleave them. */
function codewords(version: number, data: number[]) {
  const blocks = blockCount[version]!;
  const ecc = eccPerBlock[version]!;
  const total = Math.floor(dataModules(version) / 8);
  const shortBlocks = blocks - (total % blocks);
  const shortLength = Math.floor(total / blocks) - ecc;
  const divisor = generator(ecc);
  const dataBlocks: number[][] = [];
  for (let i = 0, start = 0; i < blocks; i++) {
    const length = shortLength + (i < shortBlocks ? 0 : 1);
    dataBlocks.push(data.slice(start, start + length));
    start += length;
  }
  const eccBlocks = dataBlocks.map((block) => correction(block, divisor));
  const result: number[] = [];
  for (let i = 0; i <= shortLength; i++)
    for (const block of dataBlocks) if (i < block.length) result.push(block[i]!);
  for (let i = 0; i < ecc; i++) for (const block of eccBlocks) result.push(block[i]!);
  return result;
}

/** The standard penalty for runs, 2×2 squares, finder-like patterns and imbalance. */
function penalty(modules: boolean[][]) {
  const size = modules.length;
  const columns = modules.map((_, x) => modules.map((row) => row[x]!));
  let score = 0;
  for (const line of [...modules, ...columns]) {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    const bits = line.map((on) => (on ? "1" : "0")).join("");
    for (const finder of ["10111010000", "00001011101"])
      for (let at = bits.indexOf(finder); at >= 0; at = bits.indexOf(finder, at + 1)) score += 40;
  }
  for (let y = 0; y + 1 < size; y++)
    for (let x = 0; x + 1 < size; x++) {
      const on = modules[y]![x];
      if (on === modules[y]![x + 1] && on === modules[y + 1]![x] && on === modules[y + 1]![x + 1])
        score += 3;
    }
  const dark = modules.flat().filter(Boolean).length;
  return score + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
}

/** Whether each module is dark, row by row, without the quiet zone. */
export function qrModules(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  while (4 + (version < 10 ? 8 : 16) + bytes.length * 8 > dataCodewords(version) * 8) {
    if (++version > 40) throw new RangeError("The text is too long for a QR code.");
  }

  // Byte mode, the length, the bytes, a terminator, then padding.
  const capacity = dataCodewords(version) * 8;
  const bits: number[] = [];
  const append = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  append(0b0100, 4);
  append(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) append(byte, 8);
  append(0, Math.min(4, capacity - bits.length));
  append(0, (8 - (bits.length % 8)) % 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8)
    data.push(bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
  for (let pad = 0xec; data.length < capacity / 8; pad ^= 0xec ^ 0x11) data.push(pad);

  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const reserved = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const set = (x: number, y: number, on: boolean) => {
    modules[y]![x] = on;
    reserved[y]![x] = true;
  };

  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const) {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        const [x, y] = [cx + dx, cy + dy];
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, distance !== 2 && distance !== 4);
      }
  }
  const centres = alignmentCentres(version);
  const end = centres.length - 1;
  centres.forEach((cy, i) =>
    centres.forEach((cx, j) => {
      // The three corners hold finder patterns.
      if ((i === 0 && j === 0) || (i === 0 && j === end) || (i === end && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }),
  );
  const drawFormat = (mask: number) => {
    // Level M is 00.
    let remainder = mask;
    for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    const format = ((mask << 10) | remainder) ^ 0x5412;
    const bit = (i: number) => ((format >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (version >= 7) {
    let remainder = version;
    for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const info = (version << 12) | remainder;
    for (let i = 0; i < 18; i++) {
      const on = ((info >>> i) & 1) === 1;
      set(size - 11 + (i % 3), Math.floor(i / 3), on);
      set(Math.floor(i / 3), size - 11 + (i % 3), on);
    }
  }

  // Codewords run in two-module columns from the bottom right, up then down.
  const stream = codewords(version, data);
  let next = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (reserved[y]![x] || next >= stream.length * 8) continue;
        modules[y]![x] = ((stream[next >>> 3]! >>> (7 - (next & 7))) & 1) === 1;
        next++;
      }
    }
  }

  const flip = (mask: number) => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (!reserved[y]![x] && masks[mask]!(x, y)) modules[y]![x] = !modules[y]![x];
  };
  let best = 0;
  let lowest = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    flip(mask);
    drawFormat(mask);
    const score = penalty(modules);
    if (score < lowest) [best, lowest] = [mask, score];
    flip(mask);
  }
  flip(best);
  drawFormat(best);
  return modules;
}

/**
 * The QR code for `text` as an SVG `data:` URL, with `scale`-pixel modules and
 * a quiet zone `border` modules wide. Throws if the text doesn't fit.
 */
export function qrImage(text: string, scale = 6, border = 2): string {
  const modules = qrModules(text);
  const size = modules.length + border * 2;
  let path = "";
  modules.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      let run = 1;
      while (row[x + run]) run++;
      path += `M${x + border} ${y + border}h${run}v1h-${run}z`;
      x += run;
    }
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size * scale}" height="${size * scale}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
