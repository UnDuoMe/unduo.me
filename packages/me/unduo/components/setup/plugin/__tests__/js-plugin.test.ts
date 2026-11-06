import { describe, expect, test, vi } from "vite-plus/test";
import {
  createSetupLogic,
  defaultPluginLimits,
  loadJsSetupPlugin,
} from "@-/me.unduo.components.setup.plugin";
import type { SetupEvent } from "@-/me.unduo.components.setup.plugin";
import { readSetupPlugin } from "@-/me.unduo.components.setup.plugin/server";

// Differential tests: the TypeScript port in `js-plugin.ts` and the committed
// `setup.wasm` get the same events and must return the same JSON, byte for
// byte, or both refuse the event. The scenarios port the inputs of the Rust
// tests in crates/setup, then add edge cases where JavaScript's built-ins
// differ from Rust's, then a seeded random walk.

const module = await WebAssembly.compile(new Uint8Array(readSetupPlugin().bytes));

/**
 * A fresh instance of the plugin and a call to its `name` export with no
 * guard: Extism's eight kernel functions over one growing buffer.
 */
async function wasmExport(name: "update") {
  let memory = new Uint8Array(1 << 16);
  let top = 1;
  const blocks = new Map<number, number>();
  let input: Uint8Array = new Uint8Array(0);
  let output: Uint8Array | undefined;
  let error: Uint8Array | undefined;
  const at = (offset: bigint) => Number(offset);
  const imports = {
    alloc(length: bigint) {
      const start = top;
      top += Number(length);
      if (top > memory.length) {
        const grown = new Uint8Array(Math.max(top, memory.length * 2));
        grown.set(memory);
        memory = grown;
      }
      blocks.set(start, Number(length));
      return BigInt(start);
    },
    store_u8(offset: bigint, byte: number) {
      memory[at(offset)] = byte;
    },
    store_u64(offset: bigint, word: bigint) {
      new DataView(memory.buffer).setBigUint64(at(offset), word, true);
    },
    input_length: () => BigInt(input.length),
    input_load_u8: (offset: bigint) => input[at(offset)],
    input_load_u64: (offset: bigint) =>
      new DataView(input.buffer, input.byteOffset).getBigUint64(at(offset), true),
    output_set(offset: bigint, length: bigint) {
      output = memory.slice(at(offset), at(offset) + Number(length));
    },
    error_set(offset: bigint) {
      error = memory.slice(at(offset), at(offset) + (blocks.get(at(offset)) ?? 0));
    },
  };
  const { exports } = await WebAssembly.instantiate(module, { "extism:host/env": imports });
  const run = exports[name] as () => number;
  return (bytes: Uint8Array) => {
    input = bytes;
    top = 1;
    blocks.clear();
    output = error = undefined;
    if (run() !== 0) throw new Error(new TextDecoder().decode(error));
    return new TextDecoder().decode(output);
  };
}

/**
 * Each case with a short title. Vitest prints the title of a slow test, and these
 * inputs run to 2 MB: one output line that long is the only thing that sets a CI
 * run of `vp test` apart from one that finishes.
 */
function titled<T>(cases: T[]) {
  return cases.map((value): [string, T] => {
    const json = JSON.stringify(value) ?? String(value);
    return [json.length > 80 ? `${json.slice(0, 60)}… (${json.length} characters)` : json, value];
  });
}

/** How many events both sides answered identically, and how many both refused. */
const counts = { same: 0, refused: 0 };
/** What the compared outputs held: steps, effects and view states. */
const seen = new Map<string, number>();
const note = (key: string) => seen.set(key, (seen.get(key) ?? 0) + 1);

type Output = {
  view: Record<string, unknown> & { linkError: string; current: number };
  effects: ({ type: string } & Record<string, unknown>)[];
};

/**
 * A page with both implementations side by side. `send` gives each the same
 * event and expects the same output, or that both refuse it.
 */
async function page() {
  const wasm = await wasmExport("update");
  const js = createSetupLogic();
  let last: Output | undefined;
  const send = (event: unknown): Output | undefined => {
    const json = typeof event === "string" ? event : JSON.stringify(event);
    let expected: string | undefined;
    let actual: string | undefined;
    let wasmError: unknown;
    let jsError: unknown;
    try {
      expected = wasm(new TextEncoder().encode(json));
    } catch (error) {
      wasmError = error;
    }
    try {
      actual = js(json);
    } catch (error) {
      jsError = error;
    }
    if (wasmError || jsError) {
      expect({ json, wasm: !!wasmError, js: !!jsError }).toEqual({ json, wasm: true, js: true });
      counts.refused++;
      return undefined;
    }
    expect(actual, json.slice(0, 300)).toBe(expected);
    counts.same++;
    last = JSON.parse(expected!) as Output;
    const { view } = last;
    note(`step ${view.current}`);
    for (const { type } of last.effects) note(`effect ${type}`);
    for (const key of ["request", "account", "problem", "submitted", "copyError"])
      if (view[key]) note(`view.${key}`);
    if (view.linkError) note(`linkError ${view.linkError.slice(0, 24)}`);
    return last;
  };
  /** The effect of this type in the last output, with the ticket, value or event it carries. */
  const effect = (type: string): unknown => last?.effects.find((entry) => entry.type === type);
  return { send, effect };
}

/** Characters that look like nothing or like ASCII, written by code point so a reader can tell them apart. */
const BOM = String.fromCharCode(0xfeff);
const NBSP = String.fromCharCode(0xa0);
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const IDEOGRAPHIC_SPACE = String.fromCharCode(0x3000);
const KELVIN = String.fromCharCode(0x212a);

const VALUE = "TESTCODE123-YXBpLTEyMzQ1Njc4LmR1b3NlY3VyaXR5LmNvbQ";
const LINK = "https://m-12345678.duosecurity.com/activate/TESTCODE123";
const host64 = "YXBpLTEyMzQ1Njc4LmR1b3NlY3VyaXR5LmNvbQ";
const load = (hash = "", legacy = "", extra = {}) => ({
  type: "load",
  hash,
  legacy,
  platform: "MacIntel",
  scan: true,
  ...extra,
});
const ok = (customer: string, secret: string) =>
  JSON.stringify({ stat: "OK", response: { customer_name: customer, hotp_secret: secret } });
const reply = ok("ACME University", "supersecretkey");

/** Every event type in `SetupEvent`, each of which some test below sends. */
const eventTypes: SetupEvent["type"][] = [
  "load",
  "navigate",
  "goTo",
  "changeType",
  "startOver",
  "input",
  "editLink",
  "unreadable",
  "decoded",
  "scanStarted",
  "scanSharing",
  "scanEnded",
  "prepared",
  "submitted",
  "retry",
  "reveal",
  "copied",
  "copyFailed",
  "copyDone",
];
const sentTypes = new Set<string>();
/** A page that also notes the types it sends. */
async function trackedPage() {
  const { send, effect } = await page();
  return {
    effect,
    send: (event: Record<string, unknown> | string) => {
      if (typeof event === "object") sentTypes.add(String(event.type));
      return send(event);
    },
  };
}

/** Paste `value` on the QR step and get its Duo request ready. */
async function activated(hash = "#step=qr", extra = {}) {
  const p = await trackedPage();
  p.send(load(hash, "", extra));
  p.send({ type: "input", text: LINK });
  p.send({ type: "prepared", value: VALUE, ok: true });
  return p;
}

describe("the scenarios of crates/setup's tests", () => {
  test("walks through the whole flow", async () => {
    const { send, effect } = await trackedPage();
    send(load());
    send({ type: "goTo", step: 2 });
    send({ type: "input", text: LINK });
    send({ type: "prepared", value: VALUE, ok: true });
    send({ type: "submitted", value: VALUE });
    send({ type: "input", text: "not a Duo reply" });
    send({ type: "input", text: `${"-".repeat(65_536)}x` });
    send({ type: "input", text: "-".repeat(65_536) });
    const done = send({ type: "input", text: reply });
    expect(done!.view.current).toBe(4);
    send({ type: "reveal" });
    send({ type: "copied", kind: "uri" });
    send((effect("later") as { event: Record<string, unknown> }).event);
    send({ type: "changeType", codeType: "totp" });
    send({ type: "changeType", codeType: "hotp" });
    send({ type: "changeType", codeType: "TOTP" });
    send({ type: "startOver", step: 2 });
  });

  test("keeps the session in memory", async () => {
    const { send } = await activated();
    send({ type: "submitted", value: VALUE });
    send({ type: "navigate", hash: "#step=qr" });
    send({ type: "navigate", hash: "#step=activate" });
    send({ type: "retry" });
    send({ type: "navigate", hash: "##step=add" });
    send({ type: "submitted", value: "OTHER" });
    const reloaded = await trackedPage();
    reloaded.send(load("#step=activate"));
  });

  test("ignores sessions in old links and corrects unavailable steps", async () => {
    const session = { value: VALUE, account: { customer: "ACME", secret: "ON2XAZLS" } };
    const old = btoa(JSON.stringify({ version: 1, search: { step: "add" }, session }));
    for (const [hash, legacy] of [
      [`#${old}`, ""],
      ["", "?step=add&type=totp"],
      ["#/?step=qr", ""],
      ["#step=portal", ""],
      ["#step=qr", "?step=add"],
      ["#type=totp", "?step=qr&type=hotp"],
      ["", "#/?step=activate"],
    ]) {
      const { send } = await trackedPage();
      send(load(hash, legacy));
      send({ type: "goTo", step: 4 });
      send({ type: "goTo", step: 0 });
    }
    for (const platform of ["Win32", "MacIntel", "iPhone", "IPAD", "Linux x86_64", "", "macOS"]) {
      const { send } = await trackedPage();
      send({ type: "load", hash: "", legacy: "", platform, scan: false });
    }
  });

  test("routes pasted content", async () => {
    const { send, effect } = await trackedPage();
    send(load("#step=qr"));
    send({
      type: "input",
      html: `<img src="https://api-12345678.duosecurity.com/frame/qr?value=${VALUE}">`,
      image: true,
    });
    send({ type: "input", image: true });
    const ticket = (effect("readImage") as { ticket: number }).ticket;
    send({ type: "decoded", ticket: ticket - 1, texts: [LINK] });
    send({ type: "decoded", ticket, texts: ["https://university.example/login"] });
    send({ type: "input", image: true });
    send({ type: "unreadable", ticket: ticket + 1 });
    send({ type: "input", image: true });
    send({ type: "unreadable", ticket: ticket + 1 });
    send({
      type: "decoded",
      ticket: ticket + 2,
      texts: ["otpauth://totp/Other?secret=GEZDGNBVGY3TQOJQ", LINK],
    });
    send({ type: "input", text: "https://example.com" });
    send({ type: "editLink" });
    send({ type: "input", text: "https://example.com" });
    send({ type: "goTo", step: 2 });
    send({ type: "input", text: "https://example.com" });
    send({ type: "input", text: reply });
    send({ type: "input", text: LINK });
    send({ type: "input", image: true });
  });

  test("ignores unrelated and unsafe codes", async () => {
    for (const text of [
      "https://university.example/login",
      "otpauth://totp/AlreadyActivated?secret=GEZDGNBVGY3TQOJQ",
      "FIDO:/1234567890",
      "duo://TESTCODE123-bG9jYWxob3N0",
      `https://evil.example/?value=${VALUE}`,
    ]) {
      const { send, effect } = await trackedPage();
      send(load("#step=qr"));
      send({ type: "input", image: true });
      send({
        type: "decoded",
        ticket: (effect("readImage") as { ticket: number }).ticket,
        texts: [text],
      });
    }
  });

  test("reports scans and failures, up to the 600-frame limit", async () => {
    const { send, effect } = await trackedPage();
    send(load("#step=qr"));
    send({ type: "scanSharing" });
    send({ type: "scanEnded", error: "NotAllowedError" });
    send({ type: "scanStarted" });
    send({ type: "scanSharing" });
    let ticket = (effect("scanFrame") as { ticket: number }).ticket;
    send({ type: "decoded", ticket, texts: ["FIDO:/1234567890"] });
    send({ type: "decoded", ticket, texts: [`duo://${VALUE}`] });
    send({ type: "decoded", ticket, texts: [LINK] });
    send({ type: "prepared", value: VALUE, ok: false });
    send({ type: "prepared", value: VALUE, ok: true });
    for (const error of ["NotAllowedError", undefined, "AbortError", "NotReadableError", ""]) {
      send({ type: "scanStarted" });
      send(error === undefined ? { type: "scanEnded" } : { type: "scanEnded", error });
    }
    send({ type: "scanStarted" });
    send({ type: "scanSharing" });
    ticket = (effect("scanFrame") as { ticket: number }).ticket;
    for (let frame = 0; frame < 600; frame++) send({ type: "decoded", ticket, texts: [] });
    expect(effect("stopScan")).toBeTruthy();
    send({ type: "decoded", ticket, texts: [] });
    send({ type: "scanSharing" });
    send({ type: "scanEnded" });
  });

  test("copies the portal link, and starts over after a reload", async () => {
    const { send } = await trackedPage();
    send(load());
    send({ type: "copied", kind: "portal" });
    send({ type: "goTo", step: 2 });
    send({ type: "navigate", hash: "" });
    send({ type: "goTo", step: 0 });
    const reloaded = await activated("#step=activate&type=totp");
    reloaded.send({ type: "input", text: reply });
    reloaded.send({ type: "startOver", step: 2 });
    reloaded.send({ type: "startOver", step: 0 });
  });

  test("copies and reveals the key", async () => {
    const { send, effect } = await trackedPage();
    send(load("#step=qr"));
    send({ type: "input", text: reply });
    send({ type: "copyFailed" });
    send({ type: "copied", kind: "key" });
    const first = (effect("later") as { event: { id: number } }).event.id;
    send({ type: "copied", kind: "secret" });
    send({ type: "copyDone", id: first });
    send({ type: "copyDone", id: first + 1 });
    send({ type: "reveal" });
    send({ type: "reveal" });
    send({ type: "startOver", step: 2 });
  });

  test("navigates by step number, including numbers past the last step", async () => {
    const { send } = await activated("#step=qr");
    for (const step of [0, 1, 2, 3, 4, 5, 6, 99, 4_294_967_295, 3, 0]) send({ type: "goTo", step });
    for (const step of [0, 1, 2, 3, 4, 5, 7]) send({ type: "startOver", step });
  });
});

/** Send `text` everywhere the logic reads activation text: typed, in copied HTML, and as a QR code's text. */
async function sendActivation(text: string) {
  const { send, effect } = await trackedPage();
  send(load("#step=qr"));
  send({ type: "input", text });
  send({ type: "input", text: "  " });
  send({ type: "input", html: `<img src="${text.replaceAll('"', "&quot;")}">`, text: "x" });
  send({ type: "input", image: true });
  send({
    type: "decoded",
    ticket: (effect("readImage") as { ticket: number }).ticket,
    texts: [text],
  });
  const prepare = effect("prepare") as { value: string } | undefined;
  if (prepare) send({ type: "prepared", value: prepare.value, ok: true });
}

const nested = `https://api-12345678.duosecurity.com/frame/qr?value=https://api-12345678.duosecurity.com/frame/qr?value=https://api-12345678.duosecurity.com/frame/qr?value=${VALUE}`;
/** Base64 of `host`, without padding, as Duo writes it. */
const base64 = (host: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(host))).replace(/=+$/, "");

test.each(
  titled([
    // activation.rs: every copyable format.
    VALUE,
    `${VALUE}==`,
    `duo://${VALUE}`,
    `duo%3A%2F%2F${VALUE}`,
    LINK,
    "https://m-12345678.duosecurity.com/android/TESTCODE123/",
    "https://M-12345678.DUOSECURITY.COM/iphone/TESTCODE123",
    `https://api-12345678.duosecurity.com/frame/qr?value=${VALUE}`,
    `https://api-12345678.duosecurity.com/frame/qr?value=duo%3A%2F%2F${VALUE}`,
    `  ${LINK}  `,
    `Your link: ${LINK}. Thanks!`,
    // activation.rs: plus signs, unsafe and unrelated input, and values.
    "https://api-12345678.duosecurity.com/frame/qr?value=ABCDE12345-++++",
    "",
    `https://evil.example/?value=${VALUE}`,
    LINK.replace("https:", "http:"),
    LINK.replace("https://", "https://user@"),
    LINK.replace(".com/", ".com:8443/"),
    "https://api-12345678.duosecurity.com/frame/qr",
    "https://m-12345678.duosecurity.com/manage",
    "TESTCODE123-bG9jYWxob3N0",
    "duo://TESTCODE123-bG9jYWxob3N0",
    "https://",
    "TEST-%%%%",
    "A".repeat(4097),
    "A".repeat(4096),
    nested,
    "ABCD-YXBpLTEyMzQ1Njc4LmR1b3NlY3VyaXR5LmNvbQ",
    "TESTCODE123",
    `TESTCODE123-${base64("api-1234567.duosecurity.com")}`,
    `TESTCODE123-${base64("api-123456789.duosecurity.com")}`,
    "https://m-123456789.duosecurity.com/activate/TESTCODE123",
    // Rust's whitespace: U+0085 is, U+FEFF isn't; `\s` in regex-lite is ASCII only.
    `\u0085${LINK}\u0085`,
    `${BOM}${LINK}`,
    `${LINK}${BOM}`,
    `${NBSP}${LINK}${IDEOGRAPHIC_SPACE}`,
    `See:${NBSP}${LINK}`,
    `See: ${LINK}${NBSP}now`,
    `x${LINE_SEPARATOR}${LINK}.`,
    `\v${LINK}`,
    // Base64 the way the base64 crate decodes it: canonical, with no stray bits.
    `${VALUE.slice(0, -1)}R`,
    `${VALUE}=`,
    `${VALUE}===`,
    "TESTCODE123-YXBpL",
    "TESTCODE123-YXBpLT",
    `TESTCODE123-${host64.replaceAll("L", "-")}`,
    `TESTCODE123-${base64("API-12345678.DUOSECURITY.COM")}`,
    `TESTCODE123-${base64(`${BOM}api-12345678.duosecurity.com`)}`,
    `TESTCODE123-${base64(`api-1234567${KELVIN}.duosecurity.com`)}`,
    `TESTCODE123-${btoa("api-1234567\xff.duosecurity.com").replace(/=+$/, "")}`,
    `TESTCODE123-${host64}-extra`,
    `TESTCO_E123-${host64}`,
    `TESTCODE123-${host64}`.toLowerCase(),
    `T-${host64}`,
    `${"A".repeat(128)}-${host64}`,
    `${"A".repeat(129)}-${host64}`,
    // Percent-decoding, as Rust's `u8::from_str_radix` reads two characters.
    `duo%3a%2f%2fTESTCODE123-${host64}`,
    `DUO%3A%2F%2FTESTCODE123-%59XBpLTEyMzQ1Njc4LmR1b3NlY3VyaXR5LmNvbQ`,
    `duo%3A%2F%2F%+5ESTCODE123-${host64}`,
    `duo%3A%2F%2FTESTCODE123-${host64}%`,
    `duo%3A%2F%2FTESTCODE123-${host64}%4`,
    `duo%3A%2F%2FTESTCODE123-${host64}%zz`,
    `duo%3A%2F%2FTESTCODE123-${host64}%e9`,
    `duo%3A%2F%2FTESTCODE123-${host64}%C3%A9`,
    `duo%3A%2F%2F%E2%82`,
    `duo%3A%2F%2Fé${VALUE}`,
    `duo://duo://${VALUE}`,
    `DUO://${VALUE}`,
    // URLs, through the platform's WHATWG parser and the url crate.
    "https://m-12345678.duosecurity.com:443/activate/TESTCODE123",
    "https://m-12345678.duosecurity.com\\activate\\TESTCODE123",
    `${LINK}?x=1#y`,
    `${LINK}//`,
    "https://m-12345678.duosecurity.com//activate/TESTCODE123",
    "https://m%2D12345678.duosecurity.com/activate/TESTCODE123",
    "https://m-12345678.duosecurity.com./activate/TESTCODE123",
    "https://m-12345678.duosecurity.com/activate/TESTCODE%31",
    "https://m-12345678.duosecurity.com/ACTIVATE/TESTCODE123",
    "https://m-1234567k.duosecurity.com/activate/TESTCODE123",
    `https://m-1234567${KELVIN}.duosecurity.com/activate/TESTCODE123`,
    "https://m-12345678.duosecurity.com\t/activate/TESTCODE123",
    "HTTPS://m-12345678.DUOSECURITY.com/activate/TESTCODE123",
    "hTtPs://m-12345678.duosecurity.com/activate/TESTCODE123",
    `https://api-12345678.duosecurity.com/frame/qr??value=${VALUE}`,
    `https://api-12345678.duosecurity.com/frame/qr?value=&value=${VALUE}`,
    `https://api-12345678.duosecurity.com/frame/qr?a=1&value=${VALUE}`,
    `https://api-12345678.duosecurity.com/frame/qr?value=${encodeURIComponent(`duo://${VALUE}`)}`,
    `https://api-12345678.duosecurity.com/frame/qr?value=${encodeURIComponent(LINK)}`,
    `https://api-12345678.duosecurity.com/frame/qr?valu%65=${VALUE}`,
    `https://api-12345678.duosecurity.com/frame/qr?value=${VALUE}%FF`,
    `https://api-12345678.duosecurity.com/frame/qr?value=%EF%BB%BF${VALUE}`,
    `https://api-12345678.duosecurity.com/frame/qr#value=${VALUE}`,
    "https://api-12345678.duosecurity.com/frame/qr?value=",
    "https://[::1]/activate/TESTCODE123",
    "https://1.2.3.4/activate/TESTCODE123",
    "https://0x7f.1/",
    "https://a b/",
    "https://ünduo.example/activate/TESTCODE123",
    "https://ｍ-12345678.duosecurity.com/activate/TESTCODE123",
    "https://m-12345678。duosecurity.com/activate/TESTCODE123",
    "https://m-12345678.duo\u00adsecurity.com/activate/TESTCODE123",
    "https://M-12345678.DUOSECURİTY.COM/activate/TESTCODE123",
    "https://m-12345678.duosecurity.com\u200d/activate/TESTCODE123",
    "https://xn--ls8h.duosecurity.com/activate/TESTCODE123",
    "https://m-12345678.duosecurity.co\u0301m/activate/TESTCODE123",
    "https://%6D-12345678.duosecurity.com/activate/TESTCODE123",
    "https://m-12345678.duosecurity.com%2E/activate/TESTCODE123",
    "https://m-12345678.duosecurity.com:/activate/TESTCODE123",
    "https://1.2.3.4.5/activate/TESTCODE123",
    "https://999999999999/activate/TESTCODE123",
    "https://[::1/activate/TESTCODE123",
    "https://a<b/activate/TESTCODE123",
    "https://a%00b/activate/TESTCODE123",
    "https://:pass@m-12345678.duosecurity.com/activate/TESTCODE123",
    "https:///m-12345678.duosecurity.com/activate/TESTCODE123",
    "https:m-12345678.duosecurity.com/activate/TESTCODE123",
    "http://",
    "https://duosecurity.com/",
    "https://www.duosecurity.com/activate/TESTCODE123",
    // Links inside messages, and where sentences end.
    `See ${LINK}!?`,
    `Links: https://example.com and duo://${VALUE}.`,
    `(${LINK})`,
    `<${LINK}>`,
    `"${LINK}"`,
    `'${LINK}'`,
    `[${LINK}]`,
    `x HTTPS://m-12345678.duosecurity.com/activate/TESTCODE123`,
    `x ${LINK}...;;`,
    `${"word ".repeat(900)}${LINK}`,
    `nothing here: https://example.com duo://nope`,
  ]),
)("reads the activation text %s the same way", (_, text) => sendActivation(text));

/**
 * Links the two URL parsers read differently: a label that starts with `xn--`
 * but isn't valid punycode. The url crate refuses to parse the link ("That
 * link is incomplete"); Node's WHATWG parser keeps the label, so the port
 * names the host instead. Neither starts an activation.
 */
test.each(
  titled([
    "https://xn--m-12345678.duosecurity.com/activate/TESTCODE123",
    "https://m-12345678.xn--duosecurity-.com/activate/TESTCODE123",
  ]),
)("refuses %s with the URL parser's own message", async (_, text) => {
  const wasm = await wasmExport("update");
  const js = createSetupLogic();
  const both = (event: unknown) => {
    const json = JSON.stringify(event);
    return [wasm(new TextEncoder().encode(json)), js(json)].map(
      (output) => JSON.parse(output) as Output,
    );
  };
  both(load("#step=qr"));
  const [fromWasm, fromJs] = both({ type: "input", text });
  expect(fromWasm!.view.linkError).toBe(
    "That link is incomplete. Copy the whole QR image address or activation link.",
  );
  expect(fromJs!.view.linkError).not.toBe("");
  expect({ ...fromJs, view: { ...fromJs!.view, linkError: "" } }).toEqual({
    ...fromWasm,
    view: { ...fromWasm!.view, linkError: "" },
  });
});

describe("copied HTML", () => {
  test.each(
    titled([
      `<meta charset='utf-8'><img src="https://api-12345678.duosecurity.com/frame/qr?value=${VALUE}&amp;b=1" alt="QR">`,
      `<IMG ALT=x SRC='https://api-12345678.duosecurity.com/frame/qr?value=${VALUE.replace("Y", "&#89;")}'>`,
      `<img src=${LINK}>`,
      `<!-- <img src=${LINK}> --><img src=shown>`,
      `<!-- <img src=x> --><img src=${LINK}>`,
      `<!-- unterminated <img src=${LINK}>`,
      `<!--><img src=${LINK}>`,
      `<imgx src=${LINK}><img alt=b>`,
      `<imgx src=a><img src=${LINK}>`,
      "<p>text</p>",
      `<img src="${LINK}`,
      `<img src='${LINK}`,
      `<img src=`,
      `<img src>`,
      `<img`,
      `<img/src=${LINK}>`,
      `<img\fsrc=${LINK}>`,
      `<img\vsrc=${LINK}>`,
      `<img alt="a>b" src=${LINK}>`,
      `<img =x src=${LINK}>`,
      `<img "src"=${LINK} src=${LINK}>`,
      `<img src = "${LINK}">`,
      `<img data-src=x src=${LINK}>`,
      `<img src=${LINK} src=other>`,
      `<img src="&#x68;ttps://m-12345678.duosecurity.com/activate/TESTCODE123">`,
      `<img src="&#X68;ttps://m-12345678.duosecurity.com/activate/TESTCODE123">`,
      `<img src="&#104;ttps://m-12345678.duosecurity.com/activate/TESTCODE123">`,
      `<img src="&#+104;ttps://m-12345678.duosecurity.com/activate/TESTCODE123">`,
      `<img src="&#x+68;ttps://m-12345678.duosecurity.com/activate/TESTCODE123">`,
      `<img src="&#x;&#;&#x110000;&#xD800;&#0;&#00000104;&#x0000068;&amp;&lt;&gt;&quot;&apos;&nbsp;&AMP;&ampx;&é;&${"a".repeat(9)};&${"a".repeat(10)};${LINK}">`,
      `<img src="${LINK}&#x26;x">`,
      `<img src="${LINK}&#x2F;">`,
      `<img src="${LINK}&amp">`,
      `<IMG SRC="${LINK}"><img src=other>`,
      `<p>é<img src="${LINK}"></p>`,
      `<img alt="é" src="https://api-12345678.duosecurity.com/frame/qr?value=${VALUE}">`,
    ]),
  )("finds the first image's source in %s the same way", async (_, html) => {
    const { send, effect } = await trackedPage();
    send(load("#step=qr"));
    send({ type: "input", html });
    send({ type: "input", html, image: true });
    send({ type: "input", html, text: reply });
    send({ type: "input", html: null, text: null, image: false });
    const prepare = effect("prepare") as { value: string } | undefined;
    if (prepare) send({ type: "prepared", value: prepare.value, ok: true });
  });
});

/** Paste `text` as Duo's reply, both before and after submitting the form. */
async function sendReply(text: string) {
  const before = await trackedPage();
  before.send(load("#step=qr"));
  before.send({ type: "input", text });
  before.send({ type: "input", html: text });
  const after = await activated();
  after.send({ type: "submitted", value: VALUE });
  after.send({ type: "input", text });
  after.send({ type: "retry" });
  after.send({ type: "input", text });
  after.send({ type: "changeType", codeType: "totp" });
  after.send({ type: "reveal" });
}

/** A reply whose JSON parse fails in serde, and so goes through the viewer text, but not in JSON.parse. */
const deep = (levels: number) =>
  `{"stat":"OK","response":{"customer_name":"A\\u0042","hotp_secret":"x"},"n":${"[".repeat(levels)}${"]".repeat(levels)}}`;

test.each(
  titled([
    // response.rs: replies as browsers copy them.
    reply,
    `Pretty-print\n${reply}\n`,
    'response\ncustomer_name: "ACME University"\nhotp_secret: "supersecretkey"\nstat: "OK"',
    "customer_name: ACME University\nhotp_secret: supersecretkey\nstat: OK",
    ok("  ", "x"),
    ok("ACME U & Co", "ABC"),
    // response.rs: Duo's failures.
    '{"code":40403,"message":"Unknown activation code","stat":"FAIL"}',
    '{"code":40002,"message":"Invalid   request\\nparameters","stat":"FAIL"}',
    'code: 40403\nmessage: "Unknown activation code"\nstat: "FAIL"',
    '{"stat":"FAIL"}',
    // response.rs: anything else.
    "hello",
    '{"stat":"OK"}',
    '{"stat":"OK","response":{"customer_name":"A","hotp_secret":""}}',
    '{"stat":"FAIL","code":"40403"}',
    '{"stat":"FAIL","code":1.5}',
    '{"stat":"FAIL","code":null}',
    "[1,2,3]",
    "x".repeat(2_000_001),
    `${'{"stat":"OK","x":"'}${"x".repeat(1_999_990)}"}`,
    '{"stat": "OK"}',
    "hotp_secret: x\nstat: FAIL",
    "https://m-1.duosecurity.com/activate/ABCDE",
    // Where serde_json and JSON.parse differ: nesting, number range, surrogates.
    deep(126),
    deep(127),
    '{"stat":"FAIL","code":1e400,"message":"a\\"b"}',
    '{"stat":"FAIL","code":-1e400}',
    '{"stat":"FAIL","code":1e-400}',
    '{"stat":"OK","response":{"customer_name":"\\ud800","hotp_secret":"x"}}',
    '{"stat":"OK","response":{"customer_name":"\\udc00x","hotp_secret":"x"}}',
    '{"stat":"OK","response":{"customer_name":"\\ud83d\\ude00","hotp_secret":"x"}}',
    '{"stat":"OK","\\ud800":1,"response":{"customer_name":"A\\u0042","hotp_secret":"x"}}',
    // Numbers.
    '{"stat":"FAIL","code":-0}',
    '{"stat":"FAIL","code":40403.0}',
    '{"stat":"FAIL","code":4.0403e4}',
    '{"stat":"FAIL","code":1e2}',
    '{"stat":"FAIL","code":9007199254740991}',
    '{"stat":"FAIL","code":9007199254740992}',
    '{"stat":"FAIL","code":-9007199254740991}',
    '{"stat":"FAIL","code":18446744073709551616}',
    '{"stat":"FAIL","code":-5,"message":""}',
    '{"stat":"FAIL","code":5,"message":null}',
    '{"stat":"FAIL","code":5,"message":7}',
    "code: 1e2\nstat: FAIL",
    "code: inf\nstat: FAIL",
    "code: -Infinity\nstat: FAIL",
    "code: NaN\nstat: FAIL",
    "code: +5\nstat: FAIL",
    "code: 5.\nstat: FAIL",
    "code: .5\nstat: FAIL",
    "code: -0\nstat: FAIL",
    "code: 0x10\nstat: FAIL",
    "code: 1_000\nstat: FAIL",
    "code: 007\nstat: FAIL",
    "code: 1e400\nstat: FAIL",
    'code: "5"\nstat: FAIL',
    // Messages: Rust's whitespace, 200 code points, 1000 UTF-16 units.
    JSON.stringify({
      stat: "FAIL",
      message: `a\u0085b${NBSP}c${BOM}d${LINE_SEPARATOR}e${IDEOGRAPHIC_SPACE}f`,
    }),
    JSON.stringify({ stat: "FAIL", message: "😀".repeat(250) }),
    JSON.stringify({ stat: "FAIL", message: "x".repeat(1000) }),
    JSON.stringify({ stat: "FAIL", message: "x".repeat(1001) }),
    JSON.stringify({ stat: "FAIL", message: "😀".repeat(500) }),
    JSON.stringify({ stat: "FAIL", message: `${"😀".repeat(499)}xy` }),
    JSON.stringify({ stat: "FAIL", code: 40403, message: "x".repeat(1001) }),
    'message: "Device limit"\nstat: FAIL\ncode: 1',
    "message: bare words\nstat: FAIL",
    // Names and secrets.
    ok(`\u0085ACME${BOM}`, "x"),
    ok(BOM, "x"),
    ok("École & Co / 100%", "sécret"),
    ok("😀", "😀"),
    ok("x".repeat(4096), "y".repeat(4096)),
    ok("x".repeat(4097), "y"),
    ok("x", "y".repeat(4097)),
    ok('ACME "U"', "supersecretkey"),
    JSON.stringify({ stat: "OK", response: [] }),
    JSON.stringify({ stat: "OK", response: null }),
    JSON.stringify({ stat: "OK", response: { customer_name: 1, hotp_secret: "x" } }),
    '{"stat":"FAIL","stat":"OK","response":{"customer_name":"A","hotp_secret":"x"}}',
    '[{"stat":"OK"}]',
    '"stat OK"',
    "null",
    "42 stat OK",
    // Labels around the JSON, and Firefox's viewer text.
    `Raw Data  Headers  Save  Copy\n${reply}`,
    `{ label } ${reply}`,
    `${reply} trailing }`,
    "customer_name: ACME\r\nhotp_secret: abc\r\nstat: OK",
    "customer_name:\nhotp_secret: abc\nstat: OK",
    'customer_name: "unterminated\nhotp_secret: "abc"\nstat: "OK"',
    `hotp_secret: abc${LINE_SEPARATOR}stat: OK`,
    `x${LINE_SEPARATOR}customer_name: A\nhotp_secret: abc\nstat: OK`,
    "stat: OKAY\nhotp_secret: x",
    '"stat":"OK","hotp_secret":"x","customer_name":"A"',
    "{stat:OK,hotp_secret:x,customer_name:A}",
    "stat\tOK hotp_secret\vabc",
    "STAT: OK",
  ]),
)("reads the reply %s the same way", (_, text) => sendReply(text));

describe("the URL hash", () => {
  test.each(
    titled([
      "#step=activate&type=totp",
      "#step=nope&type=hotp&university=UofT&value=X&secret=Y",
      "eyJ2ZXJzaW9uIjoxLCJzZWFyY2giOnsic3RlcCI6InFyIn0sInNlc3Npb24iOnt9fQ==",
      "",
      "#",
      "!!!",
      "?step=add&type=totp&university=Uof%20T",
      "#/?step=add&type=totp",
      "step=add&type=totp",
      "#step=qr&step=add",
      "#step=add&step=qr",
      "#st%65p=q%72",
      "#step=q+r",
      "#type=to%74p",
      "#step=qr&&type=totp",
      "#step=qr=x",
      "#=qr",
      "#step",
      "#step=QR",
      "#?#?/step=qr",
      "#step=%FFqr",
      "#step=qr%",
      "#%EF%BB%BFstep=qr",
      "#step=portal",
      "#step=activate",
      "#type=totp&step=add",
    ]),
  )("reads the hash %s the same way", async (_, hash) => {
    const { send } = await activated("#step=qr");
    send({ type: "input", text: reply });
    send({ type: "navigate", hash });
    send({ type: "navigate", hash: "#step=qr" });
    const fresh = await trackedPage();
    fresh.send(load(hash, ""));
    fresh.send(load("", hash));
  });
});

describe("events serde refuses", () => {
  const lone = String.fromCharCode(0xd800);
  test.each(
    titled([
      "null",
      "[]",
      '["reveal"]',
      '"reveal"',
      "{}",
      '{"type":"evil"}',
      '{"type":1}',
      '{"type":"Reveal"}',
      '{"type":"reveal","extra":1}',
      '{"type":"goTo"}',
      '{"type":"goTo","step":-1}',
      '{"type":"goTo","step":-0}',
      '{"type":"goTo","step":4294967296}',
      '{"type":"goTo","step":4294967295}',
      '{"type":"goTo","step":"2"}',
      '{"type":"goTo","step":2.5}',
      '{"type":"goTo","step":null}',
      '{"type":"startOver","step":true}',
      '{"type":"load","hash":"","legacy":"","platform":"","scan":true}',
      '{"type":"load","hash":"","legacy":"","platform":"","scan":"yes"}',
      '{"type":"load","hash":null,"legacy":"","platform":"","scan":true}',
      '{"type":"load","legacy":"","platform":"","scan":true}',
      '{"type":"input"}',
      '{"type":"input","text":null,"html":null}',
      '{"type":"input","text":5}',
      '{"type":"input","html":["x"]}',
      '{"type":"input","image":null}',
      '{"type":"input","image":1}',
      '{"type":"decoded","ticket":1}',
      '{"type":"decoded","ticket":1,"texts":null}',
      '{"type":"decoded","ticket":1,"texts":["a",1]}',
      '{"type":"decoded","texts":[]}',
      '{"type":"scanEnded","error":null}',
      '{"type":"scanEnded","error":5}',
      '{"type":"prepared","value":"x"}',
      '{"type":"prepared","value":"x","ok":"true"}',
      '{"type":"submitted"}',
      '{"type":"copied"}',
      '{"type":"copied","kind":null}',
      '{"type":"copyDone","id":-1}',
      '{"type":"copyDone"}',
      '{"type":"unreadable","ticket":"1"}',
      '{"type":"changeType"}',
      '{"type":"navigate","hash":1}',
      '{"type":"navigate","hash":"#step=qr","extra":{"a":[1,2,{"b":null}]}}',
      `{"type":"input","text":"x","n":${"[".repeat(126)}${"]".repeat(126)}}`,
      `{"type":"input","text":"x","n":${"[".repeat(127)}${"]".repeat(127)}}`,
      '{"type":"input","text":"x","n":1e400}',
      '{"type":"input","text":"\\ud800"}',
      '{"type":"input","text":"\\udfff\\ud800"}',
      '{"type":"input","text":"\\ud83d\\ude00"}',
      JSON.stringify({ type: "input", text: `a${lone}b` }),
      JSON.stringify({ type: "decoded", ticket: 0, texts: [lone] }),
      '{"type":"input","text":"x"} ',
      '{"type":"input","text":"x"} x',
      ' \t\n\r{"type":"reveal"}',
      `${BOM}{"type":"reveal"}`,
      '{"type":"reveal",}',
      "",
      // serde also reads a list: the variant's name, then its fields in order.
      '["reveal"]',
      '["reveal",1]',
      '["reveal",null]',
      "[1]",
      "[null]",
      '["goTo",2]',
      '["goTo"]',
      '["goTo",2,3]',
      '["goTo",null]',
      '["goTo",2.0]',
      '["input"]',
      '["input",null]',
      '["input","x"]',
      `["input","${LINK}",null]`,
      '["input",null,null,true]',
      '["input","x",null,true,1]',
      '["load","#step=add","","",true]',
      '["load","","","",true,true]',
      '["load","","","",true,null]',
      '["scanEnded"]',
      '["scanEnded","x"]',
      '["scanEnded",null]',
      '["copyDone",1]',
      '["decoded",0,[]]',
      '["decoded",0]',
      '["prepared","x",true]',
      '["editLink",{}]',
      '[["reveal"]]',
      '[ "reveal" ]',
      '["Reveal"]',
      // A key written twice, and integers written as floats.
      '{"type":"reveal","type":"reveal"}',
      '{"type":"reveal","x":1,"x":2}',
      '{"type":"goTo","step":1,"step":2}',
      '{"type":"goTo","step":1,"other":2,"other":3}',
      '{"type":"goTo","step":1.0}',
      '{"type":"goTo","step":1e0}',
      '{"type":"goTo","step":10E-1}',
      '{"type":"goTo","step":1,"x":1.0}',
      '{"type":"input","text":"x","text":"y"}',
      '{"ty\\u0070e":"goTo","st\\u0065p":3}',
      '{"type":"goTo","st\\u0065p":3,"step":2}',
      '{"type":"copyDone","id":4294967295}',
      '{"type":"copyDone","id":18446744073709551616}',
      '{ "type" : "goTo" , "step" : 3 , "n" : { "a" : [ "}" , "\\"]" ] } }',
    ]),
  )("answers or refuses the event %s the same way", async (_, event) => {
    const { send } = await page();
    send(load("#step=qr"));
    send(event);
    // A refused event leaves the state as it was.
    send({ type: "input", text: LINK });
    send({ type: "goTo", step: 1 });
  });
});

/** A seeded pseudo-random number generator (mulberry32), so a failure can be replayed. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("a seeded random walk", () => {
  const texts = [
    LINK,
    VALUE,
    `duo://${VALUE}`,
    `https://api-12345678.duosecurity.com/frame/qr?value=${VALUE}`,
    `https://m-abcdefgh.duosecurity.com/activate/OTHERCODE99`,
    reply,
    ok("Other U", "anothersecret"),
    '{"code":40403,"message":"Unknown activation code","stat":"FAIL"}',
    '{"code":40002,"message":"Device  limit","stat":"FAIL"}',
    "code: 40403\nstat: FAIL",
    "not a Duo reply",
    "https://example.com",
    "FIDO:/1234567890",
    "otpauth://totp/Other?secret=GEZDGNBVGY3TQOJQ",
    "",
    "   ",
    `\u0085${LINK}`,
    "x".repeat(70_000),
    `Activate: ${LINK}.`,
    "TESTCODE123-bG9jYWxob3N0",
  ];
  const hashes = [
    "",
    "#step=qr",
    "#step=activate",
    "#step=add&type=totp",
    "#step=portal",
    "#type=totp",
    "#x",
  ];
  test.each(Array.from({ length: 40 }, (_, index) => index + 1))(
    "seed %i: 500 events",
    async (seed) => {
      const next = random(seed);
      const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!;
      const { send, effect } = await trackedPage();
      let ticket = 0;
      let value = VALUE;
      let id = 1;
      send(load(pick(hashes), pick(["", "?step=qr", "?type=totp"])));
      for (let step = 0; step < 500; step++) {
        const roll = next();
        const event =
          roll < 0.04
            ? load(pick(hashes), pick(["", "?step=add"]), {
                platform: pick(["MacIntel", "Win32", "iPhone"]),
                scan: next() < 0.5,
              })
            : roll < 0.1
              ? { type: "navigate", hash: pick(hashes) }
              : roll < 0.18
                ? { type: "goTo", step: Math.floor(next() * 6) }
                : roll < 0.21
                  ? { type: "changeType", codeType: pick(["totp", "hotp", "x"]) }
                  : roll < 0.24
                    ? { type: "startOver", step: Math.floor(next() * 3) }
                    : roll < 0.42
                      ? {
                          type: "input",
                          ...(next() < 0.8 ? { text: pick(texts) } : {}),
                          ...(next() < 0.2 ? { html: `<img src="${pick(texts)}">` } : {}),
                          ...(next() < 0.3 ? { image: true } : {}),
                        }
                      : roll < 0.45
                        ? { type: "editLink" }
                        : roll < 0.48
                          ? { type: "unreadable", ticket: next() < 0.8 ? ticket : ticket + 1 }
                          : roll < 0.58
                            ? {
                                type: "decoded",
                                ticket: next() < 0.8 ? ticket : 0,
                                texts: next() < 0.5 ? [] : [pick(texts), pick(texts)],
                              }
                            : roll < 0.62
                              ? { type: pick(["scanStarted", "scanSharing"]) }
                              : roll < 0.65
                                ? {
                                    type: "scanEnded",
                                    error: pick(["AbortError", "NotAllowedError", "x"]),
                                  }
                                : roll < 0.75
                                  ? {
                                      type: "prepared",
                                      value: next() < 0.8 ? value : "x",
                                      ok: next() < 0.85,
                                    }
                                  : roll < 0.82
                                    ? { type: "submitted", value: next() < 0.8 ? value : "x" }
                                    : roll < 0.85
                                      ? { type: "retry" }
                                      : roll < 0.88
                                        ? { type: "reveal" }
                                        : roll < 0.92
                                          ? {
                                              type: "copied",
                                              kind: pick(["key", "uri", "portal", "x"]),
                                            }
                                          : roll < 0.94
                                            ? { type: "copyFailed" }
                                            : roll < 0.98
                                              ? { type: "copyDone", id: next() < 0.8 ? id : id + 1 }
                                              : pick([
                                                  '{"type":"goTo"}',
                                                  '{"type":"nope"}',
                                                  "null",
                                                ]);
        send(event as Record<string, unknown>);
        const found = (effect("readImage") ?? effect("scanFrame")) as
          | { ticket: number }
          | undefined;
        if (found) ticket = found.ticket;
        const prepare = effect("prepare") as { value: string } | undefined;
        if (prepare) value = prepare.value;
        const later = effect("later") as { event: { id: number } } | undefined;
        if (later) id = later.event.id;
      }
    },
  );
});

describe("seeded random edits of pasted text", () => {
  /** Characters the parsers treat specially, and some they must not. */
  const alphabet = [
    ..."abcXYZ019-_.=&?#%+/:;,!'\"<>()[]{} \t\n\r\v\f".split(""),
    "\u0085",
    "\u00a0",
    "\ufeff",
    "\u2028",
    "\u3000",
    "é",
    KELVIN,
    "😀",
    "%2F",
    "%3A",
    "&amp;",
    "&#x2F;",
    "<img src=",
    "duo://",
    "https://",
    "https://m-12345678",
    "https://api-12345678",
    ".duosecurity.com",
    "/activate/",
    "stat",
    "OK",
    "FAIL",
    "hotp_secret",
    "customer_name",
    '":"',
    "\\u0041",
  ];
  const bases = [
    LINK,
    VALUE,
    `duo://${VALUE}`,
    `https://api-12345678.duosecurity.com/frame/qr?value=duo%3A%2F%2F${VALUE}`,
    `<img alt="QR" src="https://api-12345678.duosecurity.com/frame/qr?value=${VALUE}&amp;x=1">`,
    reply,
    '{"code":40002,"message":"Invalid   request","stat":"FAIL"}',
    'customer_name: "ACME University"\nhotp_secret: "supersecretkey"\nstat: "OK"',
    'code: 40403\nmessage: "Unknown"\nstat: FAIL',
    "#step=add&type=totp",
    `Activate: ${LINK}. Thanks!`,
  ];
  test.each(Array.from({ length: 20 }, (_, index) => index + 1))(
    "seed %i: 300 edited texts",
    async (seed) => {
      const next = random(1000 + seed);
      const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!;
      const edit = (text: string) => {
        let edited = text;
        for (let count = 1 + Math.floor(next() * 4); count > 0; count--) {
          const at = Math.floor(next() * (edited.length + 1));
          const roll = next();
          edited =
            roll < 0.4
              ? edited.slice(0, at) + pick(alphabet) + edited.slice(at)
              : roll < 0.7
                ? edited.slice(0, at) + edited.slice(at + 1 + Math.floor(next() * 3))
                : edited.slice(0, at) + pick(alphabet) + edited.slice(at + 1);
        }
        return edited;
      };
      const typing = await trackedPage();
      const replying = await activated();
      replying.send({ type: "submitted", value: VALUE });
      typing.send(load("#step=qr"));
      for (let step = 0; step < 300; step++) {
        const text = edit(pick(bases));
        const roll = next();
        if (roll < 0.35) typing.send({ type: "input", text });
        else if (roll < 0.5)
          typing.send({ type: "input", html: text, text: next() < 0.5 ? text : null });
        else if (roll < 0.65) {
          typing.send({ type: "input", image: true });
          const ticket =
            (typing.effect("readImage") as { ticket: number } | undefined)?.ticket ?? 0;
          typing.send({ type: "decoded", ticket, texts: [text, edit(pick(bases))] });
        } else if (roll < 0.85) {
          replying.send({ type: "input", text });
          if (next() < 0.3) replying.send({ type: "retry" });
          if (next() < 0.3) replying.send({ type: "submitted", value: VALUE });
        } else
          typing.send(
            next() < 0.5 ? { type: "navigate", hash: text } : load(text, edit("?step=qr")),
          );
        if (typing.effect("prepare")) typing.send(load("#step=qr"));
      }
    },
  );
});

test("sends every event type in SetupEvent", () => {
  expect([...sentTypes].sort()).toEqual([...eventTypes].sort());
});

describe("loadJsSetupPlugin", () => {
  test("passes every output of the JS logic through the guard in a whole setup", async () => {
    vi.resetModules();
    const fresh = await import("@-/me.unduo.components.setup.plugin");
    const send = await fresh.loadJsSetupPlugin();
    const ticketOf = (effects: { type: string; ticket?: number }[], type: string) =>
      effects.find((entry) => entry.type === type)!.ticket!;
    const loaded = await send({
      type: "load",
      hash: "",
      legacy: "",
      platform: "MacIntel",
      scan: true,
    });
    expect(loaded.view.progress).toHaveLength(5);
    await send({ type: "goTo", step: 2 });
    const image = await send({ type: "input", image: true });
    const found = await send({
      type: "decoded",
      ticket: ticketOf(image.effects, "readImage"),
      texts: [LINK],
    });
    const { value } = found.effects.find((entry) => entry.type === "prepare") as { value: string };
    await fresh.newPublicKey();
    const prepared = await send({ type: "prepared", value, ok: true });
    expect(prepared.view.request?.url).toBe(
      "https://api-12345678.duosecurity.com/push/v2/activation/TESTCODE123?customer_protocol=1",
    );
    expect(prepared.view.request?.fields).toHaveLength(16);
    await send({ type: "submitted", value });
    const added = await send({ type: "input", text: reply });
    expect(added.view.account?.uri).toMatch(/^otpauth:\/\/hotp\/Duo:ACME%20University\?/);
    await send({ type: "reveal" });
    await send({ type: "changeType", codeType: "totp" });
    await send({ type: "startOver", step: 0 });
    // The guard still refuses: a malformed event fails this call and every later one.
    await expect(send({ type: "nope" } as unknown as SetupEvent)).rejects.toThrow();
    await expect(send({ type: "reveal" })).rejects.toThrow();
  });

  test.each(
    titled([
      { ...defaultPluginLimits, maxPages: 0 },
      { ...defaultPluginLimits, timeoutMs: 1.5 },
      { ...defaultPluginLimits, timeoutMs: Number.NaN },
      { ...defaultPluginLimits, maxPages: "1024" as unknown as number },
    ]),
  )("refuses the limits %s, as loadSetupPlugin does", async (_, limits) => {
    await expect(loadJsSetupPlugin(limits)).rejects.toThrow(RangeError);
  });
});

test("counts the outputs compared", () => {
  console.log(
    `js-plugin differential: ${counts.same} identical outputs, ${counts.refused} events both refused`,
  );
  console.log(
    [...seen]
      .map(([key, count]) => `${key}: ${count}`)
      .sort()
      .join("\n"),
  );
  expect(counts.same).toBeGreaterThan(20_000);
  for (const step of [0, 1, 2, 3]) expect(seen.get(`step ${step}`)).toBeGreaterThan(100);
  for (const type of ["prepare", "readImage", "scanFrame", "stopScan", "setText", "focus", "later"])
    expect(seen.get(`effect ${type}`), type).toBeGreaterThan(20);
});
