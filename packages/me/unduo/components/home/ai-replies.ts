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
 * `vp run capture:ai` asks them, saves the screenshots and records each
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
      "Safe: yes — for this exact file, I found no route for UnDuo itself to send your activation code or secret key to another party.\n\nThe activation request is restricted to the Duo address from your input, and your authenticator QR code is generated locally. The downloaded setup component cannot make its own internet requests, and the page checks its results before using them; downloaded styles and pictures also have fixed fingerprints and loading restrictions. **Review limitation:** I couldn’t retrieve all external files, so my assessment of those components rests on their enforced permissions, not inspection of all their contents.\n\nI computed the uploaded file’s SHA-256 by running code. Matching independently computed hashes identify the same file contents to practical certainty: SHA-256 fingerprints every byte, with an extraordinarily small chance of different files sharing that fingerprint.\n\n7bd8ac57a58e94914e1d99516105390e390bdf5ea0b1e04aa8ac683edec9784c",
  },
  {
    id: "claude",
    name: "Claude",
    model: "Fable 5.1",
    verdict: "yes",
    reply:
      "**Safe: yes.**\n\nReading through everything in the file, I can’t find a path by which your activation code or key could reach anyone other than Duo and your authenticator app. In plain terms: the page is locked down so that it can only talk to two places on the internet, and neither of them ever sees your secret except Duo, who issued it in the first place.\n\nHere’s the reasoning, part by part:\n\n- **Where the page is allowed to send anything.** A security policy at the top of the file tells the browser: no outside scripts, no connections except downloading five fixed files from jsDelivr (the setup plugin, a stylesheet, four screenshots), and forms/frames may only go to *.duosecurity.com. Those jsDelivr downloads are verified by a fingerprint and happen when the page opens, before you’ve pasted anything, so they can’t carry your data. The page also refuses to start unless it confirms the browser is enforcing this policy.\n- **The only thing sent to a server.** That’s the activation form, which goes directly to Duo’s own api-….duosecurity.com address. The script checks that address against a strict pattern, requires it to match what you pasted from your Duo portal, pins the page to that one Duo host for the rest of the session, and adds a second policy so no other host is allowed. Duo’s reply lands in a fully sandboxed box the page can’t read; you copy it across yourself.\n- **The setup plugin (the WebAssembly download).** The page treats it as untrusted. It’s given only eight tiny functions for passing text in and out, so it has no way to make a network request. Every result it returns is checked: button text and messages must come from a fixed list, the Duo address must be one you pasted, and the authenticator link must be otpauth:// with a secret that came from Duo’s pasted reply. So even a malicious plugin could only break the setup, not leak it.\n- **Your key’s exits.** It becomes a QR code drawn locally, a text you can reveal, and an otpauth:// link that opens your authenticator app. The page never changes its own web address after loading, never uses browser storage, and never copies the key to the clipboard (it only copies the portal link). QR codes and screen-share frames are decoded locally and wiped.\n\nTwo caveats on scope, not on safety: I can read the HTML and its inline scripts but not the plugin’s bytes or the CDN files; the design above means that doesn’t matter for leakage. And as you said, anything outside this file (a syncing clipboard, browser history of the Duo tab, your authenticator app’s own storage) is beyond what the file controls.\n\nOn the P.S.: this conversation has no code execution, so I can’t compute the SHA-256 and won’t guess one. If you want to check, run shasum -a 256 <file> (macOS/Linux) or certutil -hashfile <file> SHA256 (Windows). A SHA-256 hash is a fingerprint of a file’s exact contents: changing even one character produces a completely different hash, and nobody can practically make two different files with the same one. So if your hash matches the one in UnDuo’s screenshots, you’re looking at the identical file, regardless of its filename.",
  },
  {
    id: "gemini",
    name: "Gemini",
    model: "3.1 Pro",
    verdict: "yes",
    reply:
      "Safe: yes.\n\nThe file includes strict, built-in security rules that force your web browser to only communicate with Duo's official servers. All the processing required to set up your authenticator app happens locally on your device, and the code explicitly blocks any attempts to send your secret keys or activation data anywhere else.\n\nI do not currently have the ability to run code to compute the file's SHA256 hash for you. However, a SHA256 hash acts as a unique digital fingerprint; if you compute the hash yourself and it matches the expected one, it guarantees the files are byte-for-byte identical. Even a single altered, added, or invisible character would produce a completely different hash, ensuring your copy hasn't been tampered with.",
  },
];
