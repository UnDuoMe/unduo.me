import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { zipFiles } from "#extension-zip";

const files = [
  { name: "manifest.json", data: Buffer.from('{"version":"1.0.0"}\n') },
  { name: "content.js", data: Buffer.from("console.log(1);\n") },
  { name: "icon-16.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 255]) },
];

test("the same files give the same zip, whatever their order", () => {
  expect(zipFiles(files).equals(zipFiles(files.toReversed()))).toBe(true);
});

test("unzip reads every file back intact, at the zip's root", () => {
  const path = join(mkdtempSync(join(tmpdir(), "unduo-zip-")), "test.zip");
  writeFileSync(path, zipFiles(files));
  expect(execFileSync("unzip", ["-Z1", path], { encoding: "utf8" }).trim().split("\n")).toEqual([
    "content.js",
    "icon-16.png",
    "manifest.json",
  ]);
  expect(execFileSync("unzip", ["-t", path], { encoding: "utf8" })).toContain("No errors detected");
  expect(execFileSync("unzip", ["-p", path, "manifest.json"], { encoding: "utf8" })).toBe(
    '{"version":"1.0.0"}\n',
  );
});
