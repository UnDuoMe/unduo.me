import { execFileSync } from "node:child_process";
import { githubAppRequest, githubRepository, installationToken } from "@-/me.unduo.configs.git";
import { assetName, packExtension } from "#extension-zip";

/**
 * Publishes the built extension as a GitHub release of UnDuoMe/unduo.me, as the UnDuoMe
 * Automation App, tagged `autofill-v<version>` at the pushed commit it was built from.
 * Bump `version` in apps/unduo-extension/public/manifest.json for each release.
 */
const sources = ["apps/unduo-extension", "packages/me/unduo/lib/duo-prompt"];
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();

const { zip, sha256, version } = packExtension();
const commit = git("rev-parse", "HEAD");
if (git("status", "--porcelain", "--", ...sources)) {
  throw new Error(`Commit your changes to ${sources.join(" and ")} first.`);
}
git("fetch", "--quiet", "origin", "main");
try {
  git("merge-base", "--is-ancestor", commit, "origin/main");
} catch {
  throw new Error("Push this commit to main first, so the release's tag points at it.");
}

const tag = `autofill-v${version}`;
const token = await installationToken();
const releases = await githubAppRequest<{ tag_name: string; html_url: string }[]>(
  `/repos/${githubRepository}/releases?per_page=100`,
  token,
);
const existing = releases.find((release) => release.tag_name === tag);
if (existing) {
  throw new Error(`${tag} is already released (${existing.html_url}). Bump the version.`);
}

const body = `Takes Duo's sign-in prompt to **Duo Mobile passcode** and lets 1Password fill the code. See [the extension's README](https://github.com/${githubRepository}/tree/${commit}/apps/unduo-extension#readme).

## Install in Chrome, Edge, Brave or Arc

1. Download **${assetName}** below and unzip it. Keep the folder: the browser runs the extension from it.
2. Open \`chrome://extensions\` (\`edge://extensions\` in Edge) and turn on **Developer mode**.
3. Click **Load unpacked** and choose the unzipped folder, the one holding \`manifest.json\`.

## Install in Firefox

Open \`about:debugging#/runtime/this-firefox\`, click **Load Temporary Add-on…** and choose **${assetName}**. Firefox removes it when it quits.

## Then, in 1Password

Edit the login that holds your unduo one-time password and add your Duo prompt's address as a website, for example \`https://api-XXXXXXXX.duosecurity.com\` (copy the host from the address bar on Duo's page).

## Check the file

SHA-256 of ${assetName}: \`${sha256}\`

\`vp run pack:extension\` at ${commit} builds the same bytes.`;

const release = await githubAppRequest<{ id: number; html_url: string }>(
  `/repos/${githubRepository}/releases`,
  token,
  {
    tag_name: tag,
    target_commitish: commit,
    name: `UnDuo Autofill ${version}`,
    body,
    make_latest: "true",
  },
);
const upload = await fetch(
  `https://uploads.github.com/repos/${githubRepository}/releases/${release.id}/assets?name=${assetName}`,
  {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/zip",
    },
    body: new Uint8Array(zip),
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  },
);
if (!upload.ok) throw new Error(`Uploading ${assetName} failed (HTTP ${upload.status}).`);
console.log(`Released ${tag}: ${release.html_url}`);
console.log(`SHA-256 ${sha256}`);
