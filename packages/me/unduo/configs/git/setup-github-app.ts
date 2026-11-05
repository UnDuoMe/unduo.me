import { configureGitHubAuth } from "#github-app";
import { startGitHubAppSetup } from "#github-app-setup";

// Block personal Git credentials immediately, including while approval is pending.
configureGitHubAuth();
const setup = await startGitHubAppSetup();
console.log(`Complete GitHub's App creation and installation approval at:\n${setup.url}`);
const timeout = setTimeout(() => {
  console.error("Setup expired. Run vp run setup:github-app to resume.");
  void setup.close().then(() => process.exit(1));
}, 55 * 60_000);
await setup.finished;
clearTimeout(timeout);
await setup.close();
