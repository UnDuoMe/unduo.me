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
      "Safe: yes. I found no route in this file that sends your activation code or secret key to an outside party: activation requests go directly to Duo, and the authenticator QR code is generated locally. The downloaded setup program has no direct internet access, and the page checks its outputs before using them—including restricting destinations to Duo and authenticator links. **I could not retrieve every external asset**, so this conclusion rests on the restrictions the file enforces, not a claim that I inspected every downloaded byte.\n\nSHA256, computed from your uploaded file:\n\nd10e7d26a34b026958a07e2d65e2be3f99dec4485c0f4179ec29079b5a301d4d\n\nMatching SHA256 hashes are overwhelmingly strong evidence that two files are byte-for-byte identical: the hash fingerprints their entire contents, and finding different contents with the same fingerprint is computationally infeasible.",
  },
  {
    id: "claude",
    name: "Claude",
    model: "Fable 5.1",
    verdict: "yes",
    reply:
      '**Safe: yes.**\n\nHere’s why, judging only what this file’s own code allows. The page is written so that the two sensitive things, your activation code and your secret key, have only one path out: the activation code goes in a form that can only be submitted to a Duo address (api-….duosecurity.com), with a fixed set of fields and a public key the page makes locally, and once a Duo address is chosen the page locks every form to that one address. Duo’s reply (which holds your key) lands in a sealed box the page itself can’t read, and you copy it across by hand. After that the key is only ever turned into text on screen, a QR picture drawn by the page’s own code, and an otpauth:// link for your authenticator app. Nothing copies the key to the clipboard (the only “copy” button copies the portal link), nothing writes it into the page’s address or browser storage, and the page’s security policy blocks every other kind of outside request, including from its stylesheets.\n\nThe one piece of code I can’t read directly is the downloaded WebAssembly “plugin” that runs the steps. But the page treats it as untrusted: it can’t make network requests at all, it only receives and returns text, and every result it returns is checked against a strict list before use. The Duo address it names must match something you pasted, the key it reports must match the reply you pasted, and every message it shows is from a fixed list. So even a hostile version of that plugin could break setup, but couldn’t send your code or key anywhere.\n\nThings outside the file (a syncing clipboard, a browser extension, whichever app opens otpauth:// links, Duo itself) aren’t covered by this, as you asked.\n\n**P.S.** I can’t attach a SHA-256 for this file: this conversation has no code execution, so I have no way to compute it rather than guess, and a guessed hash would be worthless. If you compute it yourself (shasum -a 256 "filename.html" on macOS/Linux, or Get-FileHash in PowerShell) and it matches the hash shown in UnDuo’s screenshots, the files are byte-for-byte identical: SHA-256 turns a file into a fixed-length fingerprint, and changing even one character anywhere produces a completely different fingerprint, with no practical way to make two different files share one. A matching hash is what would let you tie a verdict like this one to the exact file on your computer.',
  },
  {
    id: "gemini",
    name: "Gemini",
    model: "3.1 Pro",
    verdict: "yes",
    reply:
      'Safe: yes\n\nThe file "UnDuo - University of Toronto.html" uses a strict set of browser rules called a Content Security Policy (CSP) that actively blocks the page from sending your information anywhere except directly to Duo\'s official servers. The internal code that reads your QR codes and generates your keys runs entirely locally inside your browser in a locked-down sandbox, meaning it does not have the permissions required to connect to the internet or sneak data out in the background. Because of these hardcoded restrictions, your activation code and secret key never leave your device and remain strictly between your browser, your authenticator app, and Duo.\n\nP.S. I do not have the code-execution capabilities in this environment to securely compute the SHA256 hash of the provided text. However, a SHA256 hash acts as a highly sensitive digital fingerprint for data. If the hash of your file matches the hash of a verified safe version, it provides a mathematical guarantee that the files are completely identical down to the exact byte—meaning not a single letter, space, or hidden piece of malicious code has been altered or added.',
  },
];
