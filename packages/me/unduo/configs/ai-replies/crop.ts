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
