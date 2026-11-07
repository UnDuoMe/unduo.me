import type { SetupEvent, SetupView } from "@-/me.unduo.components.setup.plugin";
import type { State } from "@-/me.unduo.lib.dom";

/** An institution's details, from the data attributes of the page's `#setup` element. */
export interface SetupSchool {
  name: string;
  portalUrl?: string | undefined;
  /** `universal` when the portal uses Duo's Universal Prompt; see `University.duoPrompt`. */
  duoPrompt?: string | undefined;
  note?: string | undefined;
  sourceUrl: string;
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
  screenshot: (image: HTMLImageElement) => void;
  focusStep: () => void;
}
