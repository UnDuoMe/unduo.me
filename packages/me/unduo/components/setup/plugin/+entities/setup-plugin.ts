import type { ResponseProblem } from "@-/me.unduo.components.setup.activate.entities";
import type { LinkBusy } from "@-/me.unduo.components.setup.link.entities";

/**
 * What happened in the browser. The plugin keeps its own state and decides what
 * follows. Its definitions are in `crates/setup/src/core.rs`.
 */
export type SetupEvent =
  /**
   * First render: the URL hash and query, `navigator.platform`, and whether the
   * browser can share a screen.
   */
  | {
      type: "load";
      hash: string;
      legacy: string;
      platform: string;
      scan: boolean;
    }
  /** Back, Forward or an edited hash. */
  | { type: "navigate"; hash: string }
  | { type: "goTo"; step: number }
  | { type: "changeType"; codeType: "hotp" | "totp" }
  | { type: "startOver"; step: number }
  /** A paste, drop or upload, or a submitted link or reply. `image` says the host holds an image file. */
  | { type: "input"; text?: string; html?: string; image?: boolean }
  | { type: "editLink" }
  /** The browser couldn't decode the image for `readImage`. */
  | { type: "unreadable"; ticket: number }
  /** The page read the image or screen frame for `ticket`: the text of each QR code in it. */
  | { type: "decoded"; ticket: number; texts: string[] }
  | { type: "scanStarted" }
  | { type: "scanSharing" }
  /** Sharing failed or the user stopped it; `error` is the DOMException name. */
  | { type: "scanEnded"; error?: string }
  /** The host made a fresh key for `value`'s form, or couldn't. The key stays in the host. */
  | { type: "prepared"; value: string; ok: boolean }
  | { type: "submitted"; value: string }
  | { type: "retry" }
  | { type: "reveal" }
  | { type: "copied"; kind: "key" | "uri" | "portal" }
  | { type: "copyFailed" }
  | { type: "copyDone"; id: number };

/** The closed list of things the plugin can ask the host to do. */
export type SetupEffect =
  /** Generate the form's key pair, then send `prepared`. */
  | { type: "prepare"; value: string }
  /** Read the QR codes in the image from the last `input`, then send `decoded`. */
  | { type: "readImage"; ticket: number }
  /** After half a second, read the QR codes in a frame of the shared screen, then send `decoded`. */
  | { type: "scanFrame"; ticket: number }
  | { type: "stopScan" }
  /** Replace the text in the link or reply field and drop highlight. */
  | { type: "setText"; text: string }
  /** Scroll `scroll` into view, then focus `id`. */
  | { type: "focus"; id: string; scroll: string }
  /** Send `event` after `ms` milliseconds. */
  | { type: "later"; ms: number; event: SetupEvent };

export interface SetupProgressStep {
  index: number;
  /** The number shown, counting from 1. */
  number: number;
  label: string;
  state: "active" | "complete" | "upcoming";
  finished: boolean;
  reachable: boolean;
  description: string;
}

export interface SetupAccountView {
  customer: string;
  /** The base32 secret, for copying. */
  secret: string;
  /** The secret in groups of four once revealed, else dots. */
  key: string;
  revealed: boolean;
  /** The `otpauth://` link for the selected code type. */
  uri: string;
  qrAlt: string;
}

/** The native form POST to Duo. The plugin names `url`; the host checks it and adds the rest. */
export interface DuoRequest {
  url: string;
  host: string;
  fields: { name: string; value: string }[];
}

/** Display data. The host binds it as text, booleans and classes only, and checks `request` and `account` first. */
export interface SetupView {
  current: number;
  /** The furthest reachable step: 3 with an activation in memory, 4 with an account, else 2. */
  furthest: number;
  title: string;
  progress: SetupProgressStep[];
  /** The activation value at step 4, or "". */
  value: string;
  request: DuoRequest | null;
  submitted: boolean;
  codeType: "hotp" | "totp";
  account: SetupAccountView | null;
  linkError: string;
  linkBusy: LinkBusy;
  scanNote: string;
  /** A scan put the Duo QR code's text in the field; Continue goes on. */
  scanFound: boolean;
  canScan: boolean;
  problem: ResponseProblem | null;
  copied: "" | "key" | "uri" | "portal";
  copyError: boolean;
  /** `⌘` on Apple devices, else `Ctrl+`. */
  shortcut: string;
}

export interface SetupResult {
  view: SetupView;
  effects: SetupEffect[];
}

/** Send a {@link SetupEvent} to the plugin's `update` export, as JSON. */
export type SetupPlugin = (event: SetupEvent) => Promise<SetupResult>;

/**
 * Resource limits for the plugin. Each must be a positive whole number;
 * `loadSetupPlugin` enforces the memory limit and `guard` the time limit.
 */
export interface PluginLimits {
  /** 64 KiB pages for a call's input, output and error, and for the module's own memory after each call. */
  maxPages: number;
  /** Milliseconds per call. */
  timeoutMs: number;
}
