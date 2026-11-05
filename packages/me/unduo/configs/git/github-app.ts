import { execFileSync } from "node:child_process";
import { createSign } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const githubRepository = "UnDuoMe/unduo.me";
export const githubAppSlug = "unduome-automation";
export const githubAppBot = `${githubAppSlug}[bot]`;
export const githubRemote = `https://github.com/${githubRepository}.git`;
export const githubCredentialHelper =
  '!vpx "$(git rev-parse --show-toplevel)/packages/me/unduo/configs/git/github-app-credential.ts"';

export interface GitHubAppConfig {
  appId: number;
  clientId: string;
  slug: string;
  privateKey: string;
  installationId?: number;
}

export function githubAppConfigPath(): string {
  return resolve(
    process.env.UNDUO_GITHUB_APP_CONFIG ??
      `${process.env.XDG_CONFIG_HOME ?? `${homedir()}/.config`}/unduo/github-app.json`,
  );
}

function assertExternalConfig(): string {
  const path = githubAppConfigPath();
  const within = relative(fileURLToPath(new URL("../../../../../", import.meta.url)), path);
  if (within === "" || (!within.startsWith("..") && !isAbsolute(within)))
    throw new Error("GitHub App private keys must be stored outside the repository.");
  return path;
}

export function loadGitHubAppConfig(): GitHubAppConfig {
  const path = assertExternalConfig();
  try {
    if ((statSync(path).mode & 0o077) !== 0) throw new Error();
    const config: GitHubAppConfig = JSON.parse(readFileSync(path, "utf8"));
    if (
      !Number.isSafeInteger(config.appId) ||
      !config.clientId ||
      config.slug !== githubAppSlug ||
      !config.privateKey?.includes("PRIVATE KEY") ||
      (config.installationId !== undefined && !Number.isSafeInteger(config.installationId))
    )
      throw new Error();
    return config;
  } catch {
    throw new Error("GitHub App credentials are missing or invalid. Run vp run setup:github-app.");
  }
}

export function saveGitHubAppConfig(config: GitHubAppConfig): void {
  const path = assertExternalConfig();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function createAppJwt(config: GitHubAppConfig, now = Date.now()): string {
  const encode = (data: object) => Buffer.from(JSON.stringify(data)).toString("base64url");
  const time = Math.floor(now / 1000);
  const data = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: time - 60, exp: time + 540, iss: config.clientId })}`;
  const signature = createSign("RSA-SHA256").update(data).sign(config.privateKey, "base64url");
  return `${data}.${signature}`;
}

export async function githubAppRequest<T>(path: string, token?: string, body?: object): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`GitHub App request failed (HTTP ${response.status}).`);
  return response.json() as Promise<T>;
}

export async function installationToken(config = loadGitHubAppConfig()): Promise<string> {
  if (!config.installationId)
    throw new Error("Install the GitHub App using vp run setup:github-app.");
  const result = await githubAppRequest<{ token: string }>(
    `/app/installations/${config.installationId}/access_tokens`,
    createAppJwt(config),
    {
      repositories: ["unduo.me"],
      permissions: { contents: "write", workflows: "write", metadata: "read", actions: "read" },
    },
  );
  if (!result.token) throw new Error("GitHub did not issue an installation token.");
  return result.token;
}

/** This endpoint accepts installation credentials, rather than a personal GitHub token. */
export async function verifyInstallationToken(token: string): Promise<void> {
  const result = await githubAppRequest<{
    total_count: number;
    repositories: { full_name: string }[];
  }>("/installation/repositories", token);
  if (result.total_count !== 1 || result.repositories[0]?.full_name !== githubRepository)
    throw new Error("The App token must be restricted to UnDuoMe/unduo.me.");
}

export function configureGitHubAuth(cwd = process.cwd()): void {
  // Actions checkout supplies its own short-lived GitHub App token in CI.
  if (process.env.GITHUB_ACTIONS === "true") return;
  const git = (args: string[]) => execFileSync("git", ["config", "--local", ...args], { cwd });
  git(["--replace-all", "credential.https://github.com.helper", ""]);
  git(["--add", "credential.https://github.com.helper", githubCredentialHelper]);
  git(["credential.https://github.com.useHttpPath", "true"]);
  // Empty values reset inherited extra Authorization headers, including personal tokens.
  git(["--replace-all", "http.https://github.com/.extraHeader", ""]);
}

export function assertGitHubRemote(remote: string): void {
  if (remote !== githubRemote && remote !== githubRemote.replace(/\.git$/, ""))
    throw new Error("Pushes must use the UnDuoMe HTTPS remote without inline credentials.");
}

export async function checkGitHubPushAuth(remote: string): Promise<void> {
  assertGitHubRemote(remote);
  if (process.env.GITHUB_ACTIONS === "true") {
    if (process.env.GITHUB_ACTOR !== githubAppBot)
      throw new Error(`Workflow pushes must originate from ${githubAppBot}.`);
    return;
  }
  loadGitHubAppConfig();
  const config = execFileSync("git", ["config", "--get-regexp", "^http\\..*extraheader$"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (config.split("\n").some((line) => /^\S+\s+\S/.test(line)))
    throw new Error("Remove extra HTTP Authorization headers before an App-authenticated push.");
  const credentials = execFileSync("git", ["credential", "fill"], {
    input: `protocol=https\nhost=github.com\npath=${githubRepository}.git\n\n`,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const token = credentials.match(/^password=(.+)$/m)?.[1];
  if (!token) throw new Error("No GitHub App credential was provided.");
  await verifyInstallationToken(token);
}
