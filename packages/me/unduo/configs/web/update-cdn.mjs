import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  cdnPackageName,
  installedPackage,
  installedVersion,
  integritySource,
  readCdnSource,
  template,
} from "#cdn-source";
import { validateStylesheet } from "#html-security";

const html = await readFile(template, "utf8");
const source = readCdnSource(html);
const resources = source.assets;
/** The URL at the installed version of its package. */
function current(previous) {
  const name = cdnPackageName(previous);
  const version = previous.split(`${name}@`)[1].split("/")[0];
  return previous.replace(`${name}@${version}/`, `${name}@${installedVersion(name)}/`);
}
const updates = await Promise.all(
  Object.entries(resources).map(async ([previous, { kind }]) => {
    const url = current(previous);
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (
      !response.ok ||
      response.url !== url ||
      kind !== "style" ||
      !response.headers.get("content-type")?.includes("text/css")
    )
      throw new Error(`Unexpected CDN response: ${url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const code = bytes.toString("utf8");
    validateStylesheet(code);
    const sha256 = createHash("sha256").update(bytes).digest("base64");
    const npm = integritySource(url);
    if (npm) {
      // The served file must be the installed npm file and match jsDelivr's listing.
      const installed = await readFile(join(installedPackage(npm.name).directory, npm.file));
      const listing = await fetch(npm.source, { signal: AbortSignal.timeout(30_000) });
      const listed = listing.ok
        ? (await listing.json()).files?.find((file) => file.name === npm.file)?.hash
        : undefined;
      if (!installed.equals(bytes) || listed !== sha256)
        throw new Error(`jsDelivr and the installed npm package disagree: ${url}`);
    }
    return {
      previous,
      url,
      // SHA-256 matches jsDelivr's listing, so auditors can compare it as a string.
      integrity: `sha256-${sha256}`,
      source: [integritySource(previous)?.source, npm?.source],
    };
  }),
);

let updated = html;
for (const {
  previous,
  url,
  integrity,
  source: [previousSource, nextSource],
} of updates) {
  updated = updated
    .replaceAll(previous, url)
    .replaceAll(source.assets[previous].integrity, integrity);
  if (previousSource && nextSource) updated = updated.replaceAll(previousSource, nextSource);
}
readCdnSource(updated);
await writeFile(template, updated);
console.log(
  `Review ${updates.length} version-pinned CDN resources and SHA-256 hashes in src/cdn-resources.html.`,
);
