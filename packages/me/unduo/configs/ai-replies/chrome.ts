import { execFileSync } from "node:child_process";
import { findLine } from "#tree";

/** The Orca CLI this session exports, else `orca` on the PATH. */
const orca = process.env.ORCA_CLI_COMMAND || "orca";
const chrome = "com.google.Chrome";

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface Screenshot {
  path: string;
  /** Image pixels per window point. */
  scale: number;
}
interface Result {
  snapshot: { treeText: string };
  screenshot?: Screenshot;
  windows?: { id: number }[];
}

/** Run one `orca computer` command and return its result, or throw the error it reports. */
function computer(args: string[]): Result {
  let output: string;
  try {
    output = execFileSync(orca, ["computer", ...args, "--json"], {
      encoding: "utf8",
      maxBuffer: 1 << 26,
    });
  } catch (error) {
    output = String((error as { stdout?: string }).stdout ?? "");
    if (!output) throw error;
  }
  const reply = JSON.parse(output) as {
    result?: Result;
    error?: { code: string; message: string };
  };
  if (reply.error)
    throw new Error(`orca computer ${args[0]}: ${reply.error.code}: ${reply.error.message}`);
  return reply.result!;
}

const windowIds = () =>
  (computer(["list-windows", "--app", chrome]).windows ?? []).map(({ id }) => id);

/** Tell Chrome, through AppleScript, to do `command`, and return its answer. */
const tellChrome = (command: string) =>
  execFileSync("osascript", ["-e", `tell application "Google Chrome" to ${command}`], {
    encoding: "utf8",
  }).trim();
/** Chrome's own ids for its windows, which AppleScript uses. */
const scriptIds = () => tellChrome("get id of every window").split(", ").filter(Boolean);

/** The app in front, by bundle ID, so it can be put back after Chrome takes the front. */
export function frontApp() {
  const asn = execFileSync("lsappinfo", ["front"], { encoding: "utf8" }).trim();
  const info = execFileSync("lsappinfo", ["info", "-only", "bundleid", asn], { encoding: "utf8" });
  return /bundleID="([^"]+)"/i.exec(info)?.[1];
}
export function bringToFront(bundleId: string | undefined) {
  if (bundleId && bundleId !== chrome) execFileSync("open", ["-b", bundleId]);
}

/**
 * A Chrome window driven through `orca computer`, in the background: the window
 * stays behind whatever you're doing and the pointer doesn't move. Element
 * indexes come from its accessibility tree.
 */
export class ChromeWindow {
  private constructor(
    readonly id: number,
    /** The window's id in AppleScript, which can move and resize it. */
    private readonly scriptId: string,
  ) {}

  /**
   * Open `url` in a new window of your Chrome. Chrome comes to the front when it
   * opens a window, so the app you were using goes back in front as soon as the
   * window appears, and again if Chrome takes the front back.
   */
  static async open(url: string) {
    const before = new Set(windowIds());
    const scriptsBefore = new Set(scriptIds());
    const front = frontApp();
    execFileSync("open", ["-g", "-n", "-a", "Google Chrome", "--args", "--new-window", url]);
    for (let attempt = 0; attempt < 100; attempt++) {
      const id = windowIds().find((id) => !before.has(id));
      const scriptId = scriptIds().find((id) => !scriptsBefore.has(id));
      if (id !== undefined && scriptId !== undefined) {
        bringToFront(front);
        await sleep(800);
        if (frontApp() === chrome) bringToFront(front);
        return new ChromeWindow(id, scriptId);
      }
      await sleep(150);
    }
    throw new Error("Chrome didn't open a window.");
  }

  private run(command: string, args: string[] = [], { screenshot = false, restore = false } = {}) {
    return computer([
      command,
      "--app",
      chrome,
      "--window-id",
      String(this.id),
      ...args,
      ...(screenshot ? [] : ["--no-screenshot"]),
      ...(restore ? ["--restore-window"] : []),
    ]);
  }

  tree() {
    return this.run("get-app-state").snapshot.treeText;
  }
  /** The index of the first element whose description matches `pattern`. */
  find(pattern: RegExp) {
    return findLine(this.tree(), pattern)?.index;
  }
  async waitFor(pattern: RegExp, timeoutMs = 60_000) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const index = this.find(pattern);
      if (index) return index;
      if (Date.now() > end) throw new Error(`Timed out waiting for ${pattern}.`);
      await sleep(1500);
    }
  }
  /** Click an element; `restore` brings Chrome to the front for it. */
  click(index: string, { restore = false } = {}) {
    this.run("click", ["--element-index", index], { restore });
  }
  /**
   * Close Chrome's bar across the top of the page, such as "Google Chrome isn't
   * your default browser", which would show in screenshots.
   */
  dismissInfobar() {
    const lines = this.tree().split("\n");
    const bar = lines.findIndex((line) => /\bcontainer Infobar$/.test(line.trim()));
    if (bar === -1) return;
    const close = lines
      .slice(bar, bar + 8)
      .map((line) => /^\s*(\d+) button Close$/.exec(line)?.[1])
      .find(Boolean);
    if (close) this.click(close);
  }
  pressKey(key: string, { restore = false } = {}) {
    this.run("press-key", ["--key", key], { restore });
  }
  hotkey(key: string, { restore = false } = {}) {
    this.run("hotkey", ["--key", key], { restore });
  }
  setValue(index: string, value: string, { restore = false } = {}) {
    this.run("set-value", ["--element-index", index, "--value", value], { restore });
  }
  /** The index of the element with keyboard focus. */
  focused() {
    return /The focused UI element is (\d+) /.exec(this.tree())?.[1];
  }
  /** Scroll what's in the middle of the window, as a scroll wheel there would. */
  scrollMiddle(direction: "up" | "down", pages: number) {
    const [left, top, right, bottom] = this.bounds();
    this.run("scroll", [
      "--x",
      String(Math.round((right - left) / 2)),
      "--y",
      String(Math.round((bottom - top) / 2)),
      "--direction",
      direction,
      "--pages",
      String(pages),
    ]);
  }
  /** Load `url` from the address bar, which takes Return only once it has focus. */
  async go(url: string) {
    const bar = this.find(/^text field .*Address and search bar/);
    if (!bar) throw new Error("No address bar.");
    this.click(bar);
    this.setValue(bar, url);
    this.pressKey("Return");
    await sleep(3000);
  }
  /** Empty the text box at `box`. */
  clear(box: RegExp) {
    const index = this.find(box);
    if (!index) throw new Error(`No ${box}.`);
    this.click(index);
    this.hotkey("CmdOrCtrl+A");
    this.pressKey("Delete");
  }
  /** Paste into the element at `box` what's on the clipboard. */
  private paste(box: RegExp) {
    const index = this.find(box);
    if (!index) throw new Error(`No ${box}.`);
    this.click(index);
    this.hotkey("CmdOrCtrl+V");
  }
  /** Attach a file the way pasting a file copied in Finder does. */
  pasteFile(box: RegExp, path: string) {
    execFileSync("osascript", ["-e", `set the clipboard to (POSIX file ${JSON.stringify(path)})`]);
    this.paste(box);
  }
  pasteText(box: RegExp, text: string) {
    execFileSync("pbcopy", { input: text });
    this.paste(box);
  }
  private bounds() {
    return tellChrome(`get bounds of window id ${this.scriptId}`).split(", ").map(Number) as [
      number,
      number,
      number,
      number,
    ];
  }
  /**
   * Make the window `width` points wide and as tall as the screen allows,
   * keeping its left edge, and return the size it gets: macOS keeps a window
   * within the screen, and Chrome keeps one at least 500 points wide.
   */
  async resize(width: number) {
    const [left] = this.bounds();
    tellChrome(
      `set bounds of window id ${this.scriptId} to {${left}, 0, ${left + Math.round(width)}, 10000}`,
    );
    await sleep(1000);
    const [x, y, right, bottom] = this.bounds();
    return { width: right - x, height: bottom - y };
  }
  /** The page's zoom, in percent: Chrome shows a Zoom button in the address bar when it isn't 100%. */
  zoom() {
    return Number(/^\s*\d+ button Zoom: (\d+)%$/m.exec(this.tree())?.[1] ?? 100);
  }
  /**
   * Zoom the page out one of Chrome's steps (90, 80, 75, 67, 50, 33 and 25%), as
   * ⌘− does. Chrome keeps a site's zoom for its next visit, so put it back with
   * `resetZoom()`.
   */
  async zoomOut() {
    this.hotkey("CmdOrCtrl+-");
    await this.zoomSettled();
  }
  async resetZoom() {
    this.hotkey("CmdOrCtrl+0");
    await this.zoomSettled();
  }
  /** Wait for the bubble Chrome shows under the address bar on a zoom to close, so it isn't in a screenshot. */
  private async zoomSettled() {
    const end = Date.now() + 15_000;
    await sleep(500);
    while (/^\s*\d+ container Zoom: \d+%$/m.test(this.tree()) && Date.now() < end) await sleep(500);
  }
  /** A screenshot of the whole window, at the display's scale. */
  screenshot() {
    const { screenshot } = this.run("get-app-state", [], { screenshot: true });
    if (!screenshot?.path) throw new Error("No screenshot.");
    return screenshot;
  }
  close() {
    const index = this.find(/^close button$/);
    if (!index) return;
    try {
      this.click(index);
    } catch {
      // The window is gone before Orca can read it again.
    }
  }
}
