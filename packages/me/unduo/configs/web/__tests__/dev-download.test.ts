import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { expect, test } from "vite-plus/test";
import { webRoot } from "#web-paths";

test("Vite downloads contain their scripts and load pinned assets across restarts", async () => {
  const config = {
    configFile: fileURLToPath(new URL("vite.config.ts", webRoot)),
    logLevel: "silent" as const,
    server: { host: "127.0.0.1", port: 0, open: false },
  };
  let server = await createServer(config);
  try {
    await server.listen();
    const origin = server.resolvedUrls!.local[0]!;
    const home = await fetch(origin);
    expect(home.headers.get("content-type")).toContain("text/html");
    expect(await home.text()).toContain("/@vite/client");

    const url = new URL("files/unduo", origin);
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-disposition")).toBe("attachment");
    const html = await response.text();
    expect(/\/@vite\/|\/@fs\/|<script\b[^>]*\bsrc=/.test(html)).toBe(false);
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, code] of scripts) {
      const hash = createHash("sha256").update(code!).digest("base64");
      expect(html).toContain(`'sha256-${hash}'`);
    }

    const resources = [
      /data-vendor="app" href="([^"]+)" integrity="([^"]+)"/,
      /data-plugin-url="([^"]+)" data-plugin-integrity="([^"]+)"/,
      /data-screenshots-url="([^"]+)" data-screenshots-integrity="([^"]+)"/,
    ];
    for (const pattern of resources) {
      const match = pattern.exec(html);
      expect(match, pattern.source).not.toBeNull();
      const [, assetUrl, integrity] = match!;
      expect(new URL(assetUrl!).origin).toBe(new URL(origin).origin);
      const asset = await fetch(assetUrl!, { headers: { Origin: "null" } });
      expect(asset.status).toBe(200);
      expect(asset.headers.get("access-control-allow-origin")).toBe("*");
      const bytes = Buffer.from(await asset.arrayBuffer());
      expect(`sha256-${createHash("sha256").update(bytes).digest("base64")}`).toBe(integrity);
      if (assetUrl!.endsWith(".css")) {
        expect(asset.headers.get("content-type")).toContain("text/css");
        expect(bytes.toString()).not.toMatch(/@import|@tailwind|@apply/);
      }
      if (assetUrl!.endsWith(".wasm")) {
        expect(asset.headers.get("content-type")).toBe("application/wasm");
        expect(WebAssembly.validate(bytes)).toBe(true);
      }
    }

    const head = await fetch(url, { method: "HEAD" });
    expect(head.headers.get("content-type")).toBe("application/octet-stream");
    expect(await head.text()).toBe("");

    await server.close();
    server = await createServer({
      ...config,
      server: { ...config.server, port: Number(new URL(origin).port) },
    });
    await server.listen();
    // Reopening the saved file requests its assets before any page on localhost.
    const pluginUrl = /data-plugin-url="([^"]+)"/.exec(html)![1]!;
    const plugin = await fetch(pluginUrl, { headers: { Origin: "null" } });
    expect(plugin.status).toBe(200);
    expect(plugin.headers.get("access-control-allow-origin")).toBe("*");
    const hash = createHash("sha256")
      .update(Buffer.from(await plugin.arrayBuffer()))
      .digest("base64");
    expect(html).toContain(`data-plugin-integrity="sha256-${hash}"`);
  } finally {
    await server.close();
  }
}, 30_000);
