import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

/** The committed plugin, rebuilt from `crates/setup` by `vp run build:plugin`. */
export const setupPluginFile = new URL("./setup.wasm", import.meta.url);
export const setupPluginManifestFile = new URL("./setup.wasm.json", import.meta.url);
const repoRoot = new URL("../../../../../../", import.meta.url);

/** Everything that determines the plugin's bytes. */
export function setupPluginSources(): string[] {
  const sources = readdirSync(new URL("crates/setup/src/", repoRoot))
    .filter((name) => name.endsWith(".rs"))
    .map((name) => `crates/setup/src/${name}`);
  return [
    "Cargo.toml",
    "Cargo.lock",
    "rust-toolchain.toml",
    "crates/setup/Cargo.toml",
    ...sources,
  ].sort();
}

export function setupPluginSourceHash(): string {
  const hash = createHash("sha256");
  for (const path of setupPluginSources()) {
    hash.update(`${path}\0`);
    hash.update(readFileSync(new URL(path, repoRoot)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export interface SetupPluginManifest {
  /** SHA-256 of `setup.wasm` in hex; pages pin it as `data-plugin-integrity`. */
  sha256: string;
  /** `setupPluginSourceHash()` when the plugin was built. */
  source: string;
  toolchain: string;
}

/** The plugin bytes, refusing a plugin that no longer matches its Rust sources. */
export function readSetupPlugin(): { bytes: Buffer; sha256: string } {
  const manifest = JSON.parse(readFileSync(setupPluginManifestFile, "utf8")) as SetupPluginManifest;
  const bytes = readFileSync(setupPluginFile);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== manifest.sha256) throw new Error("setup.wasm does not match setup.wasm.json.");
  if (setupPluginSourceHash() !== manifest.source)
    throw new Error("The setup plugin is older than crates/setup. Run vp run build:plugin.");
  return { bytes, sha256 };
}
