import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import {
  configureGitHubAuth,
  githubAppBot,
  githubAppConfigPath,
  githubAppRequest,
  githubAppSlug,
  githubRepository,
  createAppJwt,
  installationToken,
  loadGitHubAppConfig,
  saveGitHubAppConfig,
  verifyInstallationToken,
} from "#github-app";
import type { GitHubAppConfig } from "#github-app";

export function githubAppManifest(origin: string, state: string) {
  return {
    name: "UnDuoMe Automation",
    url: `https://github.com/${githubRepository}`,
    description:
      "Repository automation for UnDuoMe. Pushes as an App, with cursoragent commits and no coauthors.",
    redirect_url: `${origin}/registered`,
    setup_url: `${origin}/installed?state=${state}`,
    hook_attributes: { url: "https://unduo.me/", active: false },
    public: false,
    request_oauth_on_install: false,
    setup_on_update: false,
    default_permissions: {
      contents: "write",
      workflows: "write",
      actions: "read",
      metadata: "read",
    },
    default_events: [],
  };
}

const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

export function githubAppSetupPage(origin: string, state: string, existing = false): string {
  const action = `https://github.com/organizations/UnDuoMe/settings/apps/new?state=${state}`;
  const button = existing
    ? `<p><a class="button" href="https://github.com/apps/${githubAppSlug}/installations/new" target="_blank" rel="noreferrer">Install on UnDuoMe</a></p><p>After installing, <a href="/installed?state=${state}">finish setup</a> here if GitHub does not return automatically.</p>`
    : `<form method="post" action="${action}"><input type="hidden" name="manifest" value="${escape(JSON.stringify(githubAppManifest(origin, state)))}"><button>Create GitHub App</button></form>`;
  return page(
    "UnDuoMe Automation",
    `
    <p>Future pushes will use <strong>${githubAppBot}</strong>. Commits remain <strong>cursoragent</strong>, with no coauthors.</p>
    <p>This private App belongs to <strong>UnDuoMe</strong>. When GitHub asks, select <strong>Only select repositories → unduo.me</strong>.</p>
    <ul><li>Contents: read and write, to push commits and tags</li><li>Workflows: read and write, to update repository workflows</li><li>Actions: read, to verify workflow attribution</li></ul>
    <p>The private key stays on this Mac outside the repository. Personal GitHub credentials are excluded from repository Git operations.</p>
    ${button}`,
  );
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>
  <style>body{font:17px/1.6 system-ui,sans-serif;max-width:680px;margin:8vh auto;padding:24px;color:#17212b;background:#f7f9fc}h1{line-height:1.2}button,.button{display:inline-block;border:0;border-radius:8px;background:#186341;color:white;padding:12px 20px;font:inherit;text-decoration:none;cursor:pointer}</style>
  <h1>${escape(title)}</h1>${body}</html>`;
}

async function registerManifest(code: string): Promise<GitHubAppConfig> {
  const result = await githubAppRequest<{
    id: number;
    client_id: string;
    slug: string;
    pem: string;
    owner: { login: string };
  }>(`/app-manifests/${encodeURIComponent(code)}/conversions`, undefined, {});
  if (result.owner.login !== "UnDuoMe" || result.slug !== githubAppSlug || !result.pem)
    throw new Error("The App must be named UnDuoMe Automation and owned by UnDuoMe.");
  const config = {
    appId: result.id,
    clientId: result.client_id,
    slug: result.slug,
    privateKey: result.pem,
  };
  saveGitHubAppConfig(config);
  return config;
}

async function finishInstallation(config: GitHubAppConfig, cwd: string): Promise<void> {
  const installation = await githubAppRequest<{
    id: number;
    app_id: number;
    account: { login: string };
    repository_selection: string;
  }>(`/repos/${githubRepository}/installation`, createAppJwt(config));
  if (
    installation.app_id !== config.appId ||
    installation.account.login !== "UnDuoMe" ||
    installation.repository_selection !== "selected"
  )
    throw new Error("Install the App on UnDuoMe and select only the unduo.me repository.");
  const installed = { ...config, installationId: installation.id };
  await verifyInstallationToken(await installationToken(installed));
  saveGitHubAppConfig(installed);
  configureGitHubAuth(cwd);
}

export async function startGitHubAppSetup(cwd = process.cwd()) {
  const state = randomBytes(32).toString("hex");
  let origin = "";
  let config = existsSync(githubAppConfigPath()) ? loadGitHubAppConfig() : undefined;
  let complete!: () => void;
  const finished = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const server = createServer((request, response) => {
    const handle = async () => {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; form-action https://github.com; base-uri 'none'; frame-ancestors 'none'",
      );
      const url = new URL(request.url ?? "/", origin);
      if (
        request.method !== "GET" ||
        request.headers.host !== new URL(origin).host ||
        url.searchParams.get("state") !== state
      ) {
        response.writeHead(404).end("Not found");
        return;
      }
      if (url.pathname === "/start") {
        response.end(githubAppSetupPage(origin, state, !!config));
      } else if (url.pathname === "/registered" && url.searchParams.has("code") && !config) {
        config = await registerManifest(url.searchParams.get("code")!);
        console.log("GitHub App created. Install it on UnDuoMe, selecting only unduo.me.");
        response.end(githubAppSetupPage(origin, state, true));
      } else if (url.pathname === "/installed" && config) {
        await finishInstallation(config, cwd);
        response.end(
          page(
            "App connected",
            `<p>Git operations now authenticate as <strong>${githubAppBot}</strong>. Commits remain cursoragent with no coauthors. You can close this tab.</p>`,
          ),
        );
        console.log(
          `Installed ${githubAppBot} for ${githubRepository}. App credentials verified; no push performed.`,
        );
        complete();
      } else {
        response.writeHead(404).end("Not found");
      }
    };
    void handle().catch(() => {
      console.error(
        "GitHub App setup could not finish. Check the App name, organization and repository selection, then retry setup.",
      );
      if (!response.headersSent) response.writeHead(400);
      response.end(
        page(
          "Setup needs attention",
          `<p>Confirm the App is named UnDuoMe Automation, belongs to UnDuoMe, and is installed on only unduo.me. <a href="/start?state=${state}">Return to setup</a>.</p>`,
        ),
      );
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing setup listener.");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    url: `${origin}/start?state=${state}`,
    finished,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
