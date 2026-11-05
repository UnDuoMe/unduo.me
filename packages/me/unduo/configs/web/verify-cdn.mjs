import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { webOutput } from "#web-paths";

/**
 * Check every CDN resource in the generated pages against two sources outside
 * this repository: jsDelivr's file listing, and the npm registry's tarball or
 * GitHub's copy of the commit. A script element with data-upstream must hold that
 * published file byte for byte. Only the HTML is trusted for what to check. This
 * script shares no code with the build so that a bug there cannot hide here.
 *
 * Usage: node verify-cdn.mjs [page.html ...]   (default: every page in www/)
 */
const pages = process.argv.slice(2);
if (!pages.length) {
  for (const entry of await readdir(webOutput, { recursive: true })) {
    if (entry.endsWith(".html")) pages.push(new URL(entry, webOutput));
  }
}

const NPM =
  /^https:\/\/data\.jsdelivr\.com\/v1\/packages\/npm\/((?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*)@([\w.+-]+)\?structure=flat$/;
const GITHUB =
  /^https:\/\/data\.jsdelivr\.com\/v1\/packages\/gh\/([\w.-]+\/[\w.-]+)@([0-9a-f]{40})\?structure=flat$/;
const attr = (attrs, name) =>
  attrs.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]?.replaceAll("&amp;", "&");
const hash = (algorithm, bytes) => createHash(algorithm).update(bytes).digest("base64");

async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok || response.url !== url) throw new Error(`HTTP ${response.status} from ${url}`);
  return response;
}

/** Read one file out of an npm tarball (gzip-compressed ustar, with pax paths). */
function untar(tgz, path) {
  const tar = gunzipSync(tgz);
  let paxPath;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const text = (start, length) => {
      const field = header.subarray(start, start + length);
      const end = field.indexOf(0);
      return field.subarray(0, end < 0 ? length : end).toString("utf8");
    };
    const size = Number.parseInt(text(124, 12).trim() || "0", 8);
    const type = text(156, 1);
    const prefix = text(345, 155);
    const name = paxPath ?? (prefix ? `${prefix}/${text(0, 100)}` : text(0, 100));
    const body = tar.subarray(offset + 512, offset + 512 + size);
    paxPath = undefined;
    if (type === "x") paxPath = body.toString("utf8").match(/^\d+ path=(.*)$/m)?.[1];
    // npm packs every file under one top-level directory, normally `package/`.
    else if ((type === "0" || type === "") && name.replace(/^[^/]+/, "") === path) return body;
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`${path} is not in the npm tarball`);
}

/** The file as the npm registry publishes it, after checking the tarball's SHA-512. */
async function npmFile(name, version, file) {
  const metadata = await (await get(`https://registry.npmjs.org/${name}/${version}`)).json();
  const [algorithm, expected] = metadata.dist?.integrity?.split("-") ?? [];
  if (algorithm !== "sha512") throw new Error("The npm registry gives no SHA-512 integrity");
  const tarball = Buffer.from(await (await get(metadata.dist.tarball)).arrayBuffer());
  if (hash("sha512", tarball) !== expected) throw new Error("npm tarball SHA-512 differs");
  return untar(tarball, file);
}

/** The file as GitHub stores it in the commit. */
async function githubFile(repository, commit, file) {
  const response = await get(`https://raw.githubusercontent.com/${repository}/${commit}${file}`);
  return Buffer.from(await response.arrayBuffer());
}

async function verify({ url, source, file, integrity }) {
  const npm = source.match(NPM);
  const github = source.match(GITHUB);
  const [cdn, original, label] = npm
    ? [`npm/${npm[1]}@${npm[2]}`, () => npmFile(npm[1], npm[2], file), "the npm tarball"]
    : github
      ? [`gh/${github[1]}@${github[2]}`, () => githubFile(github[1], github[2], file), "GitHub"]
      : [];
  if (!cdn) throw new Error(`Unsupported integrity source: ${source}`);
  if (url !== `https://cdn.jsdelivr.net/${cdn}${file}`)
    throw new Error(`The URL does not name ${cdn}${file}`);

  const [listing, bytes, published] = await Promise.all([
    get(source).then((response) => response.json()),
    get(url).then(async (response) => Buffer.from(await response.arrayBuffer())),
    original(),
  ]);

  // 1. The hash the browser enforces must be jsDelivr's listed SHA-256.
  const listed = listing.files?.find((entry) => entry.name === file);
  if (!listed) throw new Error(`jsDelivr does not list ${file}`);
  if (integrity !== `sha256-${listed.hash}`)
    throw new Error("The pinned hash differs from jsDelivr's");

  // 2. The served bytes must match it.
  if (hash("sha256", bytes) !== listed.hash) throw new Error("The served file differs");

  // 3. The npm registry or GitHub, which jsDelivr copies, holds the same file.
  if (!published.equals(bytes)) throw new Error(`The file differs from ${label}'s`);

  return `PASS ${cdn}${file}: the pin, jsDelivr's SHA-256 and ${label} agree`;
}

const resources = new Map();
const unverified = new Set();
/** Script elements that hold a published file: each URL's distinct bodies and named hashes. */
const copies = new Map();
for (const page of pages) {
  const html = await readFile(page, "utf8");
  for (const [, attrs, code] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const upstream = attr(attrs, "data-upstream");
    if (!upstream) continue;
    const sha256 = attr(attrs, "data-upstream-sha256");
    if (!copies.has(upstream)) copies.set(upstream, new Map());
    copies.get(upstream).set(code, sha256);
  }
  for (const [, tag, attrs] of html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)) {
    const url = attr(attrs, "src") ?? attr(attrs, "href") ?? attr(attrs, "data-plugin-url");
    const source = attr(attrs, "data-integrity-source");
    if (!source) {
      if (/^(?:script|link)$/i.test(tag) && url?.startsWith("https:")) unverified.add(url);
      continue;
    }
    const resource = {
      url,
      source,
      file: attr(attrs, "data-integrity-file") ?? "",
      integrity: attr(attrs, "integrity") ?? attr(attrs, "data-plugin-integrity"),
    };
    const key = JSON.stringify(resource);
    if (!resources.has(key)) resources.set(key, resource);
  }
}

let failed = 0;
const checked = [...resources.values()];
const results = await Promise.allSettled(checked.map(verify));
results.forEach((result, index) => {
  if (result.status === "fulfilled") {
    console.log(result.value);
  } else {
    failed++;
    console.error(`FAIL ${checked[index].url}: ${result.reason.message}`);
  }
});
for (const url of unverified) {
  failed++;
  console.error(`FAIL ${url}: no data-integrity-source`);
}
if (!checked.length) {
  failed++;
  console.error("FAIL: no CDN resource names an integrity source");
}
// Each element that says it holds a published file must hold that file, byte for byte.
for (const [url, bodies] of copies) {
  const published = Buffer.from(await (await get(url)).arrayBuffer());
  const digest = createHash("sha256").update(published).digest("hex");
  const differs = [...bodies].some(
    ([code, sha256]) => !Buffer.from(code).equals(published) || sha256 !== digest,
  );
  if (differs) {
    failed++;
    console.error(`FAIL ${url}: a script element differs from the published file`);
  } else console.log(`PASS ${url}: every script element that names it holds it, byte for byte`);
}
if (!copies.size) {
  failed++;
  console.error("FAIL: no script element names a published file");
}
process.exitCode = failed ? 1 : 0;
