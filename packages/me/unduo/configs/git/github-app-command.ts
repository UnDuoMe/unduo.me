import { checkGitHubPushAuth, githubAppBot, githubRemote } from "#github-app";

try {
  await checkGitHubPushAuth(process.argv[2] ?? githubRemote);
  console.log(`Push authentication verified for ${githubAppBot}.`);
} catch {
  console.error(
    "App-authenticated push required. Run vp run setup:github-app. Personal GitHub credentials are not allowed.",
  );
  process.exitCode = 1;
}
