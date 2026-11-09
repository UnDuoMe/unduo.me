import { expect, test } from "vite-plus/test";
import { rowMeans, sameRows, showsAll } from "#crop";

test("a row's mean is its average gray", () => {
  expect(rowMeans(Buffer.from([0, 255, 100, 100, 9, 9]), 2)).toEqual([127.5, 100, 9]);
});

test("tells a page that didn't move from one that scrolled", () => {
  const page = Array.from({ length: 300 }, (_, row) => (row % 7 < 3 ? 250 : 120 + (row % 5)));
  // A blinking caret changes a row or two a little.
  const caret = page.map((value, row) => (row === 40 ? value - 1.5 : value));
  expect(sameRows(page, caret)).toBe(true);
  // A scroll of a single row moves every line of text.
  expect(sameRows(page, [...page.slice(1), 250])).toBe(false);
  expect(sameRows(page, page.slice(1))).toBe(false);
});

test("a page shows all of itself when a scroll brings in only blank space", () => {
  const bar = [40, 40, 40];
  const text = [200, 130, 210, 120, 220, 140, 190, 125, 215, 135, 205, 128];
  const blank = (rows: number) => Array.from({ length: rows }, (_, row) => 245 - row * 0.1);
  // The site's bars stay put; the page between them moves up by four rows.
  const top = [...bar, ...blank(4), ...text, ...blank(10), ...bar];
  const padded = [...bar, ...text, ...blank(14), ...bar];
  expect(showsAll(top, top)).toBe(true);
  expect(showsAll(top, padded)).toBe(true);
  // The scroll brings in more of the reply.
  const more = [...bar, ...text, ...blank(6), 100, 230, 110, 240, 120, 235, 115, 225, ...bar];
  expect(
    showsAll([...bar, ...blank(4), ...text, ...blank(6), 100, 230, 110, 240, ...bar], more),
  ).toBe(false);
});
