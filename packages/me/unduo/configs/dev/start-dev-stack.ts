import { execFile, spawn, spawnSync } from "node:child_process";
import { mprocsBinary, repoRoot } from "#dev-paths";
import { assertPortAvailable } from "#dev-port";
import { generateMprocsConfig } from "#generate-mprocs-config";

export function resolveNodeExecutable(): string {
  if (!process.versions.bun) return process.execPath;
  // Signal relays run in real Node, even when this Bun entrypoint launched them.
  const result = spawnSync("node", ["-p", "process.versions.bun ? String() : process.execPath"], {
    encoding: "utf8",
    cwd: repoRoot,
  });
  if (result.error || result.status !== 0 || !result.stdout.trim())
    throw new Error("Could not resolve Vite+'s Node runtime. Run vp env doctor.", {
      cause: result.error,
    });
  return result.stdout.trim();
}

export async function startDevStack(port: number, nodeExecutable: string): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("mprocs needs a terminal. Use vp run dev:web for a server without a TUI.");
  await assertPortAvailable(port);
  await assertPortAvailable(port + 1);
  const config = await generateMprocsConfig(port, nodeExecutable);
  process.stdout.write(
    `unduo: http://127.0.0.1:${port + 1} · mprocs 127.0.0.1:${port}\nLogs: .mprocs-logs/${port}/\n`,
  );

  return new Promise((resolve, reject) => {
    const child = spawn(mprocsBinary, ["--config", config], { cwd: repoRoot, stdio: "inherit" });
    let stopping = false;
    const quit = () => {
      if (stopping || child.exitCode !== null) return;
      stopping = true;
      // Ask the owned supervisor to stop its panes; killing it first could orphan them.
      execFile(
        mprocsBinary,
        ["--server", `127.0.0.1:${port}`, "--ctl", "{c: quit}"],
        { timeout: 2000 },
        (error) => {
          if (error && child.exitCode === null) child.kill("SIGINT");
        },
      );
    };
    const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
    const cleanup = () => {
      for (const signal of signals) process.off(signal, quit);
    };
    for (const signal of signals) process.on(signal, quit);
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("exit", (code) => {
      cleanup();
      resolve(code ?? 1);
    });
  });
}
