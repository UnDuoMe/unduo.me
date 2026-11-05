/** What an AI answered when given a setup file and `aiPrompt`. */
export interface AiReply {
  /** Names the screenshot, `ai-reply-<id>.webp` in `apps/unduo-web/src/assets/`. */
  id: "chatgpt" | "claude" | "gemini";
  name: string;
  model: string;
  verdict: "yes" | "no";
  /**
   * The whole reply, word for word, as Markdown: paragraphs, `###` headings,
   * `-` and `1.` lists, and `**bold**`.
   */
  reply: string;
}

/**
 * What ChatGPT, Claude and Gemini answered when given the University of Toronto
 * file and `aiPrompt`, each in a temporary chat with its strongest model.
 * `vp run capture:ai --focus` asks them, saves the screenshots and records each
 * reply in `configs/ai-replies/results.json`. Copy a reply here whenever its
 * screenshot changes.
 */
export const aiReplies: AiReply[] = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    model: "Pro",
    verdict: "yes",
    reply:
      "Safe: yes — based on the restrictions this file enforces, I found no route for its code to send your secrets to an unrelated website. Activation is limited to the Duo server identified in your input, and the authenticator QR code is created locally.\n\nThe downloaded setup program cannot contact websites directly, and the page checks its results before allowing them to affect requests or links; downloaded styles and images are also restricted.\n\nI couldn’t retrieve that downloaded program itself, so this judgment rests on its enforced restrictions, not a complete inspection of its contents.",
  },
  {
    id: "claude",
    name: "Claude",
    model: "Fable 5.1",
    verdict: "yes",
    reply:
      "**Safe: yes.**\n\nI read the whole file, and I can't find any path by which your activation code or secret key could leave your browser for anyone but Duo and your authenticator app. Here's why, in plain terms:\n\nThe page has a strict \"security policy\" (a set of rules the browser enforces) that acts like a locked door. It lets the page talk to exactly three places: Duo's own servers (only to send the activation, and only to the one Duo address that came from your QR code), a fixed handful of files on jsDelivr (its setup code, styles and five example screenshots, each pinned to an exact fingerprint so they can't be swapped), and nothing else. The page even tests that the browser is enforcing these rules before it starts, and refuses to run if it isn't.\n\nThe two things it loads from outside, the WebAssembly setup module and the stylesheets, can't leak anything even if they were malicious. The module is deliberately boxed in: it's handed text (what you paste, or the text read from a QR code) and can only hand text back, and every piece of text it returns is checked against a fixed list of allowed messages, Duo's address format, and what you actually pasted, before the page uses it. It has no way to make a network request, change the page's address, or run code. The stylesheets can't make requests either, because the policy only allows images and fonts that are embedded in the page itself.\n\nYour key itself arrives in Duo's reply, which shows in a sealed box (a sandboxed frame the page can't read); you copy it across by hand. From there it only becomes a QR code drawn locally, a link you tap to open your authenticator, or text copied to your clipboard when you press a button. None of that touches a server. The page also never writes anything to its web address or to browser storage, so refreshing or closing the tab wipes it.\n\nOne thing to be aware of, which the page itself warns about: if you choose the optional \"open Duo's reply in a new tab\" button, that tab's address contains your activation code and will land in your browser history. The code only works once and the key isn't in the address, but if your history syncs across devices, use the default in-page box instead.\n\nThe usual limits apply: I can only vouch for this exact file and the fixed files it pins, not for a modified copy or a different version from the site.",
  },
  {
    id: "gemini",
    name: "Gemini",
    model: "3.1 Pro",
    verdict: "yes",
    reply:
      "Safe: yes.\n\nThe \"University of Toronto.html\" file uses strict security rules enforced by your web browser to guarantee it can only send information directly to Duo's official servers. All processing of your activation code and secret key happens locally on your own device. The file is explicitly programmed to block any outside network connections, meaning it is restricted from uploading or leaking your sensitive setup details to the tool's creator, any third party, or even your browser history.",
  },
];
