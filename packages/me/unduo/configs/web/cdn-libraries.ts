import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import {
  cdnPackageName,
  installedPackage,
  installedVersion,
  integritySource,
  readCdnSource,
} from "#cdn-source";

/** The one npm file the page's script may contain, unminified: VanJS, pinned in the root catalog. */
const pageLibrary = /\/node_modules\/vanjs-core\/src\/van\.js$/;

/**
 * The page runs only code it contains: the client bundle may import no URL and
 * no npm package but VanJS. The CDN stylesheets must be the installed npm files.
 */
export function cdnLibraries(): Plugin {
  const { assets } = readCdnSource();
  for (const [url, { integrity }] of Object.entries(assets)) {
    const name = cdnPackageName(url);
    if (!url.startsWith(`https://cdn.jsdelivr.net/npm/${name}@${installedVersion(name)}/`)) {
      throw new Error(`Run vp run update:cdn and review the ${name} update.`);
    }
    // Bun checks each installed package against the lockfile's SHA-512 of its npm
    // tarball, so an SRI hash that matches the installed file pins the npm release.
    const npm = integritySource(url)!;
    const bytes = readFileSync(join(installedPackage(npm.name).directory, npm.file));
    if (integrity !== `sha256-${createHash("sha256").update(bytes).digest("base64")}`) {
      throw new Error(`The SRI hash differs from the installed npm file: ${url}`);
    }
  }

  return {
    name: "page-code-only",
    enforce: "pre",
    // Build tooling runs locally; only the page's code is checked.
    applyToEnvironment(environment) {
      return environment.name === "client";
    },
    resolveId(id, importer, options) {
      if (options.ssr || importer?.endsWith(".css")) return;
      if (!id.startsWith("\0") && !/^(\.|\/|#|@-\/|@-apps\/|@vite\/|vite\/|vanjs-core$)/.test(id)) {
        this.error(`The page runs only its own code, so it can't import ${id}.`);
      }
    },
    generateBundle(_, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        const vendors = Object.keys(output.modules).filter(
          (id) => id.includes("/node_modules/") && !id.endsWith(".css") && !pageLibrary.test(id),
        );
        if (vendors.length)
          this.error(`The page runs only its own code, not ${vendors.join(", ")}`);
      }
    },
  };
}
