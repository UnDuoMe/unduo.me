import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { webOutput } from "#web-paths";

const root = resolve(process.env.UNDUO_WEB_OUTPUT ?? fileURLToPath(webOutput));
const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
// With UNDUO_LOCAL_CDN=1, pages load their published assets from this server's
// /cdn/ and /cdn-home/ copies, so a build can be tested before `vp run publish:assets`.
const localCdn = process.env.UNDUO_LOCAL_CDN === "1";
const types = {
  ".html": "text/html; charset=utf-8",
  ".webp": "image/webp",
  ".wasm": "application/wasm",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
    return;
  }
  try {
    const { pathname, search } = new URL(request.url, `http://${host}:${port}`);
    let path = resolve(root, `.${decodeURIComponent(pathname)}`);
    if (path !== root && !path.startsWith(root + sep)) {
      response.writeHead(404).end("Not found");
      return;
    }
    if ((await stat(path)).isDirectory()) {
      if (!pathname.endsWith("/")) {
        response.writeHead(308, { Location: pathname + "/" + search }).end();
        return;
      }
      path = resolve(path, "index.html");
    }
    let bytes = await readFile(path);
    if (localCdn && (extname(path) === ".html" || pathname.startsWith("/files/"))) {
      let text = bytes.toString("utf8");
      // The setup files' assets and the home page's, each from its own commit.
      for (const name of ["cdn", "cdn-home"]) {
        const { base } = JSON.parse(await readFile(resolve(root, `${name}.json`), "utf8"));
        text = text.replaceAll(base, `http://${host}:${server.address().port}/${name}/`);
      }
      bytes = Buffer.from(text);
    }
    response.writeHead(200, {
      "Content-Type": types[extname(path)] ?? "application/octet-stream",
      "Content-Length": bytes.byteLength,
      // Downloaded copies opened from file:// load these with CORS, as from jsDelivr.
      ...(/^\/cdn(?:-home)?\//.test(pathname) ? { "Access-Control-Allow-Origin": "*" } : {}),
    });
    response.end(request.method === "HEAD" ? undefined : bytes);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(port, host, () => {
  console.log(`Preview: http://${host}:${server.address().port}`);
});
