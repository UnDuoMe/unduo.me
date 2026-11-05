import { execFileSync, spawnSync } from "node:child_process";
import { createVerify, generateKeyPairSync } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import {
  assertGitHubRemote,
  checkGitHubPushAuth,
  configureGitHubAuth,
  createAppJwt,
  githubAppBot,
  githubAppConfigPath,
  githubAppSlug,
  githubCredentialHelper,
  githubRemote,
  installationToken,
  loadGitHubAppConfig,
  saveGitHubAppConfig,
  verifyInstallationToken,
} from "#github-app";
import type { GitHubAppConfig } from "#github-app";
import { githubAppManifest, startGitHubAppSetup } from "#github-app-setup";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const config: GitHubAppConfig = {
  appId: 123,
  clientId: "test-client",
  slug: githubAppSlug,
  privateKey,
  installationId: 456,
};
let directory: string;
let repo: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "unduo app auth "));
  repo = join(directory, "repo");
  mkdirSync(repo);
  vi.stubEnv("GIT_CONFIG_GLOBAL", join(directory, "global-config"));
  vi.stubEnv("GIT_CONFIG_SYSTEM", "/dev/null");
  vi.stubEnv("GITHUB_ACTIONS", "");
  vi.stubEnv("UNDUO_GITHUB_APP_CONFIG", join(directory, "credentials.json"));
  execFileSync("git", ["init", "--template=", "-b", "main"], { cwd: repo, stdio: "ignore" });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

test("signs short-lived App JWTs using the private key and client ID", () => {
  const jwt = createAppJwt(config, 1_700_000_000_000);
  const [header, payload, signature] = jwt.split(".");
  expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
    alg: "RS256",
    typ: "JWT",
  });
  expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toEqual({
    iat: 1_699_999_940,
    exp: 1_700_000_540,
    iss: config.clientId,
  });
  expect(
    createVerify("RSA-SHA256")
      .update(`${header}.${payload}`)
      .verify(keys.publicKey, signature, "base64url"),
  ).toBe(true);
});

test("stores credentials outside the repository with owner-only permissions", () => {
  saveGitHubAppConfig(config);
  expect(loadGitHubAppConfig()).toEqual(config);
  expect(statSync(githubAppConfigPath()).mode & 0o777).toBe(0o600);
  chmodSync(githubAppConfigPath(), 0o644);
  expect(() => loadGitHubAppConfig()).toThrow("missing or invalid");
  vi.stubEnv("UNDUO_GITHUB_APP_CONFIG", new URL("../credentials.json", import.meta.url).pathname);
  expect(() => saveGitHubAppConfig(config)).toThrow("outside the repository");
});

test("mints installation tokens for only this repository with no personal credentials", async () => {
  const request = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ token: "test-installation-token" }));
  expect(await installationToken(config)).toBe("test-installation-token");
  const [url, options] = request.mock.calls[0];
  expect(url).toBe("https://api.github.com/app/installations/456/access_tokens");
  expect(options?.method).toBe("POST");
  if (typeof options?.body !== "string") throw new Error("Missing JSON request body");
  expect(JSON.parse(options.body)).toEqual({
    repositories: ["unduo.me"],
    permissions: { contents: "write", workflows: "write", metadata: "read", actions: "read" },
  });
  expect(options?.headers).toMatchObject({ Authorization: expect.stringMatching(/^Bearer ey/) });
  expect(options?.redirect).toBe("error");
});

test("rejects personal tokens and tokens with broader repository scope", async () => {
  const request = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({}, { status: 403 }));
  await expect(verifyInstallationToken("test-personal-token")).rejects.toThrow("HTTP 403");
  request.mockResolvedValue(
    Response.json({ total_count: 2, repositories: [{ full_name: "UnDuoMe/unduo.me" }] }),
  );
  await expect(verifyInstallationToken("test-app-token")).rejects.toThrow("restricted");
  request.mockResolvedValue(
    Response.json({ total_count: 1, repositories: [{ full_name: "UnDuoMe/unduo.me" }] }),
  );
  await expect(verifyInstallationToken("test-app-token")).resolves.toBeUndefined();
});

test.each([
  "git@github.com:UnDuoMe/unduo.me.git",
  "https://someone:token@github.com/UnDuoMe/unduo.me.git",
  "https://github.com/another/repo.git",
])("rejects remote credential bypasses: %s", (remote) => {
  expect(() => assertGitHubRemote(remote)).toThrow("HTTPS remote without inline credentials");
});

test("CI pushes require the App as the original workflow actor", async () => {
  vi.stubEnv("GITHUB_ACTIONS", "true");
  vi.stubEnv("GITHUB_ACTOR", "someone");
  await expect(checkGitHubPushAuth(githubRemote)).rejects.toThrow("must originate from");
  vi.stubEnv("GITHUB_ACTOR", githubAppBot);
  await expect(checkGitHubPushAuth(githubRemote)).resolves.toBeUndefined();
});

test("Git never falls back to a personal helper when App credentials are missing", () => {
  const marker = join(directory, "personal-helper-was-used");
  const personalHelper = join(directory, "personal-helper");
  writeFileSync(
    personalHelper,
    `#!/bin/sh\ntouch '${marker}'\nprintf 'username=someone\\npassword=test-personal-token\\n\\n'\n`,
    { mode: 0o755 },
  );
  execFileSync("git", ["config", "--global", "credential.helper", `!'${personalHelper}'`]);
  configureGitHubAuth(repo);
  const packageDir = join(repo, "packages/me/unduo/configs/git");
  mkdirSync(packageDir, { recursive: true });
  for (const name of ["package.json", "github-app.ts", "github-app-credential.ts"])
    copyFileSync(new URL(`../${name}`, import.meta.url), join(packageDir, name));
  const result = spawnSync("git", ["credential", "fill"], {
    cwd: repo,
    encoding: "utf8",
    input: "protocol=https\nhost=github.com\npath=UnDuoMe/unduo.me.git\n\n",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  expect(result.status).not.toBe(0);
  expect(result.stdout).not.toContain("test-personal-token");
  expect(result.stderr).toContain("personal credentials will not be used");
  expect(existsSync(marker)).toBe(false);
  const global = readFileSync(process.env.GIT_CONFIG_GLOBAL!, "utf8");
  expect(global).toContain(personalHelper);
  const local = execFileSync(
    "git",
    ["config", "--local", "--get-all", "credential.https://github.com.helper"],
    { cwd: repo, encoding: "utf8" },
  );
  expect(local.trim()).toBe(githubCredentialHelper);
});

test("the manifest requests a private org-owned App without user OAuth or webhooks", () => {
  const manifest = githubAppManifest("http://127.0.0.1:1234", "test-state");
  expect(manifest.public).toBe(false);
  expect(manifest.request_oauth_on_install).toBe(false);
  expect(manifest.hook_attributes.active).toBe(false);
  expect(manifest.default_events).toEqual([]);
  expect(manifest.default_permissions).toEqual({
    contents: "write",
    workflows: "write",
    actions: "read",
    metadata: "read",
  });
  expect(manifest.setup_url).toBe("http://127.0.0.1:1234/installed?state=test-state");
});

test("the setup listener rejects invalid state and never exposes credentials", async () => {
  const setup = await startGitHubAppSetup(repo);
  try {
    const response = await fetch(setup.url);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("Only select repositories");
    expect(html).toContain("github.com/organizations/UnDuoMe/settings/apps/new");
    expect(html).not.toContain("PRIVATE KEY");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    const bad = new URL(setup.url);
    bad.searchParams.set("state", "wrong");
    expect((await fetch(bad)).status).toBe(404);
  } finally {
    await setup.close();
  }
});

test.each(["selected", "all"])(
  "the browser callback verifies %s installation with a token restricted to this repo",
  async (selection) => {
    const originalFetch = globalThis.fetch;
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    const api = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith("https://api.github.com")) return originalFetch(input, init);
      if (url.endsWith("/conversions"))
        return Response.json({
          id: config.appId,
          client_id: config.clientId,
          slug: config.slug,
          pem: privateKey,
          owner: { login: "UnDuoMe" },
        });
      if (url.endsWith("/installation"))
        return Response.json({
          id: 456,
          app_id: 123,
          account: { login: "UnDuoMe" },
          repository_selection: selection,
        });
      if (url.endsWith("/access_tokens"))
        return Response.json({ token: "test-installation-token" });
      if (url.endsWith("/installation/repositories"))
        return Response.json({ total_count: 1, repositories: [{ full_name: "UnDuoMe/unduo.me" }] });
      throw new Error("Unexpected GitHub request");
    });
    const setup = await startGitHubAppSetup(repo);
    try {
      const registered = new URL(setup.url);
      registered.pathname = "/registered";
      registered.searchParams.set("code", "test-manifest-code");
      const registration = await fetch(registered);
      expect(registration.status).toBe(200);
      expect(await registration.text()).not.toContain(privateKey);
      expect(loadGitHubAppConfig().privateKey).toBe(privateKey);
      const installed = new URL(setup.url);
      installed.pathname = "/installed";
      const response = await fetch(installed);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("App connected");
      await setup.finished;
      expect(loadGitHubAppConfig().installationId).toBe(456);
      expect(
        api.mock.calls.some(
          ([url]) =>
            typeof url === "string" && url.includes("/app/installations/456/access_tokens"),
        ),
      ).toBe(true);
      const output = logs.mock.calls.flat().join(" ");
      expect(output).not.toContain(privateKey);
      expect(output).not.toContain("test-installation-token");
      expect(
        execFileSync(
          "git",
          ["config", "--local", "--get", "credential.https://github.com.helper"],
          {
            cwd: repo,
            encoding: "utf8",
          },
        ).trim(),
      ).toBe(githubCredentialHelper);
    } finally {
      await setup.close();
    }
  },
);
