// Build the experimental self-contained pages into www-self/, beside the normal www/:
// setup logic in TypeScript instead of WebAssembly, and nothing loaded over the network.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { repoRoot } from "#web-paths";

const output = fileURLToPath(new URL("www-self/", repoRoot));
execFileSync("vp", ["run", "--filter", "@-apps/unduo-web", "build"], {
  cwd: fileURLToPath(repoRoot),
  stdio: "inherit",
  env: {
    ...process.env,
    UNDUO_JS_PLUGIN: "1",
    UNDUO_SELF_CONTAINED: "1",
    UNDUO_WEB_OUTPUT: output,
  },
});
console.log(`Built the self-contained pages in ${output}`);
