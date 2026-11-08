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
      "Safe: yes — I found no path in this file that sends your activation code or secret key to a third party. Activation is restricted to Duo, and your authenticator QR code is created locally in your browser. The downloaded setup code has no direct internet access and its outputs are checked; requests for styles and example images do not include your secrets. **I couldn’t retrieve every external file**, so my assessment of those parts relies on the restrictions this HTML enforces, not a complete inspection of their contents.\n\n**SHA-256, computed from your attachment:** Matching hashes are extremely strong evidence that the files are byte-for-byte identical, because the hash fingerprints the entire file; a coincidental match is extraordinarily unlikely.\n\n62029f7a0d6d8d47e32a7e06f88c9a17b482d79a3e82a1c15c52614eb0d9dacd",
  },
  {
    id: "claude",
    name: "Claude",
    model: "Fable 5.1",
    verdict: "yes",
    reply:
      '**Safe: yes.**\n\nI read the whole file: its security policy, the five inline scripts, and the rules it applies to the three things it downloads (a stylesheet, a WebAssembly “setup plugin” and some screenshots). Nothing in it gives your activation code or your key a path to anyone but Duo and your authenticator app.\n\nHere is why, in plain terms. The page’s browser security policy is a strict allow-list: the only place it may send anything is a Duo address of the form api-xxxxxxxx.duosecurity.com, and the only place it may download from is one fixed, hash-pinned folder on jsDelivr. The one request that carries your activation code is the form that posts it straight to the Duo host taken from your own QR code; the page checks that the code and host actually appeared in what you pasted, locks that host for the rest of the session, and the form’s other fields are fixed text with no room for anything else. Duo’s reply, which contains your key, lands in a sealed box (a sandboxed frame) that the page’s own code cannot read; you copy it out by hand. From then on the key only turns into a QR image built locally as a data: URL, an otpauth:// link for your authenticator app, and the key text shown on screen. The page never writes it to the address bar, browser storage, cookies, or the clipboard (the only “Copy” button copies the portal link). The downloaded plugin is treated as untrusted: it can only read the text the page hands it and return a result, and every result is checked against a fixed schema before use, so even a malicious plugin could at worst break the setup, not leak it. Pasted images and screen-share frames are decoded locally and only the QR text is kept. Nothing in the page uses innerHTML, eval, or inline event handlers.\n\nWhat I could not inspect: the actual bytes of the plugin, stylesheet and screenshots, since they are not in the file. But the file pins each to a SHA-256 and constrains what they can do, so that doesn’t change the verdict. The usual residual risks are outside UnDuo’s control: the Duo host name is visible to your network (as with any Duo login), and your clipboard or authenticator app handle the key after that.\n\nOn the hash: this conversation has no shell or code execution, so I can’t compute the file’s SHA-256, and I won’t guess one. If you compute it yourself (e.g. shasum -a 256 "UnDuo - University of Toronto.html" on a Mac, certutil -hashfile <file> SHA256 on Windows) and it matches the hash shown in UnDuo’s screenshots, the files are byte-for-byte identical: SHA-256 turns a file into a 64-character fingerprint, and changing even one character of the file produces a completely different fingerprint, so a match means the file those AIs reviewed is the same one you have.',
  },
  {
    id: "gemini",
    name: "Gemini",
    model: "3.1 Pro",
    verdict: "yes",
    reply:
      "Safe: yes.\n\nThe file contains a strict Content Security Policy that forces your web browser to only send data directly to Duo's official servers (https://*.duosecurity.com). The script that scans the QR code and manages your secret key runs entirely on your local device, and the page is explicitly blocked from sending your information to any other external website. Additionally, the external logic files it loads are locked using cryptographic hashes, which guarantees your browser will reject them if they are ever altered.\n\nWhile I cannot compute the SHA256 hash of the file because I lack a code execution tool in this environment, a SHA256 hash serves as a unique mathematical fingerprint for a file's exact contents. If the hash of your file matches the known hash of the official file, it guarantees that the files are identical byte-for-byte and have not been tampered with.",
  },
];
