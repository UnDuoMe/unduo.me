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
import { ChromeWindow, sleep } from "#chrome";
import { cropToPage } from "#crop";
import { type Site, sites } from "#sites";
import { finishedReply, holdsOnly, type Reply } from "#tree";

export interface CaptureOptions {
  /** The setup file to attach, and the name a student's browser saves it under. */
  file: string;
  fileName: string;
  /** Where the cropped screenshots and `results.json` go. */
  out: string;
  /** Where the uncropped window screenshots go. */
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
  /** The reply's text as the accessibility tree gives it. */
  reply?: string;
  /** The cropped screenshot's file name in `out`. */
  screenshot?: string;
  /** Why the site couldn't be asked, if it couldn't. */
  error?: string;
  capturedAt: string;
  /** The attached file's name and SHA-256. */
  file: { name: string; sha256: string };
}

/** Wait until the reply has a verdict, nothing is still writing it, and it reads the same twice. */
async function waitForReply(window: ChromeWindow, timeoutMs = 6 * 60_000) {
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

/** Ask `site` about the file in a new temporary chat, then screenshot the conversation from its top. */
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
  const reply = await waitForReply(window);
  // Show the conversation from the top: the file and prompt, then the verdict.
  window.scroll(reply.index, "up", 20);
  await sleep(1500);
  const shot = window.screenshot();
  const raw = join(options.raw, `${site.id}.png`);
  copyFileSync(shot.path, raw);
  const screenshot = `${site.id}.png`;
  cropToPage(raw, join(options.out, screenshot), shot.scale, site.crop);
  return {
    site: site.id,
    name: site.name,
    model,
    verdict: reply.verdict,
    reply: reply.text,
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
  mkdirSync(options.out, { recursive: true });
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
          (error: Error) => ({
            site: site.id,
            name: site.name,
            error: error.message,
            capturedAt: new Date().toISOString(),
            file,
          }),
        ),
      );
    }
  } finally {
    window.close();
    execFileSync("pbcopy", { input: clipboard });
  }
  // Keep the other sites' replies, so one site can be asked again on its own.
  const results = join(options.out, "results.json");
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
