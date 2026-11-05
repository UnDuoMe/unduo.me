import { execFileSync, spawnSync } from "node:child_process";
import { configureGitHubAuth } from "#github-app";

export const gitIdentity = {
  name: "cursoragent",
  email: "199161495+cursoragent@users.noreply.github.com",
} as const;

const expected = `${gitIdentity.name} <${gitIdentity.email}>`;

function git(args: string[]): string {
  return execFileSync("git", ["--no-replace-objects", ...args], { encoding: "utf8" }).trim();
}

function assertIdentity(name: string, email: string, context: string): void {
  if (name !== gitIdentity.name || email !== gitIdentity.email)
    throw new Error(`${context}: only ${expected} is allowed; found ${name} <${email}>.`);
}

/** Inspect Git's effective identities, including environment and --author overrides. */
export function checkGitIdentity(): void {
  for (const role of ["AUTHOR", "COMMITTER"]) {
    const ident = git(["var", `GIT_${role}_IDENT`]);
    const match = ident.match(/^(.*) <([^>]*)> \d+ [+-]\d{4}$/);
    if (!match) throw new Error(`Cannot read Git ${role.toLowerCase()} identity.`);
    assertIdentity(match[1], match[2], role.toLowerCase());
  }
}

/** Never add coauthor credit, regardless of which tool created the commit. */
export function checkCoauthors(message: string, context: string): void {
  if (/^\s*co-authored-by\s*[:=]/im.test(message))
    throw new Error(`${context}: Co-authored-by trailers are not allowed.`);
}

/** Audit every ancestor, including commits already on the remote; ignore mailmaps/replacements. */
export function checkGitHistory(revisions?: string[]): void {
  if (git(["rev-parse", "--is-shallow-repository"]) === "true")
    throw new Error(
      "Cannot audit shallow history. Fetch the full history with git fetch --unshallow.",
    );
  const refs =
    revisions ?? git(["for-each-ref", "--format=%(refname)"]).split("\n").filter(Boolean);
  // Detached HEADs do not appear in for-each-ref; unborn branches have no HEAD yet.
  const head = spawnSync("git", ["rev-parse", "--verify", "--quiet", "HEAD"], { encoding: "utf8" });
  if (!revisions && head.status === 0) refs.push(head.stdout.trim());
  if (!refs.length) return;
  const commits = refs.map((ref) => git(["rev-parse", "--verify", `${ref}^{commit}`]));
  const log = git([
    "log",
    "--no-use-mailmap",
    "--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B%x00",
    ...commits,
    "--",
  ]);
  const fields = log.split("\0");
  for (let index = 0; index + 5 < fields.length; index += 6) {
    const commit = fields[index].trim();
    assertIdentity(fields[index + 1], fields[index + 2], `${commit} author`);
    assertIdentity(fields[index + 3], fields[index + 4], `${commit} committer`);
    checkCoauthors(fields[index + 5], commit);
  }
}

/** pre-push input includes every branch/tag being pushed; all-zero local IDs mean deletion. */
export function checkGitPush(input: string): void {
  const revisions: string[] = [];
  for (const line of input.split("\n").filter(Boolean)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4 || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(fields[1]))
      throw new Error("Cannot audit malformed pre-push input.");
    if (!/^0+$/.test(fields[1])) revisions.push(fields[1]);
  }
  if (revisions.length) checkGitHistory(revisions);
}

/** Keep this repository independent of the machine's personal Git identity and signing key. */
export function configureGit(): void {
  for (const [key, value] of Object.entries({
    "user.name": gitIdentity.name,
    "user.email": gitIdentity.email,
    "user.useConfigOnly": "true",
    "commit.gpgSign": "false",
    "tag.gpgSign": "false",
  }))
    git(["config", "--local", key, value]);
  configureGitHubAuth();
}
