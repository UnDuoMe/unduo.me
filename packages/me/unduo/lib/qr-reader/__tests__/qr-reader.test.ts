import { encodeQR } from "@-/com.npmjs.qr";
import { expect, test } from "vite-plus/test";
import { maxCodes, maxSide, readQrCodes } from "@-/me.unduo.lib.qr-reader";

type Picture = { gray: Uint8Array; width: number; height: number };
type Level = "low" | "medium" | "quartile" | "high";

const levels: Level[] = ["low", "medium", "quartile", "high"];
const link = "https://m-abcd1234.duosecurity.com/activate/ABCDEFGHIJKLMNOPQRST";
const value = "duo://ABCDEFGHIJKLMNOPQRST-YXBpLWFiY2QxMjM0LmR1b3NlY3VyaXR5LmNvbQ";

const read = ({ gray, width, height }: Picture) => readQrCodes(gray, width, height);

/** The modules of `text` with no border: the encoder insists on one, so it's cut off. */
function raw(text: string, options: Parameters<typeof encodeQR>[2] = {}) {
  const modules = encodeQR(text, "raw", { ...options, border: 1 });
  return modules.slice(1, -1).map((line) => line.slice(1, -1));
}

/** `modules` in gray pixels, `scale` to a module, with a light border of `border` modules. */
function draw(modules: boolean[][], scale = 4, border = 4): Picture {
  const width = (modules.length + border * 2) * scale;
  const gray = new Uint8Array(width * width).fill(255);
  for (let y = 0; y < width; y++)
    for (let x = 0; x < width; x++)
      if (modules[Math.floor(y / scale) - border]?.[Math.floor(x / scale) - border])
        gray[y * width + x] = 0;
  return { gray, width, height: width };
}

const code = (text: string, scale = 4, level: Level = "medium") =>
  draw(raw(text, { ecc: level }), scale);

/** Pictures side by side on a light background. */
function row(pictures: Picture[], gap = 40, background = 255): Picture {
  const width = pictures.reduce((sum, picture) => sum + picture.width + gap, gap);
  const height = Math.max(...pictures.map((picture) => picture.height)) + gap * 2;
  const gray = new Uint8Array(width * height).fill(background);
  let left = gap;
  for (const picture of pictures) {
    for (let y = 0; y < picture.height; y++)
      gray.set(
        picture.gray.subarray(y * picture.width, (y + 1) * picture.width),
        (y + gap) * width + left,
      );
    left += picture.width + gap;
  }
  return { gray, width, height };
}

/** The picture redrawn at `width` by `height`, each new pixel the mean of samples taken through `source`. */
function warp(
  picture: Picture,
  width: number,
  height: number,
  source: (x: number, y: number) => [number, number],
): Picture {
  const gray = new Uint8Array(width * height);
  const samples = 3;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const [fromX, fromY] = source(x + (sx + 0.5) / samples, y + (sy + 0.5) / samples);
          const [ix, iy] = [Math.floor(fromX), Math.floor(fromY)];
          sum +=
            ix >= 0 && iy >= 0 && ix < picture.width && iy < picture.height
              ? picture.gray[iy * picture.width + ix]!
              : 255;
        }
      }
      gray[y * width + x] = sum / (samples * samples);
    }
  }
  return { gray, width, height };
}

const resize = (picture: Picture, factor: number) =>
  warp(picture, Math.round(picture.width * factor), Math.round(picture.height * factor), (x, y) => [
    x / factor,
    y / factor,
  ]);

function rotate(picture: Picture, degrees: number) {
  const [cos, sin] = [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)];
  const side = Math.ceil(Math.hypot(picture.width, picture.height));
  const [middle, centreX, centreY] = [side / 2, picture.width / 2, picture.height / 2];
  return warp(picture, side, side, (x, y) => [
    centreX + (x - middle) * cos + (y - middle) * sin,
    centreY - (x - middle) * sin + (y - middle) * cos,
  ]);
}

/** As if photographed from one side: the far edge `strength` times as small. */
function tilt(picture: Picture, strength: number) {
  const { width, height } = picture;
  return warp(picture, width, height, (x, y) => {
    const depth = 1 + (strength * x) / width;
    return [x * depth - (strength * width) / 2, (y - height / 2) * depth + height / 2];
  });
}

function blur({ gray, width, height }: Picture, radius: number): Picture {
  const out = new Uint8Array(gray.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let [sum, count] = [0, 0];
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const [px, py] = [x + dx, y + dy];
          if (px < 0 || py < 0 || px >= width || py >= height) continue;
          sum += gray[py * width + px]!;
          count++;
        }
      }
      out[y * width + x] = sum / count;
    }
  }
  return { gray: out, width, height };
}

/** A repeatable random number between 0 and 1. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const noise = ({ gray, width, height }: Picture, amount: number): Picture => {
  const next = random(7);
  return {
    gray: gray.map((pixel) => Math.max(0, Math.min(255, pixel + (next() - 0.5) * amount))),
    width,
    height,
  };
};

const swap = ({ gray, width, height }: Picture) => ({
  gray: gray.map((pixel) => 255 - pixel),
  width,
  height,
});

/** Light falling from one corner to the other, darkening it to a `floor` fraction. */
const shade = ({ gray, width, height }: Picture, floor: number): Picture => ({
  gray: gray.map((pixel, i) => {
    const [x, y] = [i % width, Math.floor(i / width)];
    return pixel * (1 - (1 - floor) * ((x / width + y / height) / 2));
  }),
  width,
  height,
});

/** Pixels squeezed between `low` and `high`. */
const squeeze = ({ gray, width, height }: Picture, low: number, high: number): Picture => ({
  gray: gray.map((pixel) => low + (pixel * (high - low)) / 255),
  width,
  height,
});

/** Up to `count` modules flipped outside the corner patterns, as a smudge or a logo would. */
function damage(modules: boolean[][], count: number) {
  const next = random(11);
  const size = modules.length;
  const copy = modules.map((line) => [...line]);
  for (let i = 0; i < count;) {
    const [x, y] = [Math.floor(next() * size), Math.floor(next() * size)];
    if ((x < 9 && y < 9) || (x >= size - 9 && y < 9) || (x < 9 && y >= size - 9)) continue;
    copy[y]![x] = !copy[y]![x];
    i++;
  }
  return copy;
}

/** Text of `length` characters; the last digits tell tests apart in a failure message. */
const textOf = (length: number) =>
  Array.from(
    { length },
    (_, i) => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"[i % 52],
  ).join("");

/** The longest text in byte mode that fits a version at a level. */
function longest(version: number, level: Level) {
  let [low, high] = [1, 3000];
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    try {
      raw(textOf(middle), { version, ecc: level, encoding: "byte" });
      low = middle;
    } catch {
      high = middle - 1;
    }
  }
  return low;
}

test.each(levels)("reads every version at its full capacity, level %s", (level) => {
  for (let version = 1; version <= 40; version++) {
    const text = textOf(longest(version, level));
    const modules = raw(text, { version, ecc: level, encoding: "byte" });
    expect([version, read(draw(modules, 2))]).toEqual([version, [text]]);
  }
});

test("reads every mask", () => {
  for (const mask of [0, 1, 2, 3, 4, 5, 6, 7] as const) {
    const modules = raw(link, { mask });
    expect(read(draw(modules))).toEqual([link]);
  }
});

test("reads numeric, alphanumeric, byte and UTF-8 text", () => {
  for (const [text, encoding] of [
    ["1", "numeric"],
    ["12", "numeric"],
    ["123", "numeric"],
    ["0012345678901234", "numeric"],
    ["A", "alphanumeric"],
    ["HTTPS://EXAMPLE.COM/$%*+-./:", "alphanumeric"],
    ["duo://code", "byte"],
    ["héllo wörld ✓", "byte"],
  ] as const)
    expect(read(draw(raw(text, { encoding })))).toEqual([text]);
});

test.each([1, 2, 3, 4, 7, 13])("reads a code at %i pixels to a module", (scale) => {
  expect(read(code(value, scale))).toEqual([value]);
});

test.each([0.8, 1.37, 1.5, 2.5, 3.3, 4.71])("reads a resized code at %f times", (factor) => {
  expect(read(resize(code(link, 4), factor))).toEqual([link]);
});

test.each([90, 180, 270, 5, 17, 30, 45, 60, 133, 222, 315])(
  "reads a code turned %i degrees",
  (turn) => {
    expect(read(rotate(code(link, 4), turn))).toEqual([link]);
  },
);

test.each([0.05, 0.1, 0.2])("reads a tilted code, strength %f", (strength) => {
  expect(read(tilt(code(link, 8), strength))).toEqual([link]);
});

test.each([1, 2])("reads a blurred code, radius %i", (radius) => {
  expect(read(blur(code(link, 6), radius))).toEqual([link]);
});

test.each([40, 80, 140])("reads a noisy code, amount %i", (amount) => {
  expect(read(noise(code(link, 4), amount))).toEqual([link]);
});

test("reads a code in uneven light, as in a photo", () => {
  expect(read(shade(code(link, 8), 0.35))).toEqual([link]);
  expect(read(noise(shade(blur(tilt(code(link, 8), 0.1), 1), 0.4), 30))).toEqual([link]);
});

test("reads a faint code", () => {
  expect(read(squeeze(code(link, 4), 90, 170))).toEqual([link]);
  expect(read(squeeze(code(link, 4), 200, 250))).toEqual([link]);
});

test("reads a light code on a dark page and a light code on its own tile", () => {
  expect(read(swap(code(link)))).toEqual([link]);
  expect(read(row([code(link)], 80, 24))).toEqual([link]);
});

test("corrects damage up to what its level allows", () => {
  const modules = raw(link, { ecc: "high" });
  expect(read(draw(damage(modules, Math.floor(modules.length * 1.2))))).toEqual([link]);
});

test("reads several codes in one picture, of different sizes", () => {
  const pictures = [
    code("https://example.com/a", 3),
    code(link, 4),
    code("https://example.com/b", 2),
  ];
  expect(read(row(pictures)).sort()).toEqual(
    [link, "https://example.com/a", "https://example.com/b"].sort(),
  );
});

test("returns at most maxCodes distinct texts", () => {
  const pictures = Array.from({ length: 18 }, (_, i) => code(`https://example.com/${i}`, 2));
  const texts = read(row(pictures, 16));
  expect(texts.length).toBe(maxCodes);
  expect(new Set(texts).size).toBe(maxCodes);
  const same = read(row([code(link, 3), code(link, 3)]));
  expect(same).toEqual([link]);
});

test("reads nothing from blank, random or impossible images", () => {
  expect(readQrCodes(new Uint8Array(100 * 100).fill(255), 100, 100)).toEqual([]);
  expect(readQrCodes(new Uint8Array(100 * 100), 100, 100)).toEqual([]);
  const next = random(3);
  const static_ = new Uint8Array(300 * 300).map(() => next() * 255);
  expect(readQrCodes(static_, 300, 300)).toEqual([]);
  expect(readQrCodes(new Uint8Array(4), 0, 1)).toEqual([]);
  expect(readQrCodes(new Uint8Array(4), 10, 10)).toEqual([]);
  expect(readQrCodes(new Uint8Array(maxSide + 1), maxSide + 1, 1)).toEqual([]);
});

test("reads nothing from a code damaged past repair", () => {
  const modules = raw(link, { ecc: "low" });
  expect(read(draw(damage(modules, modules.length ** 2 / 2)))).toEqual([]);
});

test("gets through a full-size screen frame with no code quickly", () => {
  const next = random(5);
  const frame = new Uint8Array(1920 * 1080);
  // Bands and speckle like a page of text, the worst case for finding patterns.
  for (let i = 0; i < frame.length; i++) frame[i] = (i >> 3) % 3 && next() > 0.6 ? 40 : 235;
  const start = performance.now();
  expect(readQrCodes(frame, 1920, 1080)).toEqual([]);
  expect(performance.now() - start).toBeLessThan(2000);
});
