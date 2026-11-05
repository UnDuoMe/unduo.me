/**
 * Reads the text of QR codes in a gray image, as ISO/IEC 18004 lays them out:
 * find the three corner patterns, sample the grid of modules between them,
 * correct errors with Reed–Solomon, then read the data segments. It takes
 * numbers and returns strings; it uses no browser API but `TextDecoder`.
 */

/** The longest side the page sends; it scales larger images down first. */
export const maxSide = 1920;
/** At most this many codes are returned. */
export const maxCodes = 16;
/** Bounds on the work one image can cause, however many patterns it shows. */
const maxFinders = 64;
const maxAttempts = 400;

interface Point {
  x: number;
  y: number;
}
/** A corner pattern's centre and the width of its rows in pixels per module. */
interface Finder extends Point {
  unit: number;
  hits: number;
}
/** One byte per pixel, row by row: 1 where the image is dark. */
interface Bitmap {
  dark: Uint8Array;
  width: number;
  height: number;
}

const isDark = ({ dark, width, height }: Bitmap, x: number, y: number) =>
  x >= 0 && y >= 0 && x < width && y < height && dark[Math.floor(y) * width + Math.floor(x)] === 1;

/** Dark below the level that best separates the image's two groups of pixels (Otsu's method). */
function belowGlobalLevel(gray: Uint8Array) {
  const counts = new Uint32Array(256);
  let total = 0;
  for (const value of gray) {
    counts[value]!++;
    total += value;
  }
  let level = 127;
  let best = -1;
  let below = 0;
  let sumBelow = 0;
  for (let value = 0; value < 256; value++) {
    below += counts[value]!;
    const above = gray.length - below;
    if (!above) break;
    if (!below) continue;
    sumBelow += value * counts[value]!;
    const gap = sumBelow / below - (total - sumBelow) / above;
    const spread = below * above * gap * gap;
    if (spread > best) [best, level] = [spread, value];
  }
  return gray.map((value) => (value <= level ? 1 : 0));
}

/** Dark below 95% of the mean of the square around each pixel, for uneven light in photos. */
function belowLocalMean(gray: Uint8Array, width: number, height: number, radius: number) {
  const stride = width + 1;
  const sums = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += gray[y * width + x]!;
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1]! + row;
    }
  }
  const dark = new Uint8Array(gray.length);
  for (let y = 0; y < height; y++) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width, x + radius + 1);
      const sum =
        sums[bottom * stride + right]! -
        sums[top * stride + right]! -
        sums[bottom * stride + left]! +
        sums[top * stride + left]!;
      const area = (right - left) * (bottom - top);
      dark[y * width + x] = gray[y * width + x]! * area * 100 < sum * 95 ? 1 : 0;
    }
  }
  sums.fill(0);
  return dark;
}

/** The module width of five runs in the 1:1:3:1:1 of a corner pattern, or 0. */
function patternUnit(a: number, b: number, c: number, d: number, e: number) {
  const total = a + b + c + d + e;
  if (total < 7) return 0;
  const unit = total / 7;
  const slack = unit / 2;
  return Math.abs(a - unit) < slack &&
    Math.abs(b - unit) < slack &&
    Math.abs(c - 3 * unit) < 3 * slack &&
    Math.abs(d - unit) < slack &&
    Math.abs(e - unit) < slack
    ? unit
    : 0;
}

/** Whether a 1:1:3:1:1 pattern crosses (x, y) along one axis: its exact centre on that axis and module width. */
function crossCheck(bitmap: Bitmap, x: number, y: number, horizontal: boolean, limit: number) {
  const [column, row] = [Math.floor(x), Math.floor(y)];
  const start = horizontal ? column : row;
  const on = (at: number) => (horizontal ? isDark(bitmap, at, row) : isDark(bitmap, column, at));
  if (!on(start)) return null;
  /** The rest of the centre, the light ring and the dark ring, walking one way. */
  const walk = (step: number) => {
    const runs = [0, 0, 0];
    let at = start + step;
    for (let part = 0; part < 3; part++) {
      while (on(at) === (part !== 1) && runs[part]! < limit) {
        runs[part]!++;
        at += step;
      }
    }
    return runs as [number, number, number];
  };
  const [before, gapBefore, ringBefore] = walk(-1);
  const [after, gapAfter, ringAfter] = walk(1);
  const unit = patternUnit(ringBefore, gapBefore, before + after + 1, gapAfter, ringAfter);
  return unit ? { at: start + (after - before + 1) / 2, unit } : null;
}

/** Every corner pattern seen on at least two rows, those on the most rows first. */
function findFinders(bitmap: Bitmap) {
  const { dark, width, height } = bitmap;
  const finders: Finder[] = [];
  const note = (x: number, y: number, unit: number) => {
    for (const finder of finders) {
      if (
        Math.abs(finder.x - x) <= finder.unit * 1.5 &&
        Math.abs(finder.y - y) <= finder.unit * 1.5 &&
        Math.abs(finder.unit - unit) <= Math.max(1, finder.unit / 2)
      ) {
        const hits = finder.hits + 1;
        finder.x += (x - finder.x) / hits;
        finder.y += (y - finder.y) / hits;
        finder.unit += (unit - finder.unit) / hits;
        finder.hits = hits;
        return;
      }
    }
    if (finders.length < 512) finders.push({ x, y, unit, hits: 1 });
  };
  for (let y = 0; y < height; y++) {
    // The last five runs along this row, the newest last.
    let [a, b, c, d, e] = [0, 0, 0, 0, 0];
    let current = 0;
    let run = 0;
    for (let x = 0; x <= width; x++) {
      const value = x < width ? dark[y * width + x]! : 0;
      if (value === current) {
        run++;
        continue;
      }
      [a, b, c, d, e] = [b, c, d, e, run];
      if (current === 1 && patternUnit(a, b, c, d, e)) {
        const total = a + b + c + d + e;
        const down = crossCheck(bitmap, x - e - d - c / 2, y, false, total);
        const across = down && crossCheck(bitmap, x - e - d - c / 2, down.at, true, total);
        if (down && across) note(across.at, down.at, (down.unit + across.unit) / 2);
      }
      current = value;
      run = 1;
    }
  }
  return finders
    .filter((finder) => finder.hits >= 2)
    .sort((one, other) => other.hits - one.hits)
    .slice(0, maxFinders);
}

const between = (from: Point, to: Point) => ({ x: to.x - from.x, y: to.y - from.y });
const length = ({ x, y }: Point) => Math.hypot(x, y);
const along = (from: Point, step: Point, times: number) => ({
  x: from.x + step.x * times,
  y: from.y + step.y * times,
});

/** The three patterns as top left, top right and bottom left, or null if they can't be one code's corners. */
function arrange(one: Finder, two: Finder, three: Finder) {
  const units = [one.unit, two.unit, three.unit];
  if (Math.max(...units) > Math.min(...units) * 1.6) return null;
  const [ab, bc, ca] = [
    length(between(one, two)),
    length(between(two, three)),
    length(between(three, one)),
  ];
  // The top left corner faces the longest side.
  const [corner, first, second] =
    bc >= ab && bc >= ca ? [one, two, three] : ca >= ab ? [two, three, one] : [three, one, two];
  const [u, v] = [between(corner, first), between(corner, second)];
  const [lengthU, lengthV] = [length(u), length(v)];
  if (Math.max(lengthU, lengthV) > Math.min(lengthU, lengthV) * 1.5) return null;
  if (Math.abs(u.x * v.x + u.y * v.y) > 0.35 * lengthU * lengthV) return null;
  return u.x * v.y - u.y * v.x > 0
    ? ([corner, first, second] as const)
    : ([corner, second, first] as const);
}

/**
 * The code's size from its timing line, which starts 2.5 modules past the
 * centres of two corner patterns: size − 13 changes between dark and light
 * lie between them. 0 if that isn't a possible size.
 */
function sizeFromTiming(bitmap: Bitmap, from: Point, to: Point, sideways: Point, unit: number) {
  const offset = along({ x: 0, y: 0 }, sideways, (2.5 * unit) / length(sideways));
  const steps = Math.ceil(length(between(from, to)) * 2);
  let changes = 0;
  let last = true;
  for (let step = 1; step <= steps; step++) {
    const x = from.x + offset.x + ((to.x - from.x) * step) / steps;
    const y = from.y + offset.y + ((to.y - from.y) * step) / steps;
    const dark = isDark(bitmap, x, y);
    if (dark !== last) changes++;
    last = dark;
  }
  const size = changes + 13;
  return size >= 21 && size <= 177 && size % 4 === 1 ? size : 0;
}

/**
 * The centre of the 5×5 alignment pattern near `guess`: the spot within four
 * modules that best shows its dark centre, light ring and dark ring, or null if
 * none matches at least 23 of its 25 modules.
 */
function findAlignment(bitmap: Bitmap, guess: Point, across: Point, down: Point) {
  let best = 22;
  let [sumX, sumY, count] = [0, 0, 0];
  for (let offsetY = -4; offsetY <= 4; offsetY += 1 / 3) {
    for (let offsetX = -4; offsetX <= 4; offsetX += 1 / 3) {
      const centre = along(along(guess, across, offsetX), down, offsetY);
      let score = 0;
      for (let y = -2; y <= 2; y++) {
        for (let x = -2; x <= 2; x++) {
          const at = along(along(centre, across, x), down, y);
          if (isDark(bitmap, at.x, at.y) === (Math.max(Math.abs(x), Math.abs(y)) !== 1)) score++;
        }
      }
      if (score > best) [best, sumX, sumY, count] = [score, 0, 0, 0];
      if (score === best) [sumX, sumY, count] = [sumX + centre.x, sumY + centre.y, count + 1];
    }
  }
  return count ? { x: sumX / count, y: sumY / count } : null;
}

/** The perspective map that takes each of four grid points to its image point. */
function perspective(from: Point[], to: Point[]) {
  // x′ = (ax + by + c) / (gx + hy + 1), y′ = (dx + ey + f) / (gx + hy + 1)
  const rows: number[][] = [];
  from.forEach(({ x, y }, i) => {
    const { x: u, y: v } = to[i]!;
    rows.push([x, y, 1, 0, 0, 0, -x * u, -y * u, u], [0, 0, 0, x, y, 1, -x * v, -y * v, v]);
  });
  for (let column = 0; column < 8; column++) {
    let pivot = column;
    for (let row = column + 1; row < 8; row++)
      if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!)) pivot = row;
    [rows[column], rows[pivot]] = [rows[pivot]!, rows[column]!];
    const lead = rows[column]![column]!;
    if (Math.abs(lead) < 1e-9) return null;
    for (let row = 0; row < 8; row++) {
      if (row === column) continue;
      const factor = rows[row]![column]! / lead;
      for (let i = column; i <= 8; i++) rows[row]![i]! -= factor * rows[column]![i]!;
    }
  }
  const [a, b, c, d, e, f, g, h] = rows.map((row, i) => row[8]! / row[i]!) as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return (x: number, y: number) => {
    const scale = g * x + h * y + 1;
    return { x: (a * x + b * y + c) / scale, y: (d * x + e * y + f) / scale };
  };
}

/** Error correction codewords per block by version, for levels M, L, H and Q, the order of their format bits. */
const eccPerBlock = [
  [
    0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  ],
  [
    0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30,
    30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  [
    0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  [
    0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30,
    30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
];
/** The number of blocks by version, for levels M, L, H and Q. */
const blockCount = [
  [
    0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25,
    26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
  ],
  [
    0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14,
    15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
  ],
  [
    0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37,
    40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81,
  ],
  [
    0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34,
    34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68,
  ],
];

/** Modules left for codewords once the function patterns are drawn. */
export function dataModules(version: number) {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const count = Math.floor(version / 7) + 2;
    modules -= (25 * count - 10) * count - 55;
    if (version >= 7) modules -= 36;
  }
  return modules;
}

/** The centres of the alignment patterns along either axis. */
export function alignmentCentres(version: number) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const last = version * 4 + 10;
  const gap = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  return [6, ...Array.from({ length: count - 1 }, (_, i) => last - (count - 2 - i) * gap)];
}

/** The eight data masks: whether to flip the module in column `x`, row `y`. */
export const masks: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** Every valid format value, indexed by its five data bits: the level, then the mask. */
const formats = Array.from({ length: 32 }, (_, bits) => {
  let remainder = bits;
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  return ((bits << 10) | remainder) ^ 0x5412;
});

/** Every valid version value from version 7 on, indexed by version. */
const versionValues = Array.from({ length: 41 }, (_, version) => {
  let remainder = version;
  for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  return (version << 12) | remainder;
});

/** The index of the value within three bits of `read`, or −1. */
function nearest(values: number[], read: number, first = 0) {
  for (let i = first; i < values.length; i++) {
    let differing = values[i]! ^ read;
    let count = 0;
    for (; differing; differing &= differing - 1) count++;
    if (count <= 3) return i;
  }
  return -1;
}

/** Powers of 2 and their logarithms in GF(256) modulo x⁸ + x⁴ + x³ + x² + 1. */
const powers = new Uint8Array(512);
const logarithms = new Uint8Array(256);
for (let i = 0, value = 1; i < 255; i++) {
  powers[i] = powers[i + 255] = value;
  logarithms[value] = i;
  value = (value << 1) ^ (value & 0x80 ? 0x11d : 0);
}
const times = (x: number, y: number) => (x && y ? powers[logarithms[x]! + logarithms[y]!]! : 0);
const over = (x: number, y: number) => powers[logarithms[x]! + 255 - logarithms[y]!]!;

/** The value at `x` of a polynomial listed from the constant term up. */
const evaluate = (polynomial: number[], x: number) =>
  polynomial.reduceRight((sum, coefficient) => times(sum, x) ^ coefficient, 0);

/** The syndromes of a block, its codewords listed from the highest power down. */
const syndromes = (block: number[], ecc: number) =>
  Array.from({ length: ecc }, (_, i) =>
    block.reduce((sum, codeword) => times(sum, powers[i]!) ^ codeword, 0),
  );

/** Correct a block in place (Berlekamp–Massey, then Forney). False if it can't be corrected. */
function correct(block: number[], ecc: number) {
  const remainders = syndromes(block, ecc);
  if (remainders.every((value) => value === 0)) return true;
  let locator = [1];
  let previous = [1];
  let errors = 0;
  let shift = 1;
  let lastGap = 1;
  remainders.forEach((value, n) => {
    let gap = value;
    for (let i = 1; i <= errors; i++) gap ^= times(locator[i] ?? 0, remainders[n - i]!);
    if (!gap) {
      shift++;
      return;
    }
    const before = locator;
    const factor = over(gap, lastGap);
    locator = Array.from(
      { length: Math.max(locator.length, previous.length + shift) },
      (_, i) => (locator[i] ?? 0) ^ times(factor, previous[i - shift] ?? 0),
    );
    if (2 * errors <= n) {
      errors = n + 1 - errors;
      previous = before;
      lastGap = gap;
      shift = 1;
    } else shift++;
  });
  if (2 * errors > ecc) return false;
  const evaluator = remainders.map((_, i) => {
    let sum = 0;
    for (let j = 0; j <= i; j++) sum ^= times(locator[j] ?? 0, remainders[i - j]!);
    return sum;
  });
  const slope = locator.map((coefficient, i) => (i % 2 ? coefficient : 0)).slice(1);
  let found = 0;
  block.forEach((_, position) => {
    const power = block.length - 1 - position;
    const inverse = powers[(255 - power) % 255]!;
    if (evaluate(locator, inverse)) return;
    const below = evaluate(slope, inverse);
    if (!below) return;
    block[position]! ^= times(powers[power]!, over(evaluate(evaluator, inverse), below));
    found++;
  });
  return found === errors && syndromes(block, ecc).every((value) => value === 0);
}

/** The text of the segments in the corrected data codewords, or null if it can't be read. */
function readSegments(data: number[], version: number) {
  const group = version < 10 ? 0 : version < 27 ? 1 : 2;
  let at = 0;
  const left = () => data.length * 8 - at;
  const take = (count: number) => {
    let value = 0;
    for (let i = 0; i < count; i++, at++)
      value = value * 2 + ((data[at >>> 3]! >>> (7 - (at & 7))) & 1);
    return value;
  };
  const alphanumerics = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
  const bytes: number[] = [];
  while (left() >= 4) {
    const mode = take(4);
    if (mode === 0) break;
    if (mode === 7) {
      // An ECI designator, one to three bytes long. The text is read as UTF-8 regardless.
      const first = take(8);
      if (first & 0x80) take(first & 0x40 ? 16 : 8);
      continue;
    }
    const bits = { 1: [10, 12, 14], 2: [9, 11, 13], 4: [8, 16, 16] }[mode]?.[group];
    if (!bits || left() < bits) return null;
    let count = take(bits);
    if (mode === 4) {
      if (left() < count * 8) return null;
      while (count--) bytes.push(take(8));
    } else if (mode === 2) {
      if (left() < Math.floor(count / 2) * 11 + (count % 2) * 6) return null;
      for (; count >= 2; count -= 2) {
        const pair = take(11);
        const [one, two] = [alphanumerics[Math.floor(pair / 45)], alphanumerics[pair % 45]];
        if (!one || !two) return null;
        bytes.push(one.charCodeAt(0), two.charCodeAt(0));
      }
      if (count) {
        const one = alphanumerics[take(6)];
        if (!one) return null;
        bytes.push(one.charCodeAt(0));
      }
    } else {
      for (; count > 0; count -= 3) {
        const digits = Math.min(count, 3);
        const width = [0, 4, 7, 10][digits]!;
        if (left() < width) return null;
        const value = String(take(width)).padStart(digits, "0");
        if (value.length > digits) return null;
        for (const digit of value) bytes.push(digit.charCodeAt(0));
      }
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** The modules that hold function patterns rather than codewords. */
function functionModules(version: number) {
  const size = version * 4 + 17;
  const reserved = Array.from({ length: size }, () => new Uint8Array(size));
  const fill = (left: number, top: number, width: number, height: number) => {
    for (let y = top; y < top + height; y++) reserved[y]!.fill(1, left, left + width);
  };
  fill(0, 0, 9, 9);
  fill(size - 8, 0, 8, 9);
  fill(0, size - 8, 9, 8);
  fill(6, 0, 1, size);
  fill(0, 6, size, 1);
  const centres = alignmentCentres(version);
  const end = centres.length - 1;
  centres.forEach((y, i) =>
    centres.forEach((x, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === end) || (i === end && j === 0)) return;
      fill(x - 2, y - 2, 5, 5);
    }),
  );
  if (version >= 7) {
    fill(size - 11, 0, 3, 6);
    fill(0, size - 11, 6, 3);
  }
  return reserved;
}

/** The text of a code from its sampled modules, or null if they don't hold one. */
function readModules(modules: boolean[][]) {
  const size = modules.length;
  const version = (size - 17) / 4;
  const dark = (x: number, y: number) => modules[y]![x]!;
  const number = (bits: boolean[]) =>
    bits.reduce((value, on, i) => (on ? value + 2 ** i : value), 0);

  const nearCorner: boolean[] = [];
  const nearEdges: boolean[] = [];
  for (let i = 0; i <= 5; i++) nearCorner.push(dark(8, i));
  nearCorner.push(dark(8, 7), dark(8, 8), dark(7, 8));
  for (let i = 9; i < 15; i++) nearCorner.push(dark(14 - i, 8));
  for (let i = 0; i < 8; i++) nearEdges.push(dark(size - 1 - i, 8));
  for (let i = 8; i < 15; i++) nearEdges.push(dark(8, size - 15 + i));
  let format = nearest(formats, number(nearCorner));
  if (format < 0) format = nearest(formats, number(nearEdges));
  if (format < 0) return null;
  const level = format >>> 3;
  const mask = masks[format & 7]!;

  if (version >= 7) {
    const above: boolean[] = [];
    const beside: boolean[] = [];
    for (let i = 0; i < 18; i++) {
      above.push(dark(size - 11 + (i % 3), Math.floor(i / 3)));
      beside.push(dark(Math.floor(i / 3), size - 11 + (i % 3)));
    }
    const read = [number(above), number(beside)].map((value) => nearest(versionValues, value, 7));
    if (read[0] !== version && read[1] !== version) return null;
  }

  // Codewords run in two-module columns from the bottom right, up then down.
  const reserved = functionModules(version);
  const total = Math.floor(dataModules(version) / 8);
  const stream = Array.from({ length: total }, () => 0);
  let next = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (reserved[y]![x] || next >= total * 8) continue;
        if (dark(x, y) !== mask(x, y)) stream[next >>> 3]! |= 0x80 >>> (next & 7);
        next++;
      }
    }
  }

  // Blocks take turns, data first, then error correction; the first blocks are one shorter.
  const ecc = eccPerBlock[level]![version]!;
  const blocks = blockCount[level]![version]!;
  const shortBlocks = blocks - (total % blocks);
  const shortLength = Math.floor(total / blocks) - ecc;
  const parts = Array.from({ length: blocks }, (): number[] => []);
  let from = 0;
  for (let i = 0; i <= shortLength; i++)
    parts.forEach((part, index) => {
      if (i < shortLength || index >= shortBlocks) part.push(stream[from++]!);
    });
  for (let i = 0; i < ecc; i++) for (const part of parts) part.push(stream[from++]!);
  const data: number[] = [];
  for (const part of parts) {
    if (!correct(part, ecc)) return null;
    data.push(...part.slice(0, part.length - ecc));
  }
  return readSegments(data, version);
}

/** The text of the code with these three corner patterns, or null. */
function readCode(bitmap: Bitmap, corner: Finder, right: Finder, below: Finder) {
  const across = between(corner, right);
  const down = between(corner, below);
  // A row crosses a turned square on a slant, so the patterns' rows are wider than a module.
  const turn = Math.atan2(across.y, across.x);
  const unit =
    ((corner.unit + right.unit + below.unit) / 3) *
    Math.max(Math.abs(Math.cos(turn)), Math.abs(Math.sin(turn)));
  const estimate = Math.round(((length(across) + length(down)) / 2 / unit + 7 - 17) / 4) * 4 + 17;
  const sizes = new Set([
    sizeFromTiming(bitmap, corner, right, down, unit),
    sizeFromTiming(bitmap, corner, below, across, unit),
    estimate,
    estimate - 4,
    estimate + 4,
  ]);
  for (const size of sizes) {
    if (size < 21 || size > 177) continue;
    const far = size - 3.5;
    const from = [
      { x: 3.5, y: 3.5 },
      { x: far, y: 3.5 },
      { x: 3.5, y: far },
    ];
    const to = [corner, right, below];
    const span = size - 7;
    const [stepAcross, stepDown] = [
      { x: across.x / span, y: across.y / span },
      { x: down.x / span, y: down.y / span },
    ];
    const maps = [];
    if (size > 21) {
      const guess = along(along(corner, stepAcross, size - 10), stepDown, size - 10);
      const found = findAlignment(bitmap, guess, stepAcross, stepDown);
      if (found)
        maps.push(perspective([...from, { x: size - 6.5, y: size - 6.5 }], [...to, found]));
    }
    maps.push(perspective([...from, { x: far, y: far }], [...to, along(right, down, 1)]));
    for (const map of maps) {
      if (!map) continue;
      const modules = Array.from({ length: size }, (_, y) =>
        Array.from({ length: size }, (_, x) => {
          const at = map(x + 0.5, y + 0.5);
          return isDark(bitmap, at.x, at.y);
        }),
      );
      const text = readModules(modules);
      if (text !== null) return text;
    }
  }
  return null;
}

/** Add the text of every code in `bitmap` to `texts`. */
function readBitmap(bitmap: Bitmap, texts: string[]) {
  const finders = findFinders(bitmap);
  const used = new Set<Finder>();
  let attempts = 0;
  for (let i = 0; i < finders.length; i++) {
    for (let j = i + 1; j < finders.length; j++) {
      for (let k = j + 1; k < finders.length; k++) {
        const three = [finders[i]!, finders[j]!, finders[k]!] as const;
        if (three.some((finder) => used.has(finder))) continue;
        const corners = arrange(...three);
        if (!corners) continue;
        if (attempts++ >= maxAttempts) return;
        const text = readCode(bitmap, ...corners);
        if (text === null) continue;
        for (const finder of three) used.add(finder);
        if (text && !texts.includes(text)) texts.push(text);
        if (texts.length >= maxCodes) return;
      }
    }
  }
}

/**
 * The text of every QR code in `gray`, one byte per pixel, row by row. It splits
 * the image into dark and light by one overall level, then, if no code turned
 * up, by the light around each pixel; dark codes on a light background come
 * first, and light codes on a dark one are read only when none are found. At
 * most `maxCodes` distinct texts, in the order found. Impossible dimensions
 * hold no codes. Its copies of the pixels are wiped once read.
 */
export function readQrCodes(gray: Uint8Array, width: number, height: number) {
  if (
    width === 0 ||
    height === 0 ||
    Math.max(width, height) > maxSide ||
    gray.length !== width * height
  )
    return [];
  const texts: string[] = [];
  const side = Math.max(width, height);
  const splits = [
    () => belowGlobalLevel(gray),
    () => belowLocalMean(gray, width, height, Math.max(7, Math.round(side / 16))),
    () => belowLocalMean(gray, width, height, Math.max(15, Math.round(side / 4))),
  ];
  for (const inverted of [false, true]) {
    for (const split of splits) {
      const dark = split();
      if (inverted) for (let i = 0; i < dark.length; i++) dark[i] = dark[i]! ^ 1;
      readBitmap({ dark, width, height }, texts);
      dark.fill(0);
      if (texts.length) return texts;
    }
  }
  return texts;
}
