import { spawnSync } from "node:child_process";
import { configureGit } from "#git-policy";

// Source archives have no Git metadata; installation must still work there.
if (spawnSync("git", ["rev-parse", "--git-dir"], { stdio: "ignore" }).status === 0) configureGit();
