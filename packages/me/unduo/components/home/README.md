# @-/me.unduo.components.home

The website's home page. `startHomePage()` builds it in the page's `#root` as a landing page. Its hero fills most of the first screen, centered: the name, a one-line description, three short lines (UnDuo is a single-file webpage designed to be fully secure; **Don't take our word for it.** You'll be able to check for yourself; select your university below), and a searchable Select Your University dropdown, with GitHub's mark linking to the source at the bottom. Typing in the field filters the institutions under it, and choosing one with Enter or a click opens a modal dialog for it that shows one step at a time, with Back from step 2 on. Escape, the close button and Done on the last step close it, and focus returns to the field. It has no stepper; the institution's setup file keeps its own.

Under the hero (`home-landing.ts`):

- **We asked ChatGPT, Claude and Gemini**: a card per AI with its model, its verdict ("Safe: yes"), a sentence quoted from its reply and the date, from `aiReplies` in `ai-replies.ts`. Each card shows a screenshot of the whole conversation, the University of Toronto file and the prompt above the reply, which opens larger in a dialog. The screenshots are `ai-reply-<id>.webp` in `apps/unduo-web/src/assets/`, taken by `vp run capture:ai` ([`configs/ai-replies`](../../configs/ai-replies)). The build publishes them with the other assets and `homeMount()` (the `./server` entry) puts them in an `#ai-reply-images` template with their SHA-256; `showScreenshot()` fetches each only if its hash matches and shows it as a blob: URL, as the setup file does with its screenshots.
- **How UnDuo Works**: the three steps, numbered.
- A **Select Your University** button that scrolls back to the search and focuses it.

1. **Overview**: how UnDuo works, in three steps, and that the next step lets the student check it, with Continue.
2. **Verify**: download `<institution name>.html` from `./files/<WHED number>` but don't run it yet, then drag it into an AI and copy the prompt.
3. **Continue**: open the file once the AI gives the thumbs up. It has its own stepper from there. The page's closing advice follows.

`?university=` holds the institution whose dialog is open, as an id or an unambiguous name, and `#step=` the step, so Back, Forward, reload and shared links work. A link with an institution but no step opens the overview, and closing the dialog drops both from the address. An unpublished institution opens no dialog. Step names from earlier versions of the page (`university`, `download`, `check`, `open`, `safe`) still lead to their new steps.

The prompt, `aiPrompt` in `ai-prompt.ts`, lives in this page's script, which the file doesn't contain, so the file an AI reads doesn't hold the question put to that AI. A test enforces that. It touches no DOM, so the package's `./server` entry exports it for scripts: `configs/ai-replies` asks ChatGPT, Gemini and Claude the same question and screenshots their replies.
