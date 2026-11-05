import { readFileSync } from "node:fs";
import { checkCoauthors, checkGitHistory, checkGitIdentity, checkGitPush } from "#git-policy";

try {
  switch (process.argv[2]) {
    case "identity":
      checkGitIdentity();
      break;
    case "message":
      checkGitIdentity();
      checkCoauthors(readFileSync(process.argv[3], "utf8"), "commit message");
      break;
    case "push":
      checkGitPush(readFileSync(0, "utf8"));
      break;
    case "history":
      checkGitHistory();
      console.log("All reachable commits use the cursoragent author and committer identity.");
      break;
    default:
      throw new Error("Expected identity, message, push or history.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
