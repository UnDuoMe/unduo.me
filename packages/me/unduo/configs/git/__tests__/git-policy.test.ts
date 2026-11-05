import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { gitIdentity } from "#git-policy";

const hookFile = fileURLToPath(new URL("../git-hook.ts", import.meta.url));
const setupFile = fileURLToPath(new URL("../configure-git.ts", import.meta.url));
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
};
let directory: string;

function run(
  command: string,
  args: string[],
  options: { input?: string; env?: NodeJS.ProcessEnv; cwd?: string } = {},
) {
  return spawnSync(command, args, {
    cwd: directory,
    encoding: "utf8",
    env: { ...env, ...options.env },
    ...("input" in options ? { input: options.input } : {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
  });
}

function git(...args: string[]): string {
  const result = run("git", args);
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function hook(
  mode: string,
  options: { input?: string; env?: NodeJS.ProcessEnv; cwd?: string } = {},
) {
  return run("vpx", [hookFile, mode], options);
}

function commit(message = "approved commit", overrides: NodeJS.ProcessEnv = {}): string {
  const result = run("git", ["commit", "--allow-empty", "-m", message], { env: overrides });
  if (result.status !== 0) throw new Error(result.stderr);
  return git("rev-parse", "HEAD");
}

function installHook(name: string, mode: string): void {
  // Execute the same policy through an actual Git hook in a disposable repository.
  const quoted = `'${hookFile.replaceAll("'", "'\\''")}'`;
  writeFileSync(
    join(directory, ".git", "hooks", name),
    `#!/bin/sh\nexec vpx ${quoted} ${mode} "$@"\n`,
    { mode: 0o755 },
  );
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "unduo git policy "));
  git("init", "-b", "main");
  git("config", "user.name", gitIdentity.name);
  git("config", "user.email", gitIdentity.email);
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

test("setup writes only local identity and disables inherited personal signing", () => {
  git("config", "user.name", "someone");
  git("config", "commit.gpgSign", "true");
  expect(run("vpx", [setupFile]).status).toBe(0);
  expect(git("config", "--local", "user.name")).toBe(gitIdentity.name);
  expect(git("config", "--local", "user.email")).toBe(gitIdentity.email);
  expect(git("config", "--local", "user.useConfigOnly")).toBe("true");
  expect(git("config", "--local", "commit.gpgSign")).toBe("false");
  expect(git("config", "--local", "tag.gpgSign")).toBe("false");
  expect(hook("identity").status).toBe(0);
});

test.each([
  { GIT_AUTHOR_NAME: "someone" },
  { GIT_AUTHOR_EMAIL: "someone@example.test" },
  { GIT_COMMITTER_NAME: "someone" },
  { GIT_COMMITTER_EMAIL: "someone@example.test" },
])("rejects effective identity overrides: %j", (overrides) => {
  const result = hook("identity", { env: overrides });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("only cursoragent");
});

test("Git's --author override is rejected even with --no-verify", () => {
  installHook("pre-commit", "identity");
  installHook("prepare-commit-msg", "identity");
  for (const options of [[], ["--no-verify"]]) {
    const result = run("git", [
      "commit",
      "--allow-empty",
      ...options,
      "--author=someone <someone@example.test>",
      "-m",
      "rejected",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("author: only cursoragent");
  }
  commit();
  expect(hook("history").status).toBe(0);
});

test.each([
  "Co-authored-by: someone <someone@example.test>",
  `Co-authored-by: ${gitIdentity.name} <${gitIdentity.email}>`,
  "  co-AUTHORED-by: someone <someone@example.test>",
  "Co-authored-by=someone <someone@example.test>",
  "Co-authored-by: invalid trailer",
])("rejects every coauthor trailer in messages and existing history: %s", (trailer) => {
  installHook("commit-msg", "message");
  const message = `commit\n\n${trailer}`;
  const rejected = run("git", ["commit", "--allow-empty", "-m", message]);
  expect(rejected.status).toBe(1);
  expect(rejected.stderr).toContain("Co-authored-by trailers are not allowed");
  // The history audit still catches commits made with hooks bypassed.
  expect(
    run("git", ["-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-m", message]).status,
  ).toBe(0);
  expect(hook("history").stderr).toContain("Co-authored-by trailers are not allowed");
  const tip = git("rev-parse", "HEAD");
  expect(
    hook("push", { input: `refs/heads/main ${tip} refs/heads/main ${"0".repeat(40)}\n` }).stderr,
  ).toContain("Co-authored-by trailers are not allowed");
});

test("prepare-commit-msg rejects supplied coauthors even with --no-verify", () => {
  installHook("prepare-commit-msg", "message");
  const result = run("git", [
    "commit",
    "--allow-empty",
    "--no-verify",
    "-m",
    "commit\n\nCo-authored-by: someone <someone@example.test>",
  ]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Co-authored-by trailers are not allowed");
  expect(run("git", ["rev-parse", "--verify", "HEAD"]).status).not.toBe(0);
});

test("checks every ancestor on first pushes, force pushes and annotated tags", () => {
  const good = commit();
  const bad = commit("foreign ancestor", { GIT_AUTHOR_EMAIL: "someone@example.test" });
  const tip = commit();
  git("tag", "-a", "release", "-m", "release", tip);
  const tag = git("rev-parse", "release");
  const zero = "0".repeat(40);
  for (const input of [
    `refs/heads/main ${tip} refs/heads/main ${zero}\n`,
    `refs/heads/main ${tip} refs/heads/main ${good}\n`,
    `refs/tags/release ${tag} refs/tags/release ${zero}\n`,
    `refs/heads/good ${good} refs/heads/good ${zero}\nrefs/heads/main ${tip} refs/heads/main ${zero}\n`,
  ]) {
    const result = hook("push", { input });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${bad} author`);
  }
  expect(hook("push", { input: `refs/heads/good ${good} refs/heads/main ${zero}\n` }).status).toBe(
    0,
  );
  expect(hook("push", { input: `(delete) ${zero} refs/heads/main ${tip}\n` }).status).toBe(0);
});

test("a real push hook blocks a foreign committer before any refs reach the remote", () => {
  const remote = join(directory, "remote.git");
  git("init", "--bare", remote);
  installHook("pre-push", "push");
  commit("foreign committer", { GIT_COMMITTER_EMAIL: "someone@example.test" });
  const result = run("git", ["push", remote, "main"]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("committer: only cursoragent");
  expect(git("--git-dir", remote, "for-each-ref")).toBe("");
});

test("mailmaps and replacement objects cannot conceal a foreign author", () => {
  const good = commit();
  const bad = commit("foreign author", {
    GIT_AUTHOR_NAME: "someone",
    GIT_AUTHOR_EMAIL: "someone@example.test",
  });
  writeFileSync(
    join(directory, ".mailmap"),
    `${gitIdentity.name} <${gitIdentity.email}> someone <someone@example.test>\n`,
  );
  git("replace", bad, good);
  expect(hook("history").stderr).toContain(`${bad} author: only cursoragent`);
});

test("audits a detached HEAD and rejects missing shallow ancestry", () => {
  const good = commit();
  const bad = commit("foreign committer", { GIT_COMMITTER_NAME: "someone" });
  git("checkout", "--detach", bad);
  git("branch", "-f", "main", good);
  expect(hook("history").stderr).toContain(`${bad} committer`);
  const shallow = join(directory, "shallow");
  git("clone", "--depth", "1", `file://${directory}`, shallow);
  const result = hook("history", { cwd: shallow });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Cannot audit shallow history");
});

test("an empty repository is valid and malformed push input is rejected", () => {
  expect(hook("history").status).toBe(0);
  expect(hook("push", { input: "not a valid update\n" }).status).toBe(1);
});
