import { readFileSync } from "node:fs";
import { githubRepository, installationToken } from "#github-app";

// This program speaks Git's credential protocol. Its stdout goes only to Git.
if (process.argv[2] === "get") {
  try {
    const input = readFileSync(0, "utf8");
    const values = new Map(
      input.split("\n").map((line) => {
        const split = line.indexOf("=");
        return [line.slice(0, split), line.slice(split + 1)];
      }),
    );
    if (
      values.get("protocol") !== "https" ||
      values.get("host") !== "github.com" ||
      ![githubRepository, `${githubRepository}.git`].includes(values.get("path") ?? "")
    )
      throw new Error("The GitHub App credential is restricted to UnDuoMe/unduo.me.");
    const token = await installationToken();
    process.stdout.write(`username=x-access-token\npassword=${token}\n\n`);
  } catch {
    console.error(
      "App authentication unavailable. Run vp run setup:github-app; personal credentials will not be used.",
    );
    process.stdout.write("quit=true\n\n");
  }
}
