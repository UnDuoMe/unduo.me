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
      "Safe: yes. The file sends activation only to the checked Duo server and creates your authenticator’s QR code locally. Its downloaded helper cannot contact servers directly, its outputs are checked before use, and browser restrictions block styles and images from sending your secrets elsewhere. I couldn’t retrieve the external downloads, so I assessed their enforced capabilities rather than inspecting their contents.\n\n**SHA-256, computed from your attachment:** Matching hashes are overwhelming evidence that the files contain exactly the same bytes; different files sharing this fingerprint is theoretically possible but extraordinarily unlikely.\n\n4372b975c2097243b49cdd91534b9ed21ab0bef835078ae9665c0e8928732173",
  },
  {
    id: "claude",
    name: "Claude",
    model: "Fable 5.1",
    verdict: "yes",
    reply:
      '**Safe: yes.**\n\nThe file is a single web page whose first line tells your browser a strict set of rules (a “Content-Security-Policy”), and the browser enforces those rules no matter what the rest of the page tries to do. Under those rules the page can only run the scripts written inside the file itself, can only download four fixed, fingerprint-checked files from a public CDN (a small WebAssembly program, a stylesheet and some example screenshots, none of which can carry your data in the request), and can only submit a form to Duo’s own *.duosecurity.com servers. Nothing else on the internet is reachable from this page. The page even tests that your browser enforces these rules before it starts, and refuses to run if it doesn’t.\n\nYour activation code goes in exactly one direction: your browser posts it, together with a freshly generated public key and some fixed “Duo Mobile” device details, straight to the Duo address that was inside the QR code you pasted. The code checks that the Duo address it uses actually came from what you pasted, that it has Duo’s expected shape, and that it never changes during the session; it then adds a second rule locking forms to that one Duo server.\n\nDuo’s reply, which contains your secret key, lands in a locked-down box on the page that the page’s own scripts cannot read; you copy it across by hand. Once pasted, the key is only ever turned into three things: a QR code drawn locally by the page’s own code, an otpauth:// link that only your authenticator app opens, and the setup-key text on screen. The page never copies the key to your clipboard (only the portal link), never puts it in the address bar or browser history, and never stores it, so closing the tab wipes it.\n\nThe one part I can’t read, the WebAssembly program it downloads, is deliberately boxed in: the page refuses to run it unless it imports only eight tiny helper functions that can do nothing but pass text in and out, and every answer it gives is checked against a fixed list of allowed screens, messages and addresses before it’s used. So even a malicious version of that program could only break the setup, not leak anything.\n\nThis judgment covers UnDuo’s file only. Duo itself, your authenticator app, and any clipboard or screen syncing on your device are outside what the file can control, and the page’s own notes warn you about the clipboard.\n\n**P.S.** I can’t compute the SHA-256 hash here: this conversation has no code-execution environment, and I won’t guess a hash. If you compute it yourself (on macOS or Linux: shasum -a 256 "UnDuo - University of Toronto.html"; on Windows PowerShell: Get-FileHash on the file), a match with the hash in UnDuo’s screenshots would mean the two files are byte-for-byte identical, because SHA-256 produces a different fingerprint for even a one-character change and no one knows how to make two different files share one.',
  },
  {
    id: "gemini",
    name: "Gemini",
    model: "3.1 Pro",
    verdict: "yes",
    reply:
      "Safe: yes\n\nThe file \"UnDuo - University of Toronto.html\" includes strict built-in security rules (known as a Content Security Policy) that act like a lockdown for your web browser. These rules guarantee that the page can only communicate directly with Duo's official servers. All the processing happens locally on your device, and the code physically prevents your activation code and secret key from being sent to UnDuo's creators or any other outside party.\n\n(Note: I do not currently have the ability to execute code to compute the exact SHA256 hash of your file, but mathematically, a SHA256 hash acts as a unique digital fingerprint; if two files have the exact same hash, it guarantees their contents are identical down to the last byte.)",
  },
];
