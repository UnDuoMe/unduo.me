/** What an AI answered when given a setup file and `aiPrompt`. */
export interface AiReply {
  /** Names the screenshot, `ai-reply-<id>.webp` in `apps/unduo-web/src/assets/`. */
  id: "chatgpt" | "claude" | "gemini";
  name: string;
  model: string;
  verdict: "yes" | "no";
  /** A sentence from the reply, word for word as the screenshot shows it. */
  quote: string;
  askedOn: string;
}

/**
 * What ChatGPT, Claude and Gemini answered when given the University of Toronto
 * file and `aiPrompt`, each in a temporary chat. `vp run capture:ai` asks them
 * and saves the screenshots; `configs/ai-replies/results.json` records each
 * reply. Change a quote whenever its screenshot changes.
 */
export const aiReplies: AiReply[] = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    model: "Instant",
    verdict: "yes",
    quote: "The file's code restricts where your Duo activation code and secret key can go.",
    askedOn: "November 5, 2026",
  },
  {
    id: "claude",
    name: "Claude",
    model: "Sonnet 5.5",
    verdict: "yes",
    quote: "A tampered plugin could break setup, but it couldn’t send your code or key anywhere.",
    askedOn: "November 5, 2026",
  },
  {
    id: "gemini",
    name: "Gemini",
    model: "3.6 Flash",
    verdict: "yes",
    quote: "This file keeps your activation code and secret key safely contained in your browser.",
    askedOn: "November 5, 2026",
  },
];
