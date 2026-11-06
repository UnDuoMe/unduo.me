import { defaultPluginLimits, newPublicKey } from "@-/me.unduo.components.setup.plugin";
import { readQrCodes } from "@-/me.unduo.lib.qr-reader";
import { qrImage } from "#qr-code";
import type { SetupPage } from "#entities";
import type {
  PluginLimits,
  SetupEffect,
  SetupEvent,
  SetupPlugin,
  SetupView,
} from "@-/me.unduo.components.setup.plugin";

/** The view until setup starts and once it stops, which holds nothing. */
const noView: SetupView = {
  current: 0,
  furthest: 0,
  title: "",
  progress: [],
  value: "",
  request: null,
  submitted: false,
  codeType: "hotp",
  account: null,
  linkError: "",
  linkBusy: "",
  scanNote: "",
  canScan: false,
  problem: null,
  copied: "",
  copyError: false,
  shortcut: "Ctrl+",
};

/**
 * Browser I/O for the setup plugin, which holds the state and decides every
 * step, message and Duo URL. This holds the plugin's view for the steps to show and
 * performs the effects the plugin asks for. `load` starts the plugin within the
 * given limits, and every output is checked first; see `guard` in
 * `plugin/setup-plugin.ts`.
 */
export function createSetupPage(load: (limits: PluginLimits) => Promise<SetupPlugin>): SetupPage {
  let plugin = load(defaultPluginLimits);
  /** The image from the last input, until the plugin asks to read it. */
  let image: Blob | undefined;
  /** The shared screen while scanning. */
  let video: HTMLVideoElement | undefined;
  let drawn = "";
  /** The Duo host that a second CSP limits forms to, once the guard has accepted a form. */
  let formHost = "";
  /** Activation values posted from this page, so a double click posts once. */
  const sent = new Set<string>();
  /** Each screenshot's blob: URL, by its `data-image-src`. */
  const images = new Map<string, Promise<string>>();

  const view = van.state(noView);
  const started = van.derive(() => view.val !== noView);
  const failed = van.state(false);
  const activated = van.state(false);
  const newTab = van.state(false);
  const unenforced = van.state(false);
  const text = van.state("");
  const dragging = van.state(false);
  const qr = van.state<string | false>("");
  const limits = {
    maxPages: van.state(String(defaultPluginLimits.maxPages)),
    timeoutMs: van.state(String(defaultPluginLimits.timeoutMs)),
  };

  function begin() {
    // Fetch every screenshot now, so when they load says nothing about the setup.
    document
      .querySelectorAll<HTMLTemplateElement>(
        "#portal-signed-in, #portal-settings, #portal-screenshot-figures",
      )
      .forEach((template) => template.content.querySelectorAll("img").forEach(screenshot));
    // Start only where the browser enforces this page's CSP, whose connect-src
    // allows no data: URL: this fetch must fail.
    void fetch("data:,").then(
      () => (unenforced.val = true),
      () => {
        const { hash, search } = location;
        // The page's only change to its address, made before anything is pasted:
        // drop an old step, query or hash. The address never changes after this,
        // so nothing the plugin decides reaches browser history.
        if (hash || search) history.replaceState(null, "", location.pathname);
        send({
          type: "load",
          hash,
          legacy: search,
          platform: navigator.platform,
          scan: !!navigator.mediaDevices?.getDisplayMedia,
        });
      },
    );
  }
  /** Results apply in call order: each is attached before the next call is queued. */
  function send(event: SetupEvent) {
    if (event.type === "startOver") activated.val = false;
    const current = plugin;
    current
      .then((update) =>
        update(event).then(({ view: next, effects }) => {
          // Drop output from a plugin that `restart` replaced.
          if (current !== plugin) return;
          view.val = next;
          if (next.request) limitForms(next.request.host);
          for (const effect of effects) run(effect);
          draw();
        }),
      )
      .catch(() => fail(current));
  }
  /** Unsafe output, a broken limit or a failed plugin: stop everything. */
  function fail(current: Promise<SetupPlugin>) {
    if (current !== plugin) return;
    failed.val = true;
    view.val = noView;
    run({ type: "stopScan" });
  }
  /**
   * Add a second Content-Security-Policy that lets forms and frames reach only
   * `host`, the one Duo host the guard allows for this page load. Browsers
   * enforce every policy, so they then reach no other host, whatever the first
   * policy's `https://*.duosecurity.com` allows.
   */
  function limitForms(host: string) {
    if (formHost) return;
    formHost = host;
    const policy = document.createElement("meta");
    policy.httpEquiv = "Content-Security-Policy";
    policy.content = `form-action https://${host}; frame-src https://${host}`;
    document.head.append(policy);
  }
  /** Load a fresh plugin with the Advanced limits and start setup over. */
  function restart() {
    run({ type: "stopScan" });
    sent.clear();
    activated.val = false;
    failed.val = false;
    view.val = noView;
    plugin = load({
      maxPages: Number(limits.maxPages.val),
      timeoutMs: Number(limits.timeoutMs.val),
    });
    begin();
  }
  function run(effect: SetupEffect) {
    switch (effect.type) {
      case "prepare":
        void newPublicKey()
          .then(
            () => true,
            () => false,
          )
          .then((ok) => send({ type: "prepared", value: effect.value, ok }));
        break;
      case "readImage":
        createImageBitmap(image!).then(
          (bitmap) => {
            decode(bitmap, bitmap.width, bitmap.height, effect.ticket);
            bitmap.close();
          },
          () => send({ type: "unreadable", ticket: effect.ticket }),
        );
        image = undefined;
        break;
      case "scanFrame":
        setTimeout(() => {
          if (video) decode(video, video.videoWidth, video.videoHeight, effect.ticket);
        }, 500);
        break;
      case "stopScan":
        (video?.srcObject as MediaStream | null)?.getTracks().forEach((track) => track.stop());
        video = undefined;
        break;
      case "setText":
        text.val = effect.text;
        dragging.val = false;
        break;
      case "focus":
        // After the step's elements update.
        setTimeout(() => {
          document.getElementById(effect.scroll)?.scrollIntoView({ block: "nearest" });
          document.getElementById(effect.id)?.focus({ preventScroll: true });
        });
        break;
      case "later":
        setTimeout(() => send(effect.event), effect.ms);
    }
  }
  /** Draw the authenticator QR code whenever its link changes. */
  function draw() {
    const uri = view.val.account?.uri ?? "";
    if (uri === drawn) return;
    drawn = uri;
    qr.val = "";
    if (!uri) return;
    try {
      // 6-pixel modules inside a 2-module quiet zone, as an SVG data: URL.
      qr.val = qrImage(uri);
    } catch {
      qr.val = false;
    }
  }
  /**
   * Read the QR codes in an image or video frame, at most 1920 across, with
   * this page's own reader, and send the plugin their text. The plugin never
   * receives the pixels, which are wiped once read.
   */
  function decode(source: CanvasImageSource, width: number, height: number, ticket: number) {
    const scale = Math.min(1, 1920 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    // Transparent pixels read as white, as a copied QR image shows on a page.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const gray = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0; i < gray.length; i++)
      gray[i] = (data[i * 4]! * 299 + data[i * 4 + 1]! * 587 + data[i * 4 + 2]! * 114) / 1000;
    data.fill(0);
    const texts = readQrCodes(gray, canvas.width, canvas.height);
    gray.fill(0);
    canvas.width = 0;
    send({ type: "decoded", ticket, texts });
  }
  /** A paste anywhere on the page, or a drop. The plugin decides what it holds. */
  function input(data: DataTransfer | null, event?: Event) {
    dragging.val = false;
    const files = [
      ...(data?.files ?? []),
      ...[...(data?.items ?? [])].map((item) => item.getAsFile()),
    ];
    image = files.find((file) => file?.type.startsWith("image/")) ?? undefined;
    const html = data?.getData("text/html");
    const pasted = data?.getData("text/plain") || data?.getData("text/uri-list");
    if (!image && !html && !pasted) return;
    event?.preventDefault();
    send({ type: "input", text: pasted, html, image: !!image });
  }
  function upload(event: Event) {
    const field = event.target as HTMLInputElement;
    image = field.files?.[0];
    field.value = "";
    if (image) send({ type: "input", image: true });
  }
  /** Call from the click: screen capture needs the user's gesture. */
  function scan() {
    if (video) return;
    const shared = (video = document.createElement("video"));
    shared.muted = true;
    send({ type: "scanStarted" });
    navigator.mediaDevices
      .getDisplayMedia({ video: { displaySurface: "window" }, audio: false })
      .then(async (stream) => {
        shared.srcObject = stream;
        if (shared !== video) return stream.getTracks().forEach((track) => track.stop());
        stream
          .getVideoTracks()[0]
          ?.addEventListener("ended", () => send({ type: "scanEnded", error: "AbortError" }));
        await shared.play();
        send({ type: "scanSharing" });
      })
      .catch((error) => send({ type: "scanEnded", error: error?.name }));
  }
  /** Stop sharing now, whatever the plugin answers. */
  function stopScan() {
    run({ type: "stopScan" });
    send({ type: "scanEnded", error: "AbortError" });
  }
  /** The native POST to Duo, once per activation value. */
  function submit(event: SubmitEvent) {
    const { value, request, submitted } = view.val;
    if (!request || submitted || sent.has(value)) return event.preventDefault();
    sent.add(value);
    activated.val = true;
    newTab.val = (event.submitter as HTMLButtonElement | null)?.formTarget === "_blank";
    // Leave the form in place while the browser starts its POST.
    setTimeout(() => send({ type: "submitted", value }));
  }
  function retry() {
    sent.delete(view.val.value);
    send({ type: "retry" });
  }
  /** Copy the setup key, the otpauth link, or the portal link in `#portal-url`. */
  function copy(kind: "key" | "uri" | "portal") {
    const { account } = view.val;
    const copied =
      kind === "key"
        ? account?.secret
        : kind === "uri"
          ? account?.uri
          : (document.getElementById("portal-url") as HTMLInputElement).value;
    navigator.clipboard.writeText(copied ?? "").then(
      () => send({ type: "copied", kind }),
      () => send({ type: "copyFailed" }),
    );
  }
  /**
   * Open a link in a small window beside this page, so the steps stay in
   * view; browsers keep it on screen. The window gets no handle back to this
   * page. Modified clicks, and browsers that block the window, follow the
   * link as usual.
   */
  function popup(event: MouseEvent) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.currentTarget as HTMLAnchorElement;
    const place = `width=480,height=${outerHeight},left=${screenX + outerWidth},top=${screenY}`;
    const opened = window.open(link.href, "duo-portal", `popup,${place}`);
    if (!opened) return;
    opened.opener = null;
    event.preventDefault();
  }
  /**
   * Show a screenshot: a blob: URL of the file at the image's `data-image-src`,
   * which `fetch` returns only if its SHA-256 matches `data-image-integrity`.
   * An image with no `data-image-src` already holds its picture.
   */
  function screenshot(picture: HTMLImageElement) {
    const { imageSrc: url, imageIntegrity: integrity = "" } = picture.dataset;
    if (!url) return;
    if (!images.has(url))
      images.set(
        url,
        fetch(url, { integrity, credentials: "omit" })
          .then((response) => (response.ok ? response.blob() : Promise.reject(new Error(url))))
          .then((blob) => URL.createObjectURL(blob)),
      );
    void images.get(url)!.then(
      (source) => (picture.src = source),
      () => {},
    );
  }
  /** Move to the current step's title, for the skip link. */
  function focusStep() {
    run({ type: "focus", id: "step-title", scroll: "step-title" });
  }
  document.addEventListener("paste", (event) => input(event.clipboardData, event));
  window.addEventListener("beforeunload", (event) => {
    if (view.val.furthest > 2) event.preventDefault();
  });
  begin();

  return {
    view,
    started,
    failed,
    unenforced,
    text,
    dragging,
    qr,
    limits,
    send,
    restart,
    input,
    upload,
    scan,
    stopScan,
    activated,
    newTab,
    submit,
    retry,
    copy,
    popup,
    screenshot,
    focusStep,
  };
}
