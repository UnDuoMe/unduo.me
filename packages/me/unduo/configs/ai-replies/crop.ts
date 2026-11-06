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

/** The darkest gray a row may hold and still count as blank space between lines. */
const blank = 235;

/**
 * The row to end the crop on, so it ends between paragraphs rather than through
 * a paragraph: the lowest band of blank rows above `limit` that is clearly
 * taller than the gap between lines, which is the bands' usual height, leaving
 * up to 10 points of it under the text. Rows count as blank across the middle,
 * without 40 points at each side, where a site may draw a frame. A band that
 * runs into `limit` doesn't count, since the text below it is cut. Falls back
 * to `limit`.
 */
export function blankRowAbove(
  gray: Buffer,
  width: number,
  limit: number,
  floor: number,
  scale: number,
) {
  const margin = Math.round(40 * scale);
  const bands: { start: number; height: number }[] = [];
  let run = 0;
  for (let y = floor; y < limit; y++) {
    const row = gray.subarray(y * width + margin, (y + 1) * width - margin);
    if (row.every((value) => value >= blank)) run++;
    else if (run) {
      bands.push({ start: y - run, height: run });
      run = 0;
    }
  }
  const heights = bands.map(({ height }) => height).sort((a, b) => a - b);
  const lineGap = heights[Math.floor(heights.length / 2)] ?? 0;
  const enough = Math.max(Math.round(6 * scale), Math.ceil(lineGap * 1.5));
  const band = bands.findLast(({ height }) => height >= enough);
  return band ? band.start + Math.min(Math.floor(band.height / 2), Math.round(10 * scale)) : limit;
}

/**
 * Crop a window screenshot to the conversation: below the browser's toolbar,
 * past the site's sidebar `left` points wide, and ending between paragraphs
 * above the bottom `bottom` points, where the site keeps its prompt box.
 */
export function cropToPage(
  raw: string,
  out: string,
  scale: number,
  { left, bottom }: { left: number; bottom: number },
) {
  const [width, height] = execFileSync("magick", ["identify", "-format", "%w %h", raw], {
    encoding: "utf8",
  })
    .split(" ")
    .map(Number) as [number, number];
  const top = pageTop(raw, scale);
  const x = Math.round(left * scale);
  const w = width - x;
  // Grayscale bytes of the page, one per pixel, a row of `w` after another.
  const gray = execFileSync(
    "magick",
    [
      raw,
      "-crop",
      `${w}x${height - top}+${x}+${top}`,
      "+repage",
      "-colorspace",
      "Gray",
      "-depth",
      "8",
      "gray:-",
    ],
    { maxBuffer: 1 << 28 },
  );
  const limit = height - top - Math.round(bottom * scale);
  const end = blankRowAbove(gray, w, limit, Math.round(limit / 2), scale);
  execFileSync("magick", [raw, "-crop", `${w}x${end}+${x}+${top}`, "+repage", out]);
}

/**
 * Save a cropped screenshot for the web: 1,400 pixels wide, enough to read
 * when it opens larger, as WebP.
 */
export function toWebp(png: string, webp: string) {
  execFileSync("magick", [
    png,
    "-resize",
    "1400x>",
    "-quality",
    "82",
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

/** How far apart two rows' means may be and still be the same row: text renders a little differently after a scroll. */
const sameRow = 0.5;

/**
 * How to join a screenshot of a conversation to the next one down, given each
 * row's mean gray: `header`, the rows both start with, which is the site's bar
 * that stays put as the page scrolls; and `overlap`, how many rows after that
 * repeat the bottom of the first, the overlap that matches best. `overlap` is
 * 0 when fewer than `minimum` rows match, or when the rows that match are too
 * alike to tell apart, as blank space is. `fits` is true when the next shows
 * nothing new.
 */
export function joinRows(top: number[], end: number[], minimum: number) {
  let header = 0;
  while (header < Math.min(top.length, end.length) && Math.abs(top[header]! - end[header]!) < 0.05)
    header++;
  const rest = end.slice(header);
  if (!rest.length) return { header, overlap: 0, fits: true };
  let best = { overlap: 0, difference: sameRow };
  for (let overlap = Math.min(top.length - header, rest.length); overlap >= minimum; overlap--) {
    const from = top.length - overlap;
    let sum = 0;
    for (let row = 0; row < overlap && sum < best.difference * overlap; row++)
      sum += Math.abs(top[from + row]! - rest[row]!);
    const difference = sum / overlap;
    if (difference >= best.difference) continue;
    // Only rows that differ from each other, such as lines of text, show where the two meet.
    const rows = rest.slice(0, overlap);
    const mean = rows.reduce((total, value) => total + value, 0) / overlap;
    const spread = Math.sqrt(
      rows.reduce((total, value) => total + (value - mean) ** 2, 0) / overlap,
    );
    if (spread >= 1) best = { overlap, difference };
  }
  return { header, overlap: best.overlap, fits: best.overlap === rest.length };
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
 * Join the cropped screenshot of a conversation so far, `top`, to the next one
 * down, `end`. The next loses the site's bar and any rows the top already
 * shows; if the two don't meet, a band of three dots marks the rows skipped
 * between them. When the next shows nothing new, the image is the top alone,
 * and `fits` is true.
 */
export function joinScreenshots(top: string, end: string, out: string, scale: number) {
  const [width] = size(top);
  const [endWidth, endHeight] = size(end);
  if (endWidth !== width) throw new Error("The screenshots aren't the same width.");
  const { header, overlap, fits } = joinRows(
    rowMeans(grayBytes(top), width),
    rowMeans(grayBytes(end), width),
    Math.round(24 * scale),
  );
  if (fits) {
    execFileSync("magick", [top, out]);
    return { fits };
  }
  const from = header + overlap;
  const rest = ["(", end, "-crop", `${width}x${endHeight - from}+0+${from}`, "+repage", ")"];
  const band = Math.round(28 * scale);
  const dot = (offset: number) => {
    const x = Math.round(width / 2 + offset * 10 * scale);
    return `circle ${x},${band / 2} ${x + Math.round(2.5 * scale)},${band / 2}`;
  };
  const gap = overlap
    ? []
    : [
        "(",
        "-size",
        `${width}x${band}`,
        "xc:#f1f5f9",
        "-fill",
        "#94a3b8",
        "-draw",
        `${dot(-1)} ${dot(0)} ${dot(1)}`,
        ")",
      ];
  execFileSync("magick", [top, ...gap, ...rest, "-append", out]);
  return { fits };
}
