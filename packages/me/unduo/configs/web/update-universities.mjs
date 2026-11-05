import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { repoRoot } from "#web-paths";

// This is the complete WHED catalog, including entries not matched to Wikidata.
const source =
  "https://mix-n-match.toolforge.org/api/download2?catalogs=7299&columns=%7B%22exturl%22%3A1%2C%22username%22%3A0%2C%22aux%22%3A1%2C%22dates%22%3A0%2C%22location%22%3A0%2C%22multimatch%22%3A0%7D&format=json&as_file=1";
const response = await fetch(source);
if (!response.ok) throw new Error(`WHED catalog download failed: ${response.status}`);
const text = await response.text();
const records = JSON.parse(text);
if (!Array.isArray(records) || records.length < 20_000)
  throw new Error("Incomplete WHED catalog export.");
const ids = new Set();
const directory = records
  .map(({ external_id: id, name, description }) => {
    if (
      !/^IAU-\d{6}(?:-\d{6})*$/.test(id) ||
      ids.has(id) ||
      typeof name !== "string" ||
      !description
    )
      throw new Error(`Invalid or duplicate WHED record: ${id}`);
    ids.add(id);
    return [id, name, description];
  })
  .sort(([a], [b]) => a.localeCompare(b));
const output = new URL("packages/me/unduo/data/universities/", repoRoot);
await writeFile(new URL("whed-directory.json", output), JSON.stringify(directory, null, 2) + "\n");
await writeFile(
  new URL("whed-source.json", output),
  JSON.stringify(
    {
      catalog: "https://mix-n-match.toolforge.org/#/catalog/7299",
      property: "https://www.wikidata.org/wiki/Property:P13470",
      exportUrl: source,
      retrievedAt: new Date().toISOString().slice(0, 10),
      records: directory.length,
      sha256: createHash("sha256").update(text).digest("hex"),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Updated ${directory.length} WHED institutions. Review the directory diff before building.`,
);
