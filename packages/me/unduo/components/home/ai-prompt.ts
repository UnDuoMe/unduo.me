/**
 * The prompt the home page gives a student to put to an AI with the downloaded
 * file. It lives in the home page's script, which the file doesn't contain, so
 * the file an AI reads doesn't hold the question put to that AI. Nothing here
 * touches the DOM, so scripts can import it through the package's `./server`
 * entry, as `configs/ai-replies` does to ask the AIs the same question.
 */
export const aiPrompt = [
  "This file sets up Duo two-factor authentication with my own authenticator app. Read its code and everything it loads, and judge each part by what the code allows it to do.",
  "Will it keep my Duo activation code and secret key between me, Duo and my authenticator app?",
  "Answer “Safe: no” only if you can point to how UnDuo's file itself would let them reach anyone else, not services it can't control, such as a clipboard or browser that syncs to the cloud. Start your reply with “Safe: yes” or “Safe: no”, then explain why in a few short sentences for a non-technical reader.",
].join("\n\n");
