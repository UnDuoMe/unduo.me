import { createServer } from "node:net";
import { expect, test } from "vite-plus/test";
import { assertPortAvailable, parseDevPort } from "#dev-port";
import { createMprocsConfig } from "#generate-mprocs-config";

test("keeps the web server on 3000 by default and isolates alternate port pairs", () => {
  expect(parseDevPort()).toBe(2999);
  const config = createMprocsConfig(parseDevPort("14999"), "/path with spaces/node");
  expect(config.server).toBe("127.0.0.1:14999");
  const web = config.procs["web (:15000)"];
  expect(web.cmd[0]).toBe("/path with spaces/node");
  expect(web.cmd.slice(-3)).toEqual(["dev:web", "--port", "15000"]);
  expect(Object.keys(config.procs)).toEqual(["web (:15000)"]);
  expect(config.proc_log.dir).toMatch(/\.mprocs-logs[/\\]14999$/);
});

test.each(["0", "65535", "3000.5", "NaN", "", "-1", "1e3"])(
  "rejects invalid base ports: %s",
  (value) => {
    expect(() => parseDevPort(value)).toThrow(/--port/);
  },
);

test("a busy port is rejected without connecting to or stopping its owner", async () => {
  let connections = 0;
  const server = createServer(() => {
    connections++;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test listener.");
  try {
    await expect(assertPortAvailable(address.port)).rejects.toThrow(/no processes were stopped/);
    expect(server.listening).toBe(true);
    expect(connections).toBe(0);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  await expect(assertPortAvailable(address.port)).resolves.toBeUndefined();
});
