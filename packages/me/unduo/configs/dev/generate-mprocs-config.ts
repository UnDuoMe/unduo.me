import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { configDirectory, repoRoot, signalRelay } from "#dev-paths";

export function createMprocsConfig(port: number, nodeExecutable: string) {
  const pane = (args: string[]) => ({
    cmd: [nodeExecutable, signalRelay, "vp", "run", ...args],
    cwd: repoRoot,
    autostart: true,
    stop: "SIGINT",
  });
  return {
    server: `127.0.0.1:${port}`,
    proc_log: {
      dir: join(repoRoot, ".mprocs-logs", String(port)),
      file: "{name}.log",
      mode: "truncate",
    },
    procs: {
      [`web (:${port + 1})`]: pane(["dev:web", "--port", String(port + 1)]),
    },
    keymap_procs: { "<C-c>": { c: "quit" } },
  };
}

export async function generateMprocsConfig(port: number, nodeExecutable: string) {
  const path = join(configDirectory, `mprocs.${port}.yaml`);
  await mkdir(configDirectory, { recursive: true });
  // JSON is valid YAML, preserving argv and paths containing spaces without shell quoting.
  await writeFile(path, `${JSON.stringify(createMprocsConfig(port, nodeExecutable), null, 2)}\n`);
  return path;
}
