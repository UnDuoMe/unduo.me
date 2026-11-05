#!/usr/bin/env node
// Cargo runs the plugin build through this wrapper (RUSTC_WRAPPER). For stable
// toolchains Cargo mixes `rustc -vV`, which names the build machine's host,
// into each crate's `-C metadata`. That hash reaches symbol names and so the
// order of the plugin's data, making builds differ between macOS and Linux.
// Replace it with a hash of what identifies the crate on every machine.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { relative } from "node:path";

const [rustc, ...args] = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
const metadata = args.findIndex((arg, i) => args[i - 1] === "-C" && arg.startsWith("metadata="));
if (metadata >= 0) {
  const source = args.find((arg) => arg.endsWith(".rs")) ?? "";
  const identity = [
    value("--crate-name"),
    value("--crate-type"),
    value("--edition"),
    value("--target") ?? "host",
    // Registry crates by registry-relative path; workspace crates by repository path.
    source.includes("/registry/src/")
      ? source.slice(source.indexOf("/registry/src/"))
      : relative(process.cwd(), source),
    ...args.filter((arg, i) => args[i - 1] === "--cfg" && arg.startsWith("feature=")).sort(),
  ];
  args[metadata] =
    `metadata=${createHash("sha256").update(identity.join("\0")).digest("hex").slice(0, 16)}`;
}
// The plugin builds as one codegen unit, so rustc needs no share of Cargo's jobserver.
const env = { ...process.env };
delete env.CARGO_MAKEFLAGS;
delete env.MAKEFLAGS;
const result = spawnSync(rustc, args, { stdio: "inherit", env });
process.exit(result.status ?? 1);
