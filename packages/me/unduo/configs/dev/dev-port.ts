import { createServer } from "node:net";

export function parseDevPort(value = "2999"): number {
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65534) {
    throw new Error("--port must be an integer from 1 to 65534 (Vite uses the next port).");
  }
  return port;
}

/** Bind and release; never connect to an existing mprocs control listener. */
export function assertPortAvailable(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error) => {
      reject(
        new Error(
          `Port ${port} is unavailable. Choose another --port; no processes were stopped.`,
          { cause: error },
        ),
      );
    });
    server.listen(port, "127.0.0.1", () =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
}
