import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { repoRoot, webRoot } from "#web-paths";

export const template = new URL("src/cdn-resources.html", webRoot);

/** The installed package's directory and version, as resolved by its npm wrapper. */
export function installedPackage(name) {
  const wrapper = name.replace(/^@/, "").replace("/", "__");
  const require = createRequire(new URL(`packages/com/npmjs/${wrapper}/package.json`, repoRoot));
  let directory = dirname(require.resolve(name));
  while (true) {
    try {
      const metadata = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
      if (metadata.name === name) return { directory, version: metadata.version };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Cannot locate installed package ${name}`);
    directory = parent;
  }
}

export function installedVersion(name) {
  return installedPackage(name).version;
}

/**
 * jsDelivr serves npm files unchanged and lists each file's Base64 SHA-256 in its
 * data API. Tags for such files name that listing, and their SHA-256 SRI hash is
 * the listed hash, so an auditor can check them against a party other than unduo.
 * @param {string} url
 */
export function integritySource(url) {
  const match = url.match(
    /^https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^/@]+)@([^/]+)(\/[^?#]+)$/,
  );
  if (!match) return;
  const [, name, version, file] = match;
  const source = `https://data.jsdelivr.com/v1/packages/npm/${name}@${version}?structure=flat`;
  return { name, version, file, source };
}

/**
 * jsDelivr lists GitHub commits the same way, so unduo's own published assets
 * name the listing of their content-addressed commit.
 * @param {string} url
 */
export function assetIntegritySource(url) {
  const match = url.match(
    /^https:\/\/cdn\.jsdelivr\.net\/gh\/([\w.-]+\/[\w.-]+)@([0-9a-f]{40})(\/[\w.-]+)$/,
  );
  if (!match) return;
  const [, repository, commit, file] = match;
  const source = `https://data.jsdelivr.com/v1/packages/gh/${repository}@${commit}?structure=flat`;
  return { file, source };
}

export function packageName(specifier) {
  return specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/");
}

export function cdnPackageName(url) {
  const parsed = new URL(url);
  // Only jsDelivr's npm files are served exactly as published.
  if (parsed.origin !== "https://cdn.jsdelivr.net") {
    throw new Error(`Unexpected package CDN: ${url}`);
  }
  const name = parsed.pathname.match(
    /^\/npm\/((?:@[^/]+\/)?[^/@]+)@\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?\//,
  )?.[1];
  if (!name) throw new Error(`CDN assets require an exact package version: ${url}`);
  return name;
}

/**
 * The source HTML is the reviewed list of CDN stylesheets and their hashes.
 * The page runs only its own inline scripts, so the template loads none.
 * @returns {{ assets: Record<string, { kind: "style", integrity: string }> }}
 */
export function readCdnSource(html = readFileSync(template, "utf8")) {
  if (/<script\b/i.test(html))
    throw new Error("The page runs only its own inline scripts; load no scripts from a CDN.");
  const assets = {};
  const comments = new Set();
  for (const [, attrs] of html.matchAll(/<link\b([^>]*)>/g)) {
    const url = attrs.match(/\bhref="(https:[^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
    if (!url) continue;
    const hash = attrs.match(/\bintegrity="([^"]+)"/)?.[1];
    if (
      !/^sha256-[A-Za-z0-9+/]{43}=$/.test(hash ?? "") ||
      !attrs.includes('crossorigin="anonymous"')
    ) {
      throw new Error(`CDN resources require SHA-256 SRI and anonymous CORS: ${url}`);
    }
    const npm = integritySource(url);
    if (
      !npm ||
      !attrs.includes(` data-integrity-source="${npm.source}"`) ||
      !attrs.includes(` data-integrity-file="${npm.file}"`)
    ) {
      throw new Error(
        `Add data-integrity-source="${npm?.source}" and data-integrity-file="${npm?.file}": ${url}`,
      );
    }
    // Says how the two attributes above relate to integrity.
    const comment = attrs.match(/\sdata-comment="([^"]+)"/)?.[1];
    if (!comment) throw new Error(`Add the shared verification data-comment: ${url}`);
    comments.add(comment);
    assets[url] = { kind: "style", integrity: hash };
  }
  if (comments.size > 1) throw new Error("CDN tags must share one data-comment.");
  return { assets };
}
