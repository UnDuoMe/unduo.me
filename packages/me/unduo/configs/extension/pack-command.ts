import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assetName, packExtension } from "#extension-zip";

const { zip, sha256, version } = packExtension();
const outDir = fileURLToPath(new URL(".output/", import.meta.url));
mkdirSync(outDir, { recursive: true });
writeFileSync(outDir + assetName, zip);
console.log(`UnDuo Autofill ${version}: ${outDir}${assetName}`);
console.log(`SHA-256 ${sha256}`);
