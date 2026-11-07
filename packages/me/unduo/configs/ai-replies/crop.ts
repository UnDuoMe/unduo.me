import { execFileSync } from "node:child_process";

/**
 * The first row of the page in a Chrome window screenshot: the row under the
 * 1-pixel line that ends the browser's toolbar, found down the window's left
 * edge, between 60 and 120 points from the top. Falls back to 87 points, where
 * it sits without a bookmarks bar.
 */
export function pageTop(png: string, scale: number) {
  const from = Math.round(60 * scale);
  const rows = execFileSync(
    "magick",
    [
      png,
      "-crop",
      `1x${Math.round(60 * scale)}+${Math.round(8 * scale)}+${from}`,
      "+repage",
      "-depth",
      "8",
      "txt:-",
    ],
    { encoding: "utf8" },
  )
    .split("\n")
    .flatMap((line) => {
      const match = /^0,(\d+): \((\d+),(\d+),(\d+)/.exec(line);
      return match ? [{ y: from + Number(match[1]), rgb: match.slice(2, 5).map(Number) }] : [];
    });
  const line = rows.find(({ rgb: [r, g, b] }, index) => {
    const before = rows[index - 1]?.rgb;
    const gray = Math.max(r!, g!, b!) - Math.min(r!, g!, b!) <= 6 && r! >= 200 && r! <= 232;
    return gray && before && before.join() !== [r, g, b].join();
  });
  return line ? line.y + 1 : Math.round(87 * scale);
}

/**
 * Crop a window screenshot to the page under the browser's toolbar, without
 * `left` and `bottom` points along its edges.
 */
export function cropToPage(
  raw: string,
  out: string,
  scale: number,
  { left, bottom }: { left: number; bottom: number },
) {
  const [width, height] = size(raw);
  const top = pageTop(raw, scale);
  const x = Math.round(left * scale);
  const h = height - top - Math.round(bottom * scale);
  execFileSync("magick", [raw, "-crop", `${width - x}x${h}+${x}+${top}`, "+repage", out]);
}

/**
 * Save a cropped screenshot for the web as lossless WebP, at most 1,400 pixels
 * wide: a zoomed-out conversation's text is small, and lossy compression would
 * blur it.
 */
export function toWebp(png: string, webp: string) {
  execFileSync("magick", [
    png,
    "-resize",
    "1400x>",
    "-define",
    "webp:lossless=true",
    "-define",
    "webp:method=6",
    webp,
  ]);
}

/** Each row of a grayscale image `width` bytes wide, as its mean gray value. */
export function rowMeans(gray: Buffer, width: number) {
  const rows: number[] = [];
  for (let y = 0; y * width < gray.length; y++) {
    let sum = 0;
    for (let x = y * width; x < (y + 1) * width; x++) sum += gray[x]!;
    rows.push(sum / width);
  }
  return rows;
}

/**
 * Whether two screenshots' rows, as their mean gray, show the same page: at
 * most 1% of rows differ by more than one gray level, as a text caret
 * blinking does. A scroll of even a few points moves every line of text, which
 * changes far more rows.
 */
export function sameRows(a: number[], b: number[]) {
  if (a.length !== b.length) return false;
  const differing = a.filter((value, row) => Math.abs(value - b[row]!) > 1).length;
  return differing <= a.length / 100;
}

const spread = (rows: number[]) => Math.max(...rows) - Math.min(...rows);
/**
 * Whether rows hold no text or lines: each is within 0.75 gray levels of the
 * one before. A background that shades off, as Gemini's does, changes slowly.
 */
const blankRows = (rows: number[]) =>
  rows.every((value, row) => row === 0 || Math.abs(value - rows[row - 1]!) < 0.75);

/**
 * Whether a screenshot of a page scrolled to its top, `top`, shows all of it,
 * given one scrolled to its end, `end`, as rows of mean gray: the scroll moved
 * nothing, or it moved the page and brought in only blank space (`blankRows`),
 * as a site's padding under the last message does. Rows both start and end with are the
 * site's bars, which don't scroll. The page moved by the shift whose rows
 * differ least, if they differ by under 3 gray levels on average and by half
 * as much as at any shift a few rows away; rows too alike to tell apart, as
 * blank space is, never count as a match.
 */
export function showsAll(top: number[], end: number[]) {
  if (sameRows(top, end)) return true;
  if (top.length !== end.length) return false;
  const still = (row: number) => Math.abs(top[row]! - end[row]!) < 0.5;
  let header = 0;
  while (header < top.length && still(header)) header++;
  let footer = top.length;
  while (footer > header && still(footer - 1)) footer--;
  const before = top.slice(header, footer);
  const after = end.slice(header, footer);
  const candidates: { shift: number; difference: number }[] = [];
  for (let shift = 1; shift < before.length; shift++) {
    const overlap = before.length - shift;
    if (spread(after.slice(0, overlap)) < 1 || spread(before.slice(shift)) < 1) continue;
    let sum = 0;
    for (let row = 0; row < overlap; row++) sum += Math.abs(after[row]! - before[row + shift]!);
    candidates.push({ shift, difference: sum / overlap });
  }
  const best = candidates.reduce<(typeof candidates)[number] | undefined>(
    (found, candidate) => (!found || candidate.difference < found.difference ? candidate : found),
    undefined,
  );
  if (!best || best.difference >= 3) return false;
  const others = candidates.filter(({ shift }) => Math.abs(shift - best.shift) > 3);
  if (others.some(({ difference }) => difference < best.difference * 2)) return false;
  // What the scroll brought in under what the top already showed.
  return blankRows(after.slice(before.length - best.shift));
}

/** An image's width and height in pixels. */
function size(png: string) {
  return execFileSync("magick", ["identify", "-format", "%w %h", png], { encoding: "utf8" })
    .split(" ")
    .map(Number) as [number, number];
}

/** An image's pixels, one gray byte each, row after row. */
function grayBytes(png: string) {
  return execFileSync("magick", [png, "-colorspace", "Gray", "-depth", "8", "gray:-"], {
    maxBuffer: 1 << 28,
  });
}

/**
 * Whether a window screenshot of a page at its top shows all of the page,
 * given one at its end: see `showsAll`. Only rows under the browser's toolbar count.
 */
export function showsWholePage(top: string, end: string, scale: number) {
  const [width, height] = size(top);
  const [otherWidth, otherHeight] = size(end);
  if (width !== otherWidth || height !== otherHeight) return false;
  const toolbar = pageTop(top, scale);
  return showsAll(
    rowMeans(grayBytes(top), width).slice(toolbar),
    rowMeans(grayBytes(end), width).slice(toolbar),
  );
}
