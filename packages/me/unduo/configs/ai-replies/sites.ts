import { bringToFront, type ChromeWindow, frontApp, sleep } from "#chrome";
import { findLine, treeLines } from "#tree";

export interface SiteOptions {
  /**
   * Whether the run may bring Chrome to the front: for a moment to set
   * ChatGPT's model to Pro, whose menu opens only for a foreground click, and for a few
   * seconds to choose the file in Claude's file picker. Anything you type then
   * goes to Chrome, so pass it only when you're away from the keyboard. Without
   * it ChatGPT keeps the model chosen last, and Claude gets the file pasted.
   */
  focus: boolean;
}

/** An AI site, signed in in your Chrome, and how to ask it in a chat it doesn't keep. */
export interface Site {
  id: "chatgpt" | "gemini" | "claude";
  name: string;
  /** Open a new temporary chat and return the model it will answer with. */
  start(window: ChromeWindow, options: SiteOptions): Promise<string>;
  /** Attach the file at `path`; by default it's pasted, as a file copied in Finder pastes. */
  attach?(window: ChromeWindow, path: string, options: SiteOptions): Promise<void>;
  /** The prompt box, the attached file, and the send button, as accessibility lines. */
  box: RegExp;
  attached(fileName: string): RegExp;
  send: RegExp;
  /** An upload still in progress. */
  uploading?: RegExp;
  /**
   * What to cut from the window screenshot, in points: the site's sidebar on
   * the left, and at the bottom its prompt box and the arrow that offers to
   * scroll down. The browser's toolbar is found in the image.
   */
  crop: { left: number; bottom: number };
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Set ChatGPT's model slider to its last stop, Pro, its strongest. The menu
 * opens only for a foreground click, so Chrome comes to the front for a moment;
 * the app you were using goes back in front after.
 */
async function chatGptPro(window: ChromeWindow) {
  const front = frontApp();
  try {
    window.click(window.find(/^pop up button Select ChatGPT model$/)!, { restore: true });
    await sleep(800);
    for (let step = 0; step < 6; step++) {
      const level = treeLines(window.tree())
        .map(({ text }) => /^text (.+), (\d) of (\d)\.$/.exec(text))
        .find(Boolean);
      if (!level) throw new Error("ChatGPT's model menu didn't open.");
      if (level[2] === level[3]) {
        window.pressKey("Escape", { restore: true });
        return level[1]!;
      }
      window.pressKey("Right", { restore: true });
      await sleep(300);
    }
    throw new Error("ChatGPT's model slider didn't move.");
  } finally {
    bringToFront(front);
  }
}

/**
 * Attach a file through Claude's upload dialog and the macOS file picker. Claude
 * names a pasted file with a timestamp in front, which a dropped or chosen file
 * doesn't get. The picker takes only foreground input, so Chrome comes to the
 * front for a few seconds; the app you were using goes back in front after.
 */
async function claudeUpload(window: ChromeWindow, path: string) {
  const front = frontApp();
  const restore = { restore: true };
  try {
    window.click(
      window.find(/^pop up button( \(expanded\))? Add files, connectors, and more$/)!,
      restore,
    );
    window.click(await window.waitFor(/^menu item Upload or add files$/, 10_000), restore);
    window.click(await window.waitFor(/^button Choose files$/, 10_000), restore);
    await window.waitFor(/^sheet open$/, 10_000);
    // Go to Folder takes a file's whole path and selects the file.
    window.hotkey("CmdOrCtrl+Shift+G", restore);
    await sleep(800);
    const field = window.focused();
    if (!field) throw new Error("The file picker's Go to Folder field didn't open.");
    window.setValue(field, path, restore);
    window.pressKey("Return", restore);
    window.click(await window.waitFor(/^button Open$/, 10_000), restore);
  } finally {
    bringToFront(front);
  }
}

export const sites: Site[] = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    async start(window, { focus }) {
      await window.go("https://chatgpt.com/?temporary-chat=true");
      await window.waitFor(/^heading Temporary chat$/);
      if (!window.find(/^pop up button Unpersonalized$/))
        throw new Error("ChatGPT's temporary chat isn't unpersonalized.");
      return focus ? chatGptPro(window) : "the model chosen last (not checked)";
    },
    box: /^text entry area \(settable\) Ask ChatGPT/,
    attached: (fileName) => new RegExp(`^button Remove ${escape(fileName)}$`),
    uploading: /^progress indicator Uploading/,
    send: /^button Send$/,
    crop: { left: 52, bottom: 150 },
  },
  {
    id: "gemini",
    name: "Gemini",
    async start(window) {
      await window.go("https://gemini.google.com/app");
      await window.waitFor(/^button Temporary chat$/);
      // The button does nothing until the page settles.
      await sleep(4000);
      window.click(window.find(/^button Temporary chat$/)!);
      await window.waitFor(/Temporary chats don't appear/);
      const model = findLine(window.tree(), /^button Open mode picker, currently (.+)$/);
      return /currently (.+)$/.exec(model?.text ?? "")?.[1] ?? "unknown";
    },
    box: /^text entry area \(settable\) Enter a prompt for Gemini/,
    // Its chip shortens the name, but keeps its close button.
    attached: () => /^button close \S/,
    send: /^button Send message$/,
    crop: { left: 0, bottom: 150 },
  },
  {
    id: "claude",
    name: "Claude",
    async start(window) {
      await window.go("https://claude.ai/new?incognito");
      await window.waitFor(/^text You’re incognito$/);
      const model = findLine(window.tree(), /^pop up button Model: (.+)$/);
      return /Model: (.+)$/.exec(model?.text ?? "")?.[1] ?? "unknown";
    },
    // Without the foreground, paste it, and Claude names it with a timestamp in front.
    attach: (window, path, { focus }) =>
      focus
        ? claudeUpload(window, path)
        : Promise.resolve(
            window.pasteFile(/^text entry area \(settable\) Write your prompt to Claude/, path),
          ),
    box: /^text entry area \(settable\) Write your prompt to Claude/,
    // A pasted file's name gets a timestamp in front.
    attached: (fileName) => new RegExp(`^button Remove (?:\\d+_)?${escape(fileName)}$`),
    send: /^button Send( message)?$/,
    crop: { left: 0, bottom: 150 },
  },
];
