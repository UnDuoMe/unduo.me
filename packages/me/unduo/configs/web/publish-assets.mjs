// Publish www/cdn/ and www/cdn-home/ as the content-addressed commits the built pages pin
// (the setup files' assets and the home page's),
// then confirm jsDelivr serves every file with the expected bytes and lists each commit.
// --dry-run creates the commit locally and skips pushing and fetching.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { cdnCommit, cdnIdentity, cdnMessage } from "#cdn-assets";
import { assetIntegritySource } from "#cdn-source";
import { repoRoot, webOutput } from "#web-paths";

const dryRun = process.argv.includes("--dry-run");
const repo = fileURLToPath(repoRoot);
const git = (args, options = {}) =>
  (execFileSync("git", args, { cwd: repo, encoding: "utf8", ...options }) ?? "").trim();

/** Publish the commit in `www/<name>/`, which `www/<name>.json` describes. */
async function publish(name) {
  const manifest = JSON.parse(await readFile(new URL(`${name}.json`, webOutput), "utf8"));
  const directory = new URL(`${name}/`, webOutput);
  const files = new Map();
  for (const file of (await readdir(directory)).sort())
    files.set(file, await readFile(new URL(file, directory)));
  if (cdnCommit(files) !== manifest.commit)
    throw new Error(`www/${name}/ does not match www/${name}.json. Run vp run build:web again.`);

  const entries = [...files.keys()]
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
    .map(
      (file) =>
        `100644 blob ${git(["hash-object", "-w", fileURLToPath(new URL(file, directory))])}\t${file}`,
    );
  const tree = git(["mktree"], { input: `${entries.join("\n")}\n` });
  const identity = {
    GIT_AUTHOR_NAME: cdnIdentity.name,
    GIT_AUTHOR_EMAIL: cdnIdentity.email,
    GIT_AUTHOR_DATE: cdnIdentity.date,
    GIT_COMMITTER_NAME: cdnIdentity.name,
    GIT_COMMITTER_EMAIL: cdnIdentity.email,
    GIT_COMMITTER_DATE: cdnIdentity.date,
  };
  const commit = git(["commit-tree", "--no-gpg-sign", "-m", cdnMessage, tree], {
    env: { ...process.env, ...identity },
  });
  if (commit !== manifest.commit)
    throw new Error(`git created ${commit}, but the pages reference ${manifest.commit}.`);

  const tag = `refs/tags/assets/${commit}`;
  if (dryRun) {
    console.log(`Created ${commit} locally (${files.size} files); not pushing ${tag}.`);
  } else {
    if (git(["ls-remote", "origin", tag])) console.log(`${tag} is already published.`);
    else {
      git(["push", "origin", `${commit}:${tag}`], { stdio: "inherit" });
      console.log(`Pushed ${tag}.`);
    }
    // jsDelivr fetches a commit from GitHub on first request.
    for (const [file, expected] of Object.entries(manifest.files)) {
      const url = manifest.base + file;
      for (let attempt = 1; ; attempt++) {
        const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        const bytes = Buffer.from(await response.arrayBuffer());
        const integrity = `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
        if (response.ok && integrity === expected) break;
        if (attempt === 10)
          throw new Error(`jsDelivr serves unexpected bytes for ${url} (${response.status}).`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
      }
    }
    // Pages name jsDelivr's listing of the commit, which appears minutes after its files.
    const { source } = assetIntegritySource(manifest.base + Object.keys(manifest.files)[0]);
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(source, { signal: AbortSignal.timeout(60_000) });
      if (response.ok) break;
      if (attempt === 40)
        throw new Error(`jsDelivr doesn't list ${commit} after ten minutes (${response.status}).`);
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
    console.log(`jsDelivr serves and lists all ${files.size} files at ${manifest.base}`);
  }
}

for (const name of ["cdn", "cdn-home"]) await publish(name);
