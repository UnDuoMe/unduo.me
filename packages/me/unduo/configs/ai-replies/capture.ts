import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aiPrompt } from "@-/me.unduo.components.home/server";
import { bringToFront, ChromeWindow, frontApp, sleep } from "#chrome";
import { cropToPage, showsWholePage, toWebp } from "#crop";
import { type Site, sites } from "#sites";
import {
  copyButton,
  finishedReply,
  holdsOnly,
  promptText,
  promptUnfolder,
  type Reply,
  replyMarkdown,
  showsChatList,
} from "#tree";

export interface CaptureOptions {
  /** The setup file to attach, and the name a student's browser saves it under. */
  file: string;
  fileName: string;
  /** Where the home page's screenshots go, as `ai-reply-<site>.webp`. */
  images: string;
  /** The file that records each site's reply. */
  results: string;
  /** Where the window screenshots go, uncropped and cropped, as PNG. */
  raw: string;
  sites: Site["id"][];
  /** Whether Chrome may come to the front for a moment, to set ChatGPT's model. */
  focus: boolean;
}

export interface Capture {
  site: Site["id"];
  name: string;
  model?: string;
  verdict?: Reply["verdict"];
  /**
   * The reply as Markdown: what its Copy button copies with `focus`, else
   * rebuilt from the accessibility tree.
   */
  reply?: string;
  /** Whether the reply is whole: the tree sums up some long paragraphs cut short. */
  whole?: boolean;
  /** The screenshot's file name in `images`: one screenshot of the whole conversation. */
  screenshot?: string;
  /** The page's zoom in that screenshot, in percent: as far out as it took to fit. */
  zoom?: number;
  /** Why the site couldn't be asked, if it couldn't. */
  error?: string;
  capturedAt: string;
  /** The attached file's name and SHA-256. */
  file: { name: string; sha256: string };
}

/**
 * Wait until the reply has a verdict, nothing is still writing it, and it reads
 * the same twice. ChatGPT Pro can think for twenty minutes or more.
 */
async function waitForReply(window: ChromeWindow, timeoutMs = 45 * 60_000) {
  const end = Date.now() + timeoutMs;
  let last: Reply | undefined;
  for (;;) {
    const reply = finishedReply(window.tree());
    if (reply && last && reply.text === last.text) return reply;
    last = reply;
    if (Date.now() > end) throw new Error("No finished reply.");
    await sleep(3000);
  }
}

/**
 * The reply as its Copy button copies it, Markdown, or nothing if the clipboard
 * doesn't then hold a reply with a verdict. A page writes to the clipboard only
 * while it has focus, so Chrome comes to the front for a moment.
 */
async function copyReply(window: ChromeWindow, tree: string, reply: Reply) {
  const button = copyButton(tree, reply);
  if (!button) return undefined;
  const marker = `unduo-${Date.now()}`;
  execFileSync("pbcopy", { input: marker });
  const front = frontApp();
  try {
    window.click(button, { restore: true });
    await sleep(1500);
  } finally {
    bringToFront(front);
  }
  const text = execFileSync("pbpaste", { encoding: "utf8" }).trim();
  return text !== marker && /\bSafe:\W*(?:yes|no)\b/i.test(text) ? text : undefined;
}

/**
 * The page's width in CSS pixels at every zoom: Chrome's first window on a
 * 1728-point-wide screen is 871 points wide, and the sites lay a page this
 * wide out with their sidebars closed.
 */
const pageWidth = 880;

/**
 * Screenshot the whole conversation, from the file and the prompt down to the
 * end of the reply, as one window screenshot, nothing joined. The prompt is
 * unfolded first. A window can't be taller than the screen, so the page zooms
 * out one of Chrome's steps at a time, the window narrowing to keep the page
 * `pageWidth` CSS pixels wide (down to Chrome's 500 points), until a scroll
 * from the top brings in nothing but blank space. The screenshot leaves out
 * only the browser's toolbar and the strips that show the signed-in account.
 * The site's zoom goes back to 100% after.
 */
async function screenshotWhole(window: ChromeWindow, site: Site, raw: string) {
  const unfolder = promptUnfolder(window.tree(), aiPrompt);
  if (unfolder) {
    window.click(unfolder);
    await sleep(1500);
    if (promptUnfolder(window.tree(), aiPrompt))
      throw new Error(`${site.name}'s prompt didn't unfold.`);
  }
  /**
   * Click the prompt's text, which does nothing on the sites. Once, ChatGPT
   * re-drew its prompt under a click that unfolded it and took the pointer's next
   * move as a drag: it selected text and wouldn't scroll. A click clears that.
   */
  const settle = async () => {
    const text = promptText(window.tree(), aiPrompt);
    if (text) window.click(text);
    await sleep(1000);
  };
  await settle();
  const shoot = (name: string) => {
    const shot = window.screenshot();
    const path = join(raw, `${site.id}-${name}.png`);
    copyFileSync(shot.path, path);
    return { path, scale: shot.scale };
  };
  // A scroll that brings in nothing proves the page fits only if scrolling works at all.
  let moved = false;
  let settled = false;
  try {
    for (;;) {
      const zoom = window.zoom();
      await window.resize((pageWidth * zoom) / 100);
      window.scrollMiddle("up", 50);
      await sleep(2000);
      const top = shoot(`${zoom}-top`);
      window.scrollMiddle("down", 50);
      await sleep(2000);
      const end = shoot(`${zoom}-end`);
      if (showsWholePage(top.path, end.path, top.scale)) {
        if (!moved && !settled) {
          settled = true;
          await settle();
          continue;
        }
        if (!moved)
          throw new Error(
            `Scrolling didn't move ${site.name}'s page, so the screenshot may not hold the whole conversation.`,
          );
        if (showsChatList(window.tree()))
          throw new Error(
            `${site.name} shows a list of chats at ${zoom}%; no screenshot was saved.`,
          );
        const cropped = join(raw, `${site.id}-cropped.png`);
        // The account's strips, in CSS pixels, are this many points at this zoom.
        cropToPage(top.path, cropped, top.scale, {
          left: (site.account.left * zoom) / 100,
          bottom: (site.account.bottom * zoom) / 100,
        });
        return { cropped, zoom };
      }
      moved = true;
      if (zoom <= 25)
        throw new Error(`${site.name}'s conversation doesn't fit the window even at 25%.`);
      await window.zoomOut();
    }
  } finally {
    await window.resetZoom();
    await window.resize(pageWidth);
  }
}

/** Ask `site` about the file in a new temporary chat, then screenshot the whole conversation. */
async function ask(window: ChromeWindow, site: Site, upload: string, options: CaptureOptions) {
  await window.resize(pageWidth);
  const model = await site.start(window, { focus: options.focus });
  // A run that stopped partway can leave the site zoomed out.
  if (window.zoom() !== 100) await window.resetZoom();
  if (site.attach) await site.attach(window, upload, { focus: options.focus });
  else window.pasteFile(site.box, upload);
  await window.waitFor(site.attached(options.fileName));
  const end = Date.now() + 60_000;
  while (site.uploading && window.find(site.uploading)) {
    if (Date.now() > end) throw new Error(`${site.name} didn't finish uploading.`);
    await sleep(1000);
  }
  await sleep(1500);
  window.clear(site.box);
  window.pasteText(site.box, aiPrompt);
  await sleep(2000);
  // Send nothing but the prompt: stray keys, such as typing that reached Chrome
  // while it was in front, would go with it.
  if (!holdsOnly(window.tree(), site.box, aiPrompt))
    throw new Error(`${site.name}'s prompt box doesn't hold exactly the prompt; nothing was sent.`);
  window.click(await window.waitFor(site.send, 30_000));
  await waitForReply(window);
  // Keep the tree the reply's text comes from, to check it against the page.
  const tree = window.tree();
  writeFileSync(join(options.raw, `${site.id}-tree.txt`), tree);
  const reply = finishedReply(tree)!;
  const copied = options.focus ? await copyReply(window, tree, reply) : undefined;
  const { markdown, whole } = copied ? { markdown: copied, whole: true } : replyMarkdown(tree)!;
  // The whole conversation, from the file and prompt down to the end of the reply,
  // in one screenshot.
  window.dismissInfobar();
  const { cropped, zoom } = await screenshotWhole(window, site, options.raw);
  const screenshot = `ai-reply-${site.id}.webp`;
  toWebp(cropped, join(options.images, screenshot));
  return {
    site: site.id,
    name: site.name,
    model,
    verdict: reply.verdict,
    reply: markdown,
    whole,
    screenshot,
    zoom,
  };
}

/**
 * Ask each site, signed in in your Chrome, the home page's prompt about the
 * setup file, as a student would: a temporary chat, the file pasted in as an
 * attachment and the prompt pasted from the clipboard. Chrome works in a
 * window of its own, behind the app you're using. The clipboard's text is put
 * back afterward; anything else on it is lost.
 */
export async function captureAiReplies(options: CaptureOptions) {
  mkdirSync(options.raw, { recursive: true });
  const upload = join(mkdtempSync(join(tmpdir(), "unduo-ai-")), options.fileName);
  const file = {
    name: options.fileName,
    sha256: createHash("sha256").update(readFileSync(options.file)).digest("hex"),
  };
  copyFileSync(options.file, upload);
  const clipboard = execFileSync("pbpaste", { encoding: "utf8" });
  const window = await ChromeWindow.open("about:blank");
  const captures: Capture[] = [];
  try {
    for (const id of options.sites) {
      const site = sites.find((site) => site.id === id);
      if (!site) throw new Error(`No site ${id}.`);
      // One site failing, as when it renames a button, doesn't stop the others.
      captures.push(
        await ask(window, site, upload, options).then(
          (capture) => ({ ...capture, capturedAt: new Date().toISOString(), file }),
          (error: Error) => {
            // What the page showed when it failed, to tell a slow reply from a changed page.
            try {
              writeFileSync(join(options.raw, `${site.id}-failed-tree.txt`), window.tree());
            } catch {
              // The window may be gone.
            }
            return {
              site: site.id,
              name: site.name,
              error: error.message,
              capturedAt: new Date().toISOString(),
              file,
            };
          },
        ),
      );
    }
  } finally {
    window.close();
    execFileSync("pbcopy", { input: clipboard });
  }
  // Keep the other sites' replies, so one site can be asked again on its own.
  const { results } = options;
  const kept = existsSync(results)
    ? (JSON.parse(readFileSync(results, "utf8")) as { replies: Capture[] }).replies.filter(
        ({ site }) => !options.sites.includes(site),
      )
    : [];
  const replies = [...kept, ...captures].sort(
    (a, b) =>
      sites.findIndex(({ id }) => id === a.site) - sites.findIndex(({ id }) => id === b.site),
  );
  writeFileSync(results, `${JSON.stringify({ prompt: aiPrompt, replies }, null, 2)}\n`);
  return captures;
}
