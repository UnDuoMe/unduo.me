/**
 * The prompt the home page gives a student to put to an AI with the downloaded
 * file. It lives in the home page's script, which the file doesn't contain, so
 * the file an AI reads doesn't hold the question put to that AI. Nothing here
 * touches the DOM, so scripts can import it through the package's `./server`
 * entry, as `configs/ai-replies` does to ask the AIs the same question.
 */
export const aiPrompt = [
  "The attached file is from a website for setting up Duo two-factor authentication with my own authenticator app instead of Duo Mobile.",
  "Please read its code, including everything it loads and runs. Judge each part by what the code allows it to do or restricts it from doing.",
  "Will this file keep my Duo activation code and secret key safe, so they stay between me, Duo and my authenticator app?",
  "Answer “Safe: no” only if you can point to how the file would let them reach anyone else. Start your reply with “Safe: yes” or “Safe: no”, then explain why in a few short sentences to someone who may not be technical.",
  "P.S. UnDuo has screenshots of other AIs responding to this exact prompt, but the file isn't visible. If you have the ability to, attach the file's SHA256 hash at the end of your response (compute it by running code, not by guessing), and briefly explain why if the hashes match, it means the files are the same.",
].join("\n\n");
