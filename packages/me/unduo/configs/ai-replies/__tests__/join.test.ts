import { expect, test } from "vite-plus/test";
import { replyHash } from "#capture";
import { joinRows, rowDigests } from "#crop";

test("a row's digest depends on its bytes only", () => {
  const rows = rowDigests(Buffer.from([1, 2, 3, 1, 2, 3, 9, 9, 9]), 3);
  expect(rows).toHaveLength(3);
  expect(rows[0]).toBe(rows[1]);
  expect(rows[2]).not.toBe(rows[0]);
});

test("joins a conversation's end under its top without its bar or repeated rows", () => {
  // The site's bar (h) stays put; the end repeats the top's last rows (c, d).
  const top = ["h", "a", "b", "c", "d"];
  expect(joinRows(top, ["h", "c", "d", "e", "f"], 2)).toEqual({
    header: 1,
    overlap: 2,
    fits: false,
  });
  // Blank space at the seam matches anything blank: not proof they meet, so a gap goes between.
  const blank = ["_", "_", "_", "_"];
  expect(joinRows(["h", "a", "b", ...blank], ["h", ...blank, "e", "f"], 4)).toEqual({
    header: 1,
    overlap: 0,
    fits: false,
  });
  // Too few rows in common to trust: they don't meet, so a gap goes between.
  expect(joinRows(top, ["h", "d", "e", "f"], 2)).toEqual({ header: 1, overlap: 0, fits: false });
  // A reply short enough to show whole in the first screenshot adds nothing.
  expect(joinRows(top, top, 2)).toEqual({ header: 5, overlap: 0, fits: true });
  expect(joinRows(top, ["h", "c", "d"], 2)).toEqual({ header: 1, overlap: 2, fits: true });
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
