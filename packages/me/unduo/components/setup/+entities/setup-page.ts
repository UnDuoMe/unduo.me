import type { SetupEvent, SetupView } from "@-/me.unduo.components.setup.plugin";
import type { State } from "@-/me.unduo.lib.dom";

/**
 * An institution's details, from the data attributes of its element in the
 * page's `#setup-schools` template. Other, for no institution, has an empty
 * `id` and `name`.
 */
export interface SetupSchool {
  /** The WHED ID, or "" for Other. */
  id: string;
  name: string;
  portalUrl?: string | undefined;
  /** `universal` when the portal uses Duo's Universal Prompt; see `University.duoPrompt`. */
  duoPrompt?: string | undefined;
  note?: string | undefined;
  sourceUrl: string;
  /** The name of its set of example screenshots in the page's screenshot list. */
  screenshots: string;
}

/**
 * An example screenshot in the page's screenshot list: its file, relative to
 * the list's address, the
 * SHA-256 it must have, and its text.
 */
export interface Screenshot {
  file: string;
  integrity: string;
  /** Its alt text, and its caption when a step's screenshots are numbered. */
  label: string;
  caption?: string;
  /** How wide a signed-in example is shown: `narrow` or `wide`. */
  size?: string;
}

/** One kind of portal's example screenshots, for the first three steps. */
export interface ScreenshotSet {
  /** What Duo shows once the student is signed in. */
  signedIn: Screenshot[];
  /** The page that lists the student's devices. */
  settings: Screenshot;
  /** Adding a device until its QR code shows. */
  steps: Screenshot[];
}

/** The screenshot list: each set by name, which an institution's `screenshots` names. */
export interface ScreenshotList {
  sets: Record<string, ScreenshotSet>;
}

/** The state and actions of the setup page, which its steps build their elements from. */
export interface SetupPage {
  /** The plugin's last checked view, or an empty one until setup starts and once it stops. */
  view: State<SetupView>;
  /** Whether `view` holds the plugin's output. */
  started: State<boolean>;
  failed: State<boolean>;
  /** The browser let through a fetch the page's CSP forbids, so setup never starts. */
  unenforced: State<boolean>;
  /** The link or reply in the text field. */
  text: State<string>;
  dragging: State<boolean>;
  /** The authenticator QR code as a data: URL; "" while drawing, false if it didn't fit. */
  qr: State<string | false>;
  /** The plugin limits in the Advanced panel, as typed; `restart` applies them. */
  limits: { maxPages: State<string>; timeoutMs: State<string> };
  send: (event: SetupEvent) => void;
  restart: () => void;
  input: (data: DataTransfer | null, event?: Event) => void;
  upload: (event: Event) => void;
  scan: () => void;
  stopScan: () => void;
  /** Whether Duo's reply may be in its frame, which then stays through earlier steps. */
  activated: State<boolean>;
  submit: (event: SubmitEvent) => void;
  retry: () => void;
  /** Copy the portal link. Nothing copies the setup key or its link. */
  copy: (kind: "portal") => void;
  popup: (event: MouseEvent) => void;
  /** The screenshot list, once fetched and checked; `undefined` until then. */
  screenshots: State<ScreenshotList | undefined>;
  /** Start fetching a screenshot, if it isn't already: a blob: URL of its checked bytes. */
  loadScreenshot: (shot: Screenshot) => Promise<string>;
  /** Show a screenshot in `image` once it's fetched and checked. */
  screenshot: (image: HTMLImageElement, shot: Screenshot) => void;
  focusStep: () => void;
}
