import { expect, test } from "vite-plus/test";
import { replyHash } from "#capture";
import { joinRows, rowMeans } from "#crop";

test("a row's mean is its average gray", () => {
  expect(rowMeans(Buffer.from([0, 255, 100, 100, 9, 9]), 2)).toEqual([127.5, 100, 9]);
});

test("joins a conversation's next screenshot under the last, without its bar or repeated rows", () => {
  // The site's bar (rows of 50) stays put; text rows differ from each other.
  const bar = [50, 50];
  const top = [...bar, 200, 180, 220, 190, 210, 170];
  // The next repeats the top's last four rows, give or take how text renders after a scroll.
  expect(joinRows(top, [...bar, 180.2, 220, 189.9, 210, 170.1, 160, 230], 3)).toEqual({
    header: 2,
    overlap: 5,
    fits: false,
  });
  // Nothing in common: they don't meet, so a gap goes between.
  expect(joinRows(top, [...bar, 120, 140, 130, 150], 3)).toEqual({
    header: 2,
    overlap: 0,
    fits: false,
  });
  // Blank space at the seam matches anything blank: not proof they meet.
  const blank = [255, 255, 255, 255];
  expect(joinRows([...bar, 200, 180, ...blank], [...bar, ...blank, 120, 140], 3)).toEqual({
    header: 2,
    overlap: 0,
    fits: false,
  });
  // A page that didn't scroll shows nothing new.
  expect(joinRows(top, top, 3)).toEqual({ header: 8, overlap: 0, fits: true });
  expect(joinRows(top, [...bar, 190, 210, 170], 3)).toEqual({ header: 2, overlap: 3, fits: true });
});

test("finds the reply's last SHA-256 and checks it against the file's", () => {
  const sha256 = "ab".repeat(32);
  expect(replyHash(`Safe: yes.\n\nSHA-256: ${sha256.toUpperCase()}`, sha256)).toEqual({
    found: sha256,
    matches: true,
  });
  expect(replyHash(`An example: ${"cd".repeat(32)}. This file: ${sha256}`, sha256).matches).toBe(
    true,
  );
  expect(replyHash(`SHA-256: ${"ef".repeat(32)}`, sha256)).toEqual({
    found: "ef".repeat(32),
    matches: false,
  });
  expect(replyHash("Safe: yes.", sha256)).toEqual({ found: undefined, matches: false });
  expect(replyHash(undefined, sha256).matches).toBe(false);
});
