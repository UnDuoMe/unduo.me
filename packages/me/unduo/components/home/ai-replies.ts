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
      "Safe: yes — I found no code path that sends your activation code or secret key to UnDuo or another third party. Activation is restricted to Duo, and your authenticator QR code is generated locally.\n\nThe downloaded program has no direct network access, and its results must pass checks before use.\n\n**Review limitation:** I could not retrieve the external files, so I assessed their enforced restrictions rather than their contents. Disable clipboard syncing before copying Duo’s reply, and avoid the optional new-tab route to keep the activation address out of synced history.\n\nI computed the SHA-256 below from the uploaded file’s bytes. Matching hashes are overwhelmingly strong evidence of byte-for-byte identical files—not proof of safety.\n\n053b5b4cbf3ccfbe4512c454f9bd2b70a050349e5e5ffe37ee8f63e396627777",
  },
  {
    id: "claude",
    name: "Claude",
    model: "Fable 5.1",
    verdict: "yes",
    reply:
      'Safe: yes.\n\nI read the whole file: the security policy at the top, all six scripts, and the rules it applies to the one piece of code it downloads. Here is what matters, in plain terms:\n\n- Nothing in the page can “phone home.” The browser policy at the top of the file lists exactly who the page may talk to: Duo’s own servers (for the activation), and one fixed set of files on a public file host (jsDelivr) for its stylesheet, pictures and setup module. Each of those downloads is pinned to an exact fingerprint, so if anyone changed them the browser would refuse to load them. The page can’t load any other scripts, can’t run code hidden in attributes, and I found no code that stores your data in the address bar, cookies or browser storage.\n- The one part I couldn’t read is locked in a box. The step-by-step logic is a downloaded WebAssembly module whose contents aren’t in this file. But the page gives it no way to reach the internet at all: its only abilities are to receive text and hand back text, and the page checks every answer it gives against strict rules. The only two things its output can affect that leave your browser are (1) the address the activation is sent to, which must be a Duo server and must match the code you pasted, and (2) the otpauth://link for your authenticator app, whose secret must match what Duo actually replied. So even a malicious module could only make setup fail, not leak anything.\n- Duo’s reply never touches the page’s code. It appears in a sealed box that scripts can’t read, and you copy it across by hand. Your key goes only to the QR code and setup key shown on screen, both drawn locally.\n- The portal link is a real utoronto.ca address, so it can’t be a look-alike sign-in page.\n\nTwo caveats that are about your computer, not the file: the reply passes through your clipboard (clear it afterwards if your clipboard syncs to other devices or keeps a history), and if you pick the “open in a new tab” option, that tab’s address holds the activation code in your browser history, though Duo accepts each code only once.\n\n**On the hash:** I can’t run code in this conversation, so I can’t compute the file’s SHA-256 here. You can do it yourself: on a Mac or Linux, shasum -a 256 "filename.html"; on Windows, certutil -hashfile "filename.html" SHA256. A SHA-256 hash is a fingerprint of a file’s exact bytes: changing even one character produces a completely different value, and it’s not practical to make two different files share one. So if the hash you compute matches the one in UnDuo’s screenshots, the file you have is byte-for-byte the same file the other AIs reviewed.',
  },
  {
    id: "gemini",
    name: "Gemini",
    model: "3.1 Pro",
    verdict: "yes",
    reply:
      "Safe: yes.\n\nThe file named \"UnDuo - University of Toronto.html\" uses a strict set of browser rules called a Content Security Policy. This acts like a digital bouncer that physically prevents the page from sending your information anywhere except directly to Duo's official servers. Additionally, the code responsible for processing your QR code is locked inside a restricted sandbox that cannot access the internet, ensuring your secret key never leaves your own browser.\n\n**Regarding the file's SHA256 hash:** I do not have a code execution tool available in this environment to calculate the exact mathematical hash of the provided text. However, a SHA256 hash functions as a unique digital fingerprint. If the hash of your file matches the official one, it guarantees that the files are identical down to the exact byte, proving the code has not been tampered with or modified.",
  },
];
