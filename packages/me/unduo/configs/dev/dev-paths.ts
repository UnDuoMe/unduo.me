import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
export const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
export const configDirectory = fileURLToPath(
  new URL("./node_modules/.cache/_dev/", import.meta.url),
);
export const signalRelay = fileURLToPath(new URL("./-signal-relay.mjs", import.meta.url));
// The npm CLI wrapper doesn't forward termination signals. Run the native binary.
export const mprocsBinary = require("mprocs") as string;
