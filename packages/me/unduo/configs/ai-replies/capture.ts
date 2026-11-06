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
import { cropToPage, joinScreenshots, toWebp } from "#crop";
import { type Site, sites } from "#sites";
import { copyButton, finishedReply, holdsOnly, type Reply, replyMarkdown } from "#tree";

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
  /** The screenshot's file name in `images`: the conversation's top, joined to its end. */
  screenshot?: string;
  /**
   * The last SHA-256 the reply gives, which the prompt's P.S. asks for, and
   * whether it's the attached file's.
   */
  hash?: { found?: string; matches: boolean };
  /** Why the site couldn't be asked, if it couldn't. */
  error?: string;
  capturedAt: string;
  /** The attached file's name and SHA-256. */
  file: { name: string; sha256: string };
}

/** The last SHA-256 in `reply`, and whether it's `sha256`, the attached file's. */
export function replyHash(reply: string | undefined, sha256: string) {
  const found = [...(reply ?? "").matchAll(/\b[0-9a-f]{64}\b/gi)].at(-1)?.[0].toLowerCase();
  return { found, matches: found === sha256 };
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

/** The most screenshots to join for one conversation. */
const maxScreenshots = 16;

/**
 * Screenshot the conversation, already at its top, then half a window further
 * down at a time until it stops moving, joining each screenshot under the last.
 * The reply is found again before each scroll, since the page's elements
 * change as it scrolls. If half a window doesn't move it, a whole one is tried.
 */
async function screenshotConversation(window: ChromeWindow, site: Site, raw: string) {
  const shoot = (step: number) => {
    const shot = window.screenshot();
    const path = join(raw, `${site.id}-${step}.png`);
    copyFileSync(shot.path, path);
    const cropped = join(raw, `${site.id}-${step}-cropped.png`);
    cropToPage(path, cropped, shot.scale, site.crop);
    return { cropped, scale: shot.scale };
  };
  const first = shoot(0);
  let joined = first.cropped;
  let pages = 0.5;
  for (let step = 1; step < maxScreenshots; step++) {
    const reply = finishedReply(window.tree());
    if (!reply) break;
    window.scroll(reply.index, "down", pages);
    await sleep(1200);
    const next = shoot(step);
    const out = join(raw, `${site.id}-joined-${step}.png`);
    const { fits } = joinScreenshots(joined, next.cropped, out, first.scale);
    if (fits && step === 1 && pages < 1) {
      pages = 1;
      continue;
    }
    if (fits) break;
    joined = out;
  }
  return joined;
}

/** Ask `site` about the file in a new temporary chat, then screenshot the whole conversation. */
async function ask(window: ChromeWindow, site: Site, upload: string, options: CaptureOptions) {
  const model = await site.start(window, { focus: options.focus });
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
  // where it gives the file's SHA-256, joined from screenshots half a window apart.
  window.dismissInfobar();
  window.scroll(reply.index, "up", 20);
  await sleep(1500);
  const joined = await screenshotConversation(window, site, options.raw);
  const screenshot = `ai-reply-${site.id}.webp`;
  toWebp(joined, join(options.images, screenshot));
  return {
    tree,
    site: site.id,
    name: site.name,
    model,
    verdict: reply.verdict,
    reply: markdown,
    whole,
    screenshot,
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
          ({ tree, ...capture }) => {
            // The tree too: a hash in a code block isn't in the reply's Markdown.
            const hash = replyHash(`${capture.reply ?? ""}\n${tree ?? ""}`, file.sha256);
            if (!hash.matches)
              console.warn(
                `${site.name}'s reply ${hash.found ? `gives ${hash.found}, not the file's SHA-256` : "gives no SHA-256"}.`,
              );
            return { ...capture, hash, capturedAt: new Date().toISOString(), file };
          },
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
