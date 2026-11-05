// mprocs signals the pane's PTY leader. Relay to every descendant so Vite+
// runners cannot leave Vite watchers behind when a pane stops.
import { execFileSync, spawn } from "node:child_process";
import { constants } from "node:os";

const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error("Missing pane command.");
const child = spawn(command, args, { stdio: "inherit" });
let stopping = false;

function descendants(rootPid) {
  try {
    const rows = execFileSync("ps", ["-axo", "pid=,ppid="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const children = new Map();
    for (const line of rows.trim().split("\n")) {
      const [pid, parent] = line.trim().split(/\s+/).map(Number);
      if (Number.isInteger(pid) && Number.isInteger(parent))
        children.set(parent, [...(children.get(parent) ?? []), pid]);
    }
    const result = [];
    const pending = [rootPid];
    while (pending.length) {
      for (const pid of children.get(pending.pop()) ?? []) {
        result.push(pid);
        pending.push(pid);
      }
    }
    return result.reverse();
  } catch {
    return [];
  }
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (stopping || child.pid === undefined) return;
    stopping = true;
    // Descendants first, before the direct child can exit and reparent them.
    for (const pid of [...descendants(child.pid), child.pid]) {
      try {
        process.kill(pid, signal);
      } catch {
        /* Already exited. */
      }
    }
  });
}
child.once("error", (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
child.once("exit", (code, signal) =>
  process.exit(code ?? (signal ? 128 + constants.signals[signal] : 1)),
);
