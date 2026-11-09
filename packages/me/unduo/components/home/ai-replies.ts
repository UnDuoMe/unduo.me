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
 * What ChatGPT, Claude and Gemini answered when given the setup file, saved as
 * `UnDuo - Other.html` so it names no school, and `aiPrompt`, each in a temporary chat with its strongest model.
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
      "Safe: yes. The file restricts activation to your Duo server and generates your authenticator QR code locally. Its downloaded setup program cannot contact servers directly, and the page checks its outputs before using them. Styles and images are also restricted; I found no code-controlled route for them to upload either secret.\n\nI couldn’t retrieve every external file, so this verdict rests on the restrictions this HTML enforces—not a claim that I inspected every downloaded byte.",
  },
  {
    id: "claude",
    name: "Claude",
    model: "Fable 5.1",
    verdict: "yes",
    reply:
      "Safe: yes\n\nReading the file and the files it fetches, the only place your activation code can go is Duo itself, and the only places your key can go are this page's screen and the QR code or link you hand to your authenticator app.\n\nHere is why, in plain terms:\n\n- **The page locks its own doors.** A security policy at the top tells the browser: run only the scripts written in this file, send forms only to Duo (*.duosecurity.com), download only from one frozen folder on jsDelivr, and load no outside images or fonts. The browser enforces this, so even a bug in the page's code could not send data somewhere else.\n- **The Duo request is built by the page, not by anything downloaded.** The script checks that the address is a Duo api-…duosecurity.com host, that the code in it actually came from the QR code you pasted, and that the host never changes during a session. The fields it sends are fixed: a fresh public key and the device details Duo Mobile sends.\n- **Duo's reply stays in a sealed box.** It appears in a locked frame the page cannot read; you copy it across yourself. The page never puts the code or key in its web address, in browser storage, or on the clipboard (its only copy button copies the portal link).\n- **The downloaded \"brain\" is caged.** The setup logic (a WebAssembly module from jsDelivr) is only loaded if its fingerprint matches, is given no network or browser access at all, and every answer it returns is checked against strict rules before the page uses it. It can pick which step or message to show, but it cannot invent a new destination, show a different key, or leak text that didn't come from what you pasted. I judged it by that cage rather than reading its bytes, which is the point: it holds whatever the module contains.\n- **The stylesheets and screenshots are inert.** I fetched unduo's stylesheet and screenshot list: the stylesheet contains no outside links or imports, and the list holds only plain file names and fingerprints. The UIkit stylesheet is the published package pinned by fingerprint, and the policy would block any outside request from a stylesheet anyway.\n\nWhat this does not cover, because the file cannot control it: your clipboard and browser (if they sync, Duo's reply passes through them), your authenticator app's own storage, and Duo's servers, which necessarily receive the activation code. Use a private window and clear the clipboard afterward, as the page itself suggests.",
  },
  {
    id: "gemini",
    name: "Gemini",
    model: "3.1 Pro",
    verdict: "yes",
    reply:
      "Safe: yes\n\nThe UnDuo file processes your setup entirely locally inside your web browser and uses a strict built-in firewall known as a Content Security Policy. This policy explicitly blocks the page from sending your information anywhere except directly to Duo's official servers (*.duosecurity.com). Furthermore, the few visual and processing files it downloads to function are locked by exact cryptographic fingerprints, meaning it is mathematically prevented from loading altered code, trackers, or hidden connections that could steal your keys.",
  },
];
