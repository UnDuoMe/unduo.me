// Build crates/setup from scratch into the committed setup.wasm, or with --check
// fail unless a fresh build reproduces the committed bytes exactly.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  setupPluginFile,
  setupPluginManifestFile,
  setupPluginSourceHash,
} from "@-/me.unduo.components.setup.plugin/server";
import { repoRoot } from "#web-paths";

const check = process.argv.includes("--check");
const repo = fileURLToPath(repoRoot).replace(/\/$/, "");
const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: repo, encoding: "utf8", ...options });

// rust-toolchain.toml pins the compiler. Remapping local paths and normalizing
// crate metadata (rustc-wrapper.mjs) make the output independent of the build
// machine, its host triple and the checkout location.
const sysroot = run("rustc", ["--print", "sysroot"]).trim();
const cargoHome = process.env.CARGO_HOME || join(homedir(), ".cargo");
const flags = [
  `--remap-path-prefix=${repo}=/unduo`,
  `--remap-path-prefix=${cargoHome}=/cargo`,
  `--remap-path-prefix=${sysroot}=/rust`,
];
// A fresh target directory every time: cached artifacts could hide a change in
// how the plugin is built.
const target = await mkdtemp(join(tmpdir(), "unduo-plugin-"));
try {
  run(
    "cargo",
    ["build", "--release", "--locked", "--target", "wasm32-unknown-unknown", "-p", "unduo-setup"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        CARGO_TARGET_DIR: target,
        // Keeps crate metadata hashes independent of the build machine's host triple.
        RUSTC_WRAPPER: fileURLToPath(new URL("rustc-wrapper.mjs", import.meta.url)),
        CARGO_ENCODED_RUSTFLAGS: flags.join("\x1f"),
        RUSTFLAGS: "",
      },
    },
  );
  const bytes = await readFile(join(target, "wasm32-unknown-unknown/release/unduo_setup.wasm"));
  const module = new WebAssembly.Module(bytes);

  // Only Extism's kernel functions for input, output, memory and errors, as the
  // page's plugin comment lists them.
  const kernel = new Set(
    [
      "alloc",
      "input_length",
      "input_load_u8",
      "input_load_u64",
      "store_u8",
      "store_u64",
      "output_set",
      "error_set",
    ].map((name) => `extism:host/env.${name}`),
  );
  const imports = WebAssembly.Module.imports(module).map(
    (entry) => `${entry.module}.${entry.name}`,
  );
  const unexpected = imports.filter((name) => !kernel.has(name));
  if (unexpected.length) throw new Error(`The plugin must not import ${unexpected.join(", ")}.`);
  const exports = WebAssembly.Module.exports(module)
    .map((entry) => entry.name)
    .sort();
  if (exports.join() !== "memory,update")
    throw new Error(`Unexpected plugin exports: ${exports.join(", ")}`);

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (check) {
    const manifest = JSON.parse(await readFile(setupPluginManifestFile, "utf8"));
    if (manifest.sha256 !== sha256 || manifest.source !== setupPluginSourceHash())
      throw new Error(
        `setup.wasm is not reproducible from crates/setup: rebuilt ${sha256}, committed ${manifest.sha256}.`,
      );
    console.log(`setup.wasm matches a fresh build of crates/setup (${sha256}).`);
  } else {
    await writeFile(setupPluginFile, bytes);
    const manifest = {
      sha256,
      source: setupPluginSourceHash(),
      toolchain: run("rustc", ["--version"]).trim(),
    };
    await writeFile(setupPluginManifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(
      `Wrote setup.wasm (${bytes.length.toLocaleString("en-US")} bytes, sha256 ${sha256}) importing only ${imports.length} Extism kernel functions.`,
    );
  }
} finally {
  await rm(target, { recursive: true, force: true });
}
