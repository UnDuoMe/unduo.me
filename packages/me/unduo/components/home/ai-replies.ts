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
      "Safe: yes. The file restricts your activation code to a checked Duo address and creates your authenticator’s QR code locally, without sending the key to a QR-code service. Its downloaded setup module cannot contact servers independently, and the file checks its results before allowing a Duo request or authenticator link. The downloaded styles and example pictures likewise have no permitted route to transmit your secrets. I couldn’t retrieve every external file, so this verdict rests on the restrictions enforced by this file—not a complete inspection of every downloaded byte.",
  },
  {
    id: "claude",
    name: "Claude",
    model: "Fable 5.1",
    verdict: "yes",
    reply:
      "I'll check the page's code against the files it pulls from jsDelivr, then give you the verdict.\n\n**Safe: yes.**\n\nNothing in this file gives your activation code or secret key a way to reach anyone except Duo and your authenticator app. The page locks down the browser so that it can only send a form to your organization's Duo server (the activation, which is the whole point), show Duo's reply in a sealed box, and download its own fixed support files from jsDelivr. Those downloads are \"pinned\": the browser refuses any file whose fingerprint doesn't match the one written in the page, and the fingerprints in the page match what jsDelivr publishes for that exact version. The downloads carry no information of yours either way, since their addresses are fixed and never change based on what you paste.\n\nThe one piece of code I couldn't read line by line is the small setup module it downloads, but the page is built so that it doesn't have to be trusted. That module is given no way to talk to the network, and every result it produces is checked by the page before use: the only server address it can name must be a Duo server whose host and code appeared in what you pasted, and the key it hands to your authenticator must come from the Duo reply you pasted. At worst it could make setup fail; it couldn't redirect your code or key anywhere.\n\nThe key itself appears only in the QR code and link the page draws for your authenticator app and never goes into the page's address, browser storage, or the clipboard (the page copies only the portal link). I'll note the things outside the file's control, as you asked me to: you copy Duo's reply by hand, so a clipboard that syncs or keeps a history would see it; jsDelivr sees your IP address but none of your codes; and Duo, of course, receives the activation as it would from the real Duo Mobile app. One honest limitation of the tool rather than a safety issue: it only produces passcodes, not Duo Push approvals, so keep your existing Duo method until a code from your new app works.",
  },
  {
    id: "gemini",
    name: "Gemini",
    model: "3.1 Pro",
    verdict: "yes",
    reply:
      'Safe: yes.\n\nThe "UnDuo - University of Toronto.html" file uses a strict built-in browser rule called a Content Security Policy to act as a digital bouncer. This rule physically blocks the webpage from sending your information anywhere except directly to Duo\'s official servers. Additionally, the internal code that handles your setup is heavily locked down and checked for tampering, restricting it to only showing the secret key on your screen or preparing it for your clipboard. Because all the actual processing happens locally on your device and the page is blocked from contacting unauthorized outside networks, your data remains safely restricted to you, Duo, and your authenticator app.',
  },
];
