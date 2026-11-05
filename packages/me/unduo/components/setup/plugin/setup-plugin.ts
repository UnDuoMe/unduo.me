import type {
  PluginLimits,
  SetupEffect,
  SetupEvent,
  SetupPlugin,
  SetupResult,
  SetupView,
} from "@-/me.unduo.components.setup.plugin.entities";

/**
 * The plugin's default limits. Each call's input is one event as JSON, such as
 * a pasted page of HTML or the decoded text of a QR code.
 */
export const defaultPluginLimits: PluginLimits = {
  maxPages: 1024, // 64 MiB
  timeoutMs: 5_000, // 5 seconds per call
};

/**
 * Plugin output check. `guard` checks each output before any other code sees
 * it. On a mismatch it throws, and every later call fails. The output must
 * match `Output` exactly: each field listed below and no others, with the type,
 * pattern or value shown. An output is at most `maxOutput` UTF-16 code units of
 * JSON, with at most `maxEffects` effects and `maxText` units in each string.
 * Plugin output leaves the page in three places:
 *
 * 1. The URL hash (`writeHash`) may hold only the step and code type, and may
 *    change at most twice per thing you do, so a run of changes can't spell
 *    anything out. History and browser sync keep the address.
 * 2. The Duo form (`view.request`): the plugin names only its URL; the fields
 *    and this page's key are written here. DNS and TLS send the host name
 *    unencrypted, so it must have Duo's eight-character shape and stay the same
 *    all page long. A new URL's code and host must also appear in text the
 *    page read since it loaded or started over: pasted text or HTML, or the
 *    text of a QR code in an image or screen frame, which this page's own
 *    `readQrCodes` read and the plugin never sees as pixels (`fromInput`).
 *    TLS encrypts the path, which holds the activation code.
 *    CSP also limits forms to `*.duosecurity.com`.
 * 3. The authenticator link (`view.account`) becomes a QR code, a link and
 *    clipboard text. It must be an `otpauth://` link, not a web address, with
 *    only the standard parameters (apps may fetch a URL given as `image`), and
 *    its secret must be `account.secret`. Duo's reply must be among the text
 *    pasted since the page loaded or started over: some pasted text must hold
 *    the text the secret encodes and the link's organization name (`fromReply`).
 *
 * Everything else is set as text, booleans and classes; nothing
 * writes HTML. That text is one of `pageTexts` or built from what you pasted:
 * the organization name, its QR code description and the setup key come from
 * the link and its secret, Duo's refusal quotes a pasted failure reply, which
 * holds no key, and `setText`
 * fills the field only with pasted text. The other effects set the text field, move focus, stop the
 * screen share or make the page call the plugin again.
 */
const hash = /^(?:step=(?:qr|activate|add)(?:&type=totp)?|type=totp)?$/;
const duoUrl =
  /^https:\/\/(api-[a-z0-9]{8}\.duosecurity\.com)\/push\/v2\/activation\/[A-Za-z0-9]{5,128}\?customer_protocol=1$/;
/** Duo Mobile's activation fields, in order; `pubkey` becomes this page's key. */
const duoFields = [
  ...new URLSearchParams(
    "pkpush=rsa-sha512&pubkey=&jailbroken=false&architecture=arm64&region=US&app_id=com.duosecurity.duomobile&full_disk_encryption=true&passcode_status=true&platform=Android&app_version=4.33.0&app_build_number=433000&version=13&manufacturer=Google&language=en&model=Cheetah&security_patch_level=2024-01-01",
  ),
];
const otpauth =
  /^otpauth:\/\/[ht]otp\/Duo:[\w.!~*'()%-]*\?secret=([A-Z2-7]+)&issuer=Duo&algorithm=SHA1&digits=6&(?:counter=0|period=30)$/;

/**
 * Size caps. `crates/setup` echoes pasted text up to `maxText` units. Its
 * longest other string, the otpauth link for the longest organization name and
 * secret it accepts from Duo's reply (4096 units each), is under 57,000.
 */
const maxText = 65_536;
const maxEffects = 16;
const maxOutput = 1_048_576;

/**
 * The text the page shows from the plugin. Titles, step labels and messages
 * must be one of these, word for word; `crates/setup` writes the same strings,
 * and a test compares the two. Text built from what you pasted is checked
 * where it is used: see `check`.
 */
export const pageTexts = {
  titles: [
    "Open your Duo device portal",
    "Copy the activation QR code",
    "Activate with Duo",
    "Add it to your authenticator",
  ],
  labels: ["Open portal", "Copy QR code", "Activate with Duo", "Add to authenticator"],
  messages: [
    "That isn't a Duo activation code. Copy the QR code from your Duo portal's “Add a device” screen.",
    "The activation code contains an invalid Duo host.",
    "The activation code must point to a Duo API host (api-….duosecurity.com).",
    "That link is incomplete. Copy the whole QR image address or activation link.",
    "That's a Duo page, not the QR code. Right-click the QR code and copy the image or its address.",
    "That Duo link isn't an activation link. Copy the QR code shown after choosing “I have Duo Mobile installed”.",
    "That's not a Duo link. Sign in to your Duo portal, add a device, then copy the QR code it shows.",
    "Paste the QR code, its image address, or your activation link.",
    "That's too long to be a Duo activation link.",
    "Your browser couldn't prepare the request. Use a current browser over HTTPS. Nothing was sent to Duo.",
    "That QR code isn't a Duo activation code. Copy the one shown after choosing “I have Duo Mobile installed”.",
    "No QR code found in that image. Copy the QR code itself, or a screenshot where it's fully visible.",
    "Found a QR code, but not Duo's. Keep the Duo activation QR code visible.",
    "No Duo QR code appeared within five minutes, so sharing stopped.",
    "That image couldn't be read. Try a PNG or JPEG screenshot.",
    "Choose the window that shows the Duo QR code. Nothing is recorded or uploaded.",
    "Looking for the Duo QR code in the shared window…",
    "Screen sharing was cancelled. Paste the QR code instead.",
    "Couldn't read the shared screen. Paste the QR code instead.",
    "That doesn't look like Duo's reply. Click in Duo's reply, select everything (Ctrl+A or ⌘A), copy it, then paste it here.",
    "Duo didn't accept this QR code: it has expired or was already used. Each code works once — create a new one in your Duo portal.",
    "That's too long to be Duo's reply. Copy only the text of Duo's reply.",
  ],
  /** The setup key until you reveal it. */
  hiddenKey: "•••• •••• •••• •••• •••• ••••",
};
/** A step's place for screen readers, as `crates/setup` writes it. */
const stepDescription = /^, step [1-4] of 4, (?:current step|done|not started)$/;
/**
 * Duo's refusal, with the reason and error code from its reply, both of which
 * must appear in pasted text.
 */
const duoRefusal =
  /^Duo didn't activate the device(?:: “([^]{1,200}?)”)?(?: \(error (-?\d{1,16})\))?\. Your organization may not allow adding devices this way\.$/u;

/**
 * A check takes a value and its place in the output, such as `view.title`, and
 * calls `unsafe` with that place unless the value matches.
 */
type Check = (value: unknown, path: string) => void;
const at = (path: string, key: string | number) => (path ? `${path}.${key}` : `${key}`);

const boolean: Check = (value, path) => {
  if (typeof value !== "boolean") unsafe(path);
};
/** A string of at most `maxText` units, matching `pattern` if one is given. */
const text =
  (pattern?: RegExp): Check =>
  (value, path) => {
    if (typeof value !== "string" || value.length > maxText || (pattern && !pattern.test(value)))
      unsafe(path);
  };
/** A whole number from `min` to `max`. */
const range =
  (min: number, max: number): Check =>
  (value, path) => {
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
      unsafe(path);
  };
/** Exactly one of `values`. */
const oneOf =
  (...values: (string | number)[]): Check =>
  (value, path) => {
    if (!values.includes(value as string | number)) unsafe(path);
  };
const nullable =
  (check: Check): Check =>
  (value, path) => {
    if (value !== null) check(value, path);
  };
/** An array of `min` to `max` entries, each matching `entry`. */
const list =
  (entry: Check, min: number, max: number): Check =>
  (value, path) => {
    if (!Array.isArray(value) || value.length < min || value.length > max) unsafe(path);
    value.forEach((item, index) => entry(item, at(path, index)));
  };
/** An object with exactly these keys, each value matching its check. */
const shape =
  (fields: Record<string, Check>): Check =>
  (value, path) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) unsafe(path);
    const keys = Object.keys(value);
    const expected = Object.keys(fields);
    if (keys.length !== expected.length || !keys.every((key) => Object.hasOwn(fields, key)))
      unsafe(path);
    for (const key of expected)
      fields[key]!((value as Record<string, unknown>)[key], at(path, key));
  };

const step = range(0, 3);
const ticket = range(0, 2 ** 32 - 1);

/** The closed list of effects, by `type`; see `SetupEffect`. */
const effects: Record<string, Check> = {
  writeHash: shape({ type: oneOf("writeHash"), hash: text(hash), push: boolean }),
  prepare: shape({ type: oneOf("prepare"), value: text() }),
  readImage: shape({ type: oneOf("readImage"), ticket }),
  scanFrame: shape({ type: oneOf("scanFrame"), ticket }),
  stopScan: shape({ type: oneOf("stopScan") }),
  setText: shape({ type: oneOf("setText"), text: text() }),
  focus: shape({
    type: oneOf("focus"),
    id: oneOf("step-title", "duo-reply"),
    scroll: oneOf("setup-progress", "duo-reply"),
  }),
  later: shape({
    type: oneOf("later"),
    ms: range(0, 60_000),
    event: shape({ type: oneOf("copyDone"), id: ticket }),
  }),
};
const Effect: Check = (value, path) => {
  const type = (value as { type?: unknown } | null)?.type;
  if (typeof type !== "string" || !Object.hasOwn(effects, type)) unsafe(path);
  effects[type]!(value, path);
};

/** The authenticator account, whose link must hold `secret`. */
const Account: Check = (value, path) => {
  shape({
    customer: text(),
    secret: text(/^[A-Z2-7]+$/),
    key: text(),
    revealed: boolean,
    uri: text(otpauth),
    qrAlt: text(),
  })(value, path);
  const { uri, secret } = value as { uri: string; secret: string };
  if (otpauth.exec(uri)![1] !== secret) unsafe(at(path, "uri"));
};

/** Display data; see `SetupView`. */
const View = shape({
  current: step,
  furthest: step,
  title: oneOf(...pageTexts.titles),
  progress: list(
    shape({
      index: step,
      number: range(1, 5),
      label: oneOf(...pageTexts.labels),
      state: oneOf("active", "complete", "upcoming"),
      finished: boolean,
      reachable: boolean,
      description: text(stepDescription),
    }),
    4,
    5,
  ),
  value: text(),
  request: nullable(shape({ url: text(duoUrl) })),
  submitted: boolean,
  codeType: oneOf("hotp", "totp"),
  account: nullable(Account),
  linkError: oneOf("", ...pageTexts.messages),
  linkBusy: oneOf("", "prepare", "image", "scan"),
  scanNote: oneOf("", ...pageTexts.messages),
  canScan: boolean,
  problem: nullable(shape({ message: text(), needsNewCode: boolean })),
  copied: oneOf("", "key", "uri", "portal"),
  copyError: boolean,
  shortcut: oneOf("⌘", "Ctrl+"),
});

/** Every output the plugin may return. */
const Output = shape({ view: View, effects: list(Effect, 0, maxEffects) });

/** What the reading instance may return: the text of up to 16 QR codes. */

/** An output that matched `Output`; the page writes the rest of `request`. */
type PluginOutput = {
  view: Omit<SetupView, "request"> & { request: { url: string } | null };
  effects: SetupEffect[];
};

/** The page's public key as PEM, from `newPublicKey`. */
let pubkey = "";
/** The first Duo host the plugin named; later forms must match it. */
let duoHost = "";
/**
 * What the page read since it loaded or started over: pasted text and HTML,
 * and the text of QR codes it read from images and screen frames.
 */
const typed = new Set<string>();
/** Pasted text and HTML since the page loaded or started over, which is how Duo's reply arrives. */
const pasted = new Set<string>();
/** The last Duo URL `duoForm` accepted. */
let formUrl = "";
/** Events the page sends on its own, with no person doing anything. */
const unprompted = new Set<SetupEvent["type"]>([
  "unreadable",
  "decoded",
  "prepared",
  "copyDone",
  "scanSharing",
  "scanEnded",
]);
/**
 * `writeHash` effects since the last thing a person did. Two are allowed: pasting
 * a QR code on an earlier step moves to the QR step, then on to the Duo form.
 */
let hashWrites = 0;

function unsafe(path: string): never {
  throw new Error(`The setup plugin returned unsafe output at ${path || "the top level"}.`);
}

/** Note the text in an event the page sends the plugin. */
function record(event: SetupEvent) {
  if (!unprompted.has(event.type)) hashWrites = 0;
  if (event.type === "load" || event.type === "startOver") {
    typed.clear();
    pasted.clear();
    formUrl = "";
  }
  const parts =
    event.type === "input" ? [event.text, event.html] : event.type === "decoded" ? event.texts : [];
  for (const part of parts) if (part) typed.add(part);
  if (event.type === "input")
    for (const part of [event.text, event.html]) if (part) pasted.add(part);
}

/** The text a base32 secret encodes, or nothing unless it is UTF-8. */
function fromBase32(secret: string) {
  const bytes: number[] = [];
  let value = 0;
  let bits = 0;
  for (const char of secret) {
    value = ((value << 5) | "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(char)) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return undefined;
  }
}

/**
 * Whether the account came from Duo's reply: some pasted text holds the text
 * that `secret` encodes and the organization name in `uri`, as written or as
 * JSON escapes them. A reply with no name gives the name Duo.
 */
function fromReply(uri: string, secret: string) {
  const text = fromBase32(secret);
  let name: string;
  try {
    name = decodeURIComponent(/\/Duo:([^?]*)\?/.exec(uri)![1]!);
  } catch {
    return false;
  }
  const holds = (value: string) =>
    [...pasted].some((part) =>
      [value, JSON.stringify(value).slice(1, -1)].some((form) => part.includes(form)),
    );
  return !!text && holds(text) && (name === "Duo" || holds(name));
}

/** Decode `%XX` escapes byte by byte; Duo's QR address nests one encoded link in another. */
const unescape = (text: string) =>
  text.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));

/**
 * Whether one of the `typed` texts, percent-decoded twice, holds the URL's code
 * where an activation keeps it: right before the host in base64, as `CODE-BASE64`
 * (`+` and `/` may be written `-` and `_`), or at the end of a link on the host's
 * `m-` name, as `m-XXXXXXXX.duosecurity.com/activate/CODE` (or `android`, `iphone`).
 * Host names ignore case; codes don't.
 */
function fromInput(url: string, host: string) {
  const code = url.slice(url.lastIndexOf("/") + 1, url.indexOf("?"));
  const base64 = btoa(host).replace(/=+$/, "").replaceAll("+", "[-+]").replaceAll("/", "[_/]");
  const mobile = `m${host.slice(3)}`
    .replace(/[a-z]/g, (letter) => `[${letter}${letter.toUpperCase()}]`)
    .replaceAll(".", "\\.");
  const activation = new RegExp(
    `(?<![A-Za-z0-9])${code}-${base64}|(?<![A-Za-z0-9.-])${mobile}/(?:activate|android|iphone)/${code}(?![A-Za-z0-9])`,
  );
  return [...typed].some((part) => activation.test(unescape(unescape(part))));
}

/** The Duo form for a checked URL, with the plugin's one host per page load. */
function duoForm(url: string) {
  const host = duoUrl.exec(url)![1]!;
  if (!pubkey || host !== (duoHost ||= host)) unsafe("view.request.url");
  if (url !== formUrl && !fromInput(url, host)) unsafe("view.request.url");
  formUrl = url;
  const fields = duoFields.map(([name, value]) => ({
    name,
    value: name === "pubkey" ? pubkey : value,
  }));
  return { url, host, fields };
}

/** Check one output against `Output`, then build the Duo form here from its URL. */
/**
 * Whether a pasted reply from Duo that says it failed holds `value`, as written,
 * JSON-escaped or with its spaces collapsed. A reply that succeeded holds the key,
 * so it can't supply the words of a refusal.
 */
const inFailedReply = (value: string) =>
  [...pasted].some(
    (part) =>
      /\bstat\W+FAIL\b/.test(part) &&
      !part.includes("hotp_secret") &&
      [value, JSON.stringify(value).slice(1, -1)].some(
        (form) => part.includes(form) || part.split(/\s+/).join(" ").includes(form),
      ),
  );

/**
 * Check one output against `Output`, then the text built from what you
 * pasted, then build the Duo form here from its URL.
 */
function check(output: unknown): SetupResult {
  Output(output, "");
  const { view, effects } = output as PluginOutput;
  const { account, problem } = view;
  if (account) {
    if (!fromReply(account.uri, account.secret)) unsafe("view.account");
    // The name, its QR code description and the key all come from the link and its secret.
    const name = decodeURIComponent(/\/Duo:([^?]*)\?/.exec(account.uri)![1]!) || "Duo";
    const kind = account.uri.startsWith("otpauth://totp/") ? "Time-based" : "Counter-based";
    if (account.customer !== name) unsafe("view.account.customer");
    if (account.qrAlt !== `${kind} authenticator QR code for ${name}`) unsafe("view.account.qrAlt");
    const grouped = account.secret.match(/.{1,4}/g)!.join(" ");
    if (account.key !== (account.revealed ? grouped : pageTexts.hiddenKey))
      unsafe("view.account.key");
  }
  if (problem && !pageTexts.messages.includes(problem.message)) {
    const [, reason, code] = duoRefusal.exec(problem.message) ?? [];
    if (
      !problem.message.match(duoRefusal) ||
      (reason && !inFailedReply(reason)) ||
      (code && !inFailedReply(code))
    )
      unsafe("view.problem.message");
  }
  effects.forEach((effect, index) => {
    if (effect.type === "writeHash" && ++hashWrites > 2) unsafe(`effects.${index}`);
    // The text field shows only what you pasted.
    if (
      effect.type === "setText" &&
      effect.text &&
      ![...pasted].some((part) => part.trim() === effect.text)
    )
      unsafe(`effects.${index}.text`);
  });
  return { view: { ...view, request: view.request && duoForm(view.request.url) }, effects };
}

/**
 * Make the page's key for the Duo form. The private half is created
 * non-extractable and never used; Duo Push approvals would need it.
 */
export async function newPublicKey() {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-512",
    },
    false,
    ["sign", "verify"],
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const base64 = btoa(String.fromCharCode(...spki));
  pubkey = `-----BEGIN PUBLIC KEY-----\n${base64.match(/.{1,64}/g)!.join("\n")}\n-----END PUBLIC KEY-----\n`;
}

/**
 * Run calls one at a time, in order, through `check`. `call` passes an event's
 * JSON to the plugin's `update` export and returns its output, which is parsed
 * as JSON only if it is at most `maxOutput` units long. A call that takes
 * longer than `timeoutMs` fails too. The plugin runs on the page's thread, so
 * nothing on the page can interrupt a call that is running, but its late
 * output is never used. After a failure every later call fails.
 */
export function guard(
  call: (event: string) => Promise<string | undefined>,
  timeoutMs = defaultPluginLimits.timeoutMs,
): SetupPlugin {
  let queue: Promise<unknown> = Promise.resolve();
  return (event) => {
    const result = queue.then(async () => {
      record(event);
      const start = performance.now();
      const json = await call(JSON.stringify(event));
      if (performance.now() - start > timeoutMs) throw new Error("The setup plugin timed out.");
      if (typeof json !== "string" || json.length > maxOutput) unsafe("");
      return check(JSON.parse(json));
    });
    queue = result;
    return result;
  };
}

/** The bytes of a 64 KiB WebAssembly page. */
const page = 65_536;

/** Everything the module may import, all from `extism:host/env`, and export. */
const moduleImports = [
  "alloc",
  "error_set",
  "input_length",
  "input_load_u64",
  "input_load_u8",
  "output_set",
  "store_u64",
  "store_u8",
];
const moduleExports = ["memory", "update"];

/**
 * One instance's imports: Extism's eight kernel functions, which hand the
 * instance one call's input and take back its output or error. `alloc`
 * reserves blocks of one buffer of at most `maxBytes`, and returns 0 past that.
 * Reading or writing outside the reserved blocks, or outside the input, throws,
 * which ends the call. `start` sets a call's input and clears the blocks.
 */
function kernel(maxBytes: number) {
  let memory = new Uint8Array(0);
  let input: Uint8Array = new Uint8Array(0);
  /** The next free offset; 0 is never a block. */
  let top = 1;
  const blocks = new Map<number, number>();
  let output: Uint8Array | undefined;
  let error: Uint8Array | undefined;
  /** Where `length` bytes at `offset` start, if they lie from `from` to `to`. */
  const within = (offset: bigint, length: number, from: number, to: number) => {
    const at = Number(offset);
    if (!(at >= from && at + length <= to))
      throw new RangeError("The setup plugin used memory outside its blocks.");
    return at;
  };
  const copy = (offset: bigint, length: number) => {
    const at = within(offset, length, 1, top);
    return memory.slice(at, at + length);
  };
  const imports = {
    alloc(length: bigint) {
      const at = top;
      const end = at + Number(length);
      if (length < 0n || end > maxBytes) return 0n;
      if (end > memory.length) {
        const grown = new Uint8Array(Math.min(maxBytes, Math.max(end, 2 * memory.length)));
        grown.set(memory);
        memory = grown;
      }
      blocks.set(at, end - at);
      top = end;
      return BigInt(at);
    },
    store_u8(offset: bigint, byte: number) {
      memory[within(offset, 1, 1, top)] = byte;
    },
    store_u64(offset: bigint, word: bigint) {
      new DataView(memory.buffer).setBigUint64(within(offset, 8, 1, top), word, true);
    },
    input_length: () => BigInt(input.length),
    input_load_u8: (offset: bigint) => input[within(offset, 1, 0, input.length)],
    input_load_u64: (offset: bigint) =>
      new DataView(input.buffer).getBigUint64(within(offset, 8, 0, input.length), true),
    output_set(offset: bigint, length: bigint) {
      output = copy(offset, Number(length));
    },
    error_set(offset: bigint) {
      error = copy(offset, blocks.get(Number(offset)) ?? 0);
    },
  };
  const utf8 = (bytes?: Uint8Array) => bytes && new TextDecoder().decode(bytes);
  return {
    imports,
    start: (bytes: Uint8Array) => {
      input = bytes;
      top = 1;
      blocks.clear();
      output = error = undefined;
    },
    output: () => utf8(output),
    error: () => utf8(error),
  };
}

/**
 * Load the setup logic: a WebAssembly module compiled from `crates/setup`.
 * `fetch` returns its bytes only if their SHA-256 matches `integrity`, and the
 * page refuses a module whose imports and exports aren't exactly
 * `moduleImports` and `moduleExports`. The module runs the setup flow on events,
 * through `guard`, and gets QR codes as text, never pixels. Its only imports are
 * `kernel`'s eight functions: instantiating a module that imports anything else
 * fails. A call fails if its export reports an error, if the module's memory then
 * holds more than `maxPages` pages, which `kernel` also caps, or if it took
 * longer than `timeoutMs`.
 */
export async function loadSetupPlugin(
  url: string,
  integrity: string,
  { maxPages, timeoutMs } = defaultPluginLimits,
): Promise<SetupPlugin> {
  if (![maxPages, timeoutMs].every((limit) => Number.isInteger(limit) && limit > 0))
    throw new RangeError("Each plugin limit must be a positive whole number.");
  if (!/^sha256-[A-Za-z0-9+/]{43}=$/.test(integrity))
    throw new Error("The setup plugin needs its SHA-256.");
  const response = await fetch(url, { integrity, credentials: "omit" });
  if (!response.ok) throw new Error("The setup plugin didn't load.");
  const module = await WebAssembly.compile(await response.arrayBuffer());
  // Refuse the module unless it imports exactly `kernel`'s functions and exports exactly these.
  const imported = WebAssembly.Module.imports(module).map(({ module: from, name, kind }) =>
    from === "extism:host/env" && kind === "function" ? name : `${from}.${name}`,
  );
  const exported = WebAssembly.Module.exports(module).map(({ name }) => name);
  if (
    imported.sort().join() !== moduleImports.join() ||
    exported.sort().join() !== moduleExports.join()
  )
    throw new Error("The setup plugin imports or exports something else.");
  const { imports, start, output, error } = kernel(maxPages * page);
  const { exports } = await WebAssembly.instantiate(module, { "extism:host/env": imports });
  const update = exports.update as () => number;
  const memory = exports.memory as WebAssembly.Memory;
  return guard(async (event) => {
    start(new TextEncoder().encode(event));
    if (update() !== 0) throw new Error(error() || "The setup plugin failed.");
    if (memory.buffer.byteLength > maxPages * page)
      throw new RangeError("The setup plugin went over its memory limit.");
    return output();
  }, timeoutMs);
}
