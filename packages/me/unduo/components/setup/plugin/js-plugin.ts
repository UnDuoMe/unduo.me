import type { PluginLimits, SetupPlugin } from "@-/me.unduo.components.setup.plugin.entities";
import { defaultPluginLimits, guard } from "#setup-plugin";

/**
 * The setup flow of `crates/setup`, ported function by function to
 * TypeScript for an experimental build of the page that runs no WebAssembly.
 * `createSetupLogic()` returns a function that takes one browser event as
 * JSON and returns `{ view, effects }` as JSON, as the plugin's `update`
 * export does: the same fields in the same order, and the same text. The
 * page's state lives in that function's closure, as it lives in the plugin's
 * memory. `loadJsSetupPlugin` passes it through the same `guard()` as the
 * plugin, so the page still checks every output before using it.
 *
 * Each section names the Rust module it follows. Where JavaScript's built-ins
 * differ from Rust's (`trim`, `\s`, `^` in multi-line mode, JSON numbers and
 * unpaired surrogates, strict base64), the port spells out Rust's behavior.
 */

/** A Rust `Result<T, String>`: a value, or the message to show. */
type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(error: string): Result<T> => ({ ok: false, error });

// ---------------------------------------------------------------------------
// Text helpers that match Rust's standard library.

/** Rust's `char::is_whitespace`: the Unicode White_Space characters, all below U+FFFF. */
function isSpace(code: number) {
  return (
    (code >= 0x09 && code <= 0x0d) ||
    code === 0x20 ||
    code === 0x85 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

/** Rust's `str::trim`. JavaScript's `trim` also removes U+FEFF and keeps U+0085. */
function trim(text: string) {
  let start = 0;
  let end = text.length;
  while (start < end && isSpace(text.charCodeAt(start))) start++;
  while (end > start && isSpace(text.charCodeAt(end - 1))) end--;
  return text.slice(start, end);
}

/** Whether `text` holds a character for which `char::is_whitespace` is true. */
function hasSpace(text: string) {
  for (let index = 0; index < text.length; index++)
    if (isSpace(text.charCodeAt(index))) return true;
  return false;
}

/** Rust's `str::split_whitespace`. */
function words(text: string) {
  const found: string[] = [];
  let start = -1;
  for (let index = 0; index <= text.length; index++) {
    const space = index === text.length || isSpace(text.charCodeAt(index));
    if (space && start !== -1) {
      found.push(text.slice(start, index));
      start = -1;
    } else if (!space && start === -1) start = index;
  }
  return found;
}

/** Rust's `to_ascii_lowercase`: A to Z only. */
const asciiLower = (text: string) =>
  text.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));

/** Whether `text` starts with `prefix` (written in lower case), ignoring ASCII case. */
const startsWithIgnoringCase = (text: string, prefix: string) =>
  asciiLower(text.slice(0, prefix.length)) === prefix;

/** The UTF-8 bytes of `text`, and back. Decoding refuses invalid UTF-8 and keeps a BOM, as `String::from_utf8` does. */
const utf8 = (text: string) => new TextEncoder().encode(text);
function fromUtf8(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * Rust's `u32::from_str_radix` (and `str::parse::<u32>` in base 10): an
 * optional `+`, then at least one digit, and at most `u32::MAX`.
 */
function parseU32(text: string, radix: 10 | 16) {
  const digits = text.startsWith("+") ? text.slice(1) : text;
  if (!(radix === 16 ? /^[0-9A-Fa-f]+$/ : /^[0-9]+$/).test(digits)) return undefined;
  const value = parseInt(digits, radix);
  return value <= 0xffff_ffff ? value : undefined;
}

/** An unpaired UTF-16 surrogate, which a Rust string can't hold. */
const unpaired = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/**
 * Parse JSON as `serde_json::from_str::<Value>` does, which refuses three
 * things `JSON.parse` accepts: numbers too large for a double (`1e400`),
 * escapes that leave a surrogate unpaired (`"\ud800"`), and arrays or objects
 * nested more than 127 deep.
 */
function parseJson(text: string): { value: unknown } | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  return serdeAccepts(value, 1) ? { value } : undefined;
}

function serdeAccepts(value: unknown, depth: number): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return !unpaired.test(value);
  if (typeof value !== "object" || value === null) return true;
  if (depth > 127) return false;
  if (Array.isArray(value)) return value.every((item) => serdeAccepts(item, depth + 1));
  return Object.entries(value).every(
    ([key, item]) => !unpaired.test(key) && serdeAccepts(item, depth + 1),
  );
}

/** A JSON object, as `Value::is_object` sees it. */
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `Value::get(key)`: a field of an object, or nothing. */
const field = (value: unknown, key: string) =>
  isObject(value) && Object.hasOwn(value, key) ? value[key] : undefined;

// ---------------------------------------------------------------------------
// state.rs: the URL hash holds the step and code type only. The logic only reads it.

type Step = "qr" | "activate" | "add";

/** Public navigation fields: the step and whether the code type is `totp`. */
interface Search {
  step: Step | null;
  totp: boolean;
}

/**
 * The pairs of a form-encoded query, as `form_urlencoded::parse` reads them:
 * split on `&`, skip empty parts, split each at its first `=`, turn `+` into a
 * space, decode `%XX` bytes, then read the bytes as UTF-8 with U+FFFD for
 * invalid sequences. Unlike `URLSearchParams`, it keeps a leading `?`.
 */
function formPairs(query: string): [string, string][] {
  const decode = (text: string) => {
    const bytes = utf8(text.replaceAll("+", " "));
    const out: number[] = [];
    for (let index = 0; index < bytes.length; index++) {
      const hex = String.fromCharCode(bytes[index + 1] ?? 0, bytes[index + 2] ?? 0);
      if (bytes[index] === 0x25 && /^[0-9A-Fa-f]{2}$/.test(hex)) {
        out.push(parseInt(hex, 16));
        index += 2;
      } else out.push(bytes[index]!);
    }
    return new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array(out));
  };
  return query
    .split("&")
    .filter(Boolean)
    .map((part) => {
      const equals = part.indexOf("=");
      return equals === -1
        ? [decode(part), ""]
        : [decode(part.slice(0, equals)), decode(part.slice(equals + 1))];
    });
}

/** Keep only valid public fields from untrusted input; a later key replaces an earlier one. */
function validateSearch(data: Map<string, string>): Search {
  const step = data.get("step");
  return {
    step: step === "qr" || step === "activate" || step === "add" ? step : null,
    totp: data.get("type") === "totp",
  };
}

/**
 * Reads `#step=…`, `?step=…` and the legacy `#/?step=…`; anything else,
 * including the earlier base64 hashes, yields no fields.
 */
function parseSearch(text: string): Search {
  const query = text.replace(/^[#/?]+/, "");
  return validateSearch(new Map(formPairs(query)));
}

// ---------------------------------------------------------------------------
// activation.rs: anything a user can copy from Duo, as a `CODE-BASE64HOST` value.

const maxInput = 4096;
const notActivation =
  "That isn't a Duo activation code. Copy the QR code from your Duo portal's “Add a device” screen.";
const duoPage =
  "That's a Duo page, not the QR code. Right-click the QR code and copy the image or its address.";

/**
 * Duo's eight-character account ID between `prefix` and `.duosecurity.com`,
 * e.g. `api-1234abcd.duosecurity.com`.
 */
function duoHostId(host: string, prefix: string) {
  const suffix = ".duosecurity.com";
  if (!host.startsWith(prefix) || !host.endsWith(suffix)) return undefined;
  if (host.length < prefix.length + suffix.length) return undefined;
  const id = host.slice(prefix.length, host.length - suffix.length);
  return /^[a-z0-9]{8}$/.test(id) ? id : undefined;
}

const isCode = (code: string) => /^[A-Za-z0-9]{5,128}$/.test(code);

/** `/activate/CODE`, `/android/CODE` and `/iphone/CODE` all embed the same activation. */
function mobileCode(path: string) {
  const prefix = ["/activate/", "/android/", "/iphone/"].find((start) => path.startsWith(start));
  if (prefix === undefined) return undefined;
  const rest = path.slice(prefix.length);
  const code = rest.endsWith("/") ? rest.slice(0, -1) : rest;
  return isCode(code) ? code : undefined;
}

/** Base64 or URL-safe base64, with at most two `=` at the end. */
const isBase64Host = (encoded: string) => /^[A-Za-z0-9+/_-]+={0,2}$/.test(encoded);

/**
 * Standard base64 as the `base64` crate's `STANDARD` engine decodes it:
 * canonical padding, and the unused bits of the last character must be zero.
 * `atob` accepts both of these when they are wrong.
 */
function decodeBase64(padded: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const body = padded.replace(/=+$/, "");
  const padding = padded.length - body.length;
  if (padded.length % 4 !== 0 || padding > 2 || body.length % 4 === 1) return undefined;
  if (padding && body.length % 4 !== 4 - padding) return undefined;
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of body) {
    const digit = alphabet.indexOf(character);
    if (digit === -1) return undefined;
    buffer = ((buffer << 6) | digit) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  // The leftover bits of the last character must be zero.
  if (buffer & ((1 << bits) - 1)) return undefined;
  return new Uint8Array(bytes);
}

function decodeHost(encoded: string): Result<string> {
  const standard = encoded.replaceAll("-", "+").replaceAll("_", "/").replace(/=+$/, "");
  const padded = standard + "=".repeat((4 - (standard.length % 4)) % 4);
  const bytes = decodeBase64(padded);
  const host = bytes && fromUtf8(bytes);
  return host === undefined
    ? fail("The activation code contains an invalid Duo host.")
    : ok(host.toLowerCase());
}

/** `CODE-BASE64HOST`, the host in standard base64 without padding. The host is ASCII. */
const encodeValue = (code: string, host: string) => `${code}-${btoa(host).replace(/=+$/, "")}`;

/** Split and validate a `CODE-BASE64HOST` value. Only Duo API hosts are accepted. */
function parseActivationValue(value: string): Result<{ code: string; host: string }> {
  const dash = value.indexOf("-");
  if (dash === -1) return fail(notActivation);
  const code = value.slice(0, dash);
  const encoded = value.slice(dash + 1);
  if (!isCode(code) || !isBase64Host(encoded)) return fail(notActivation);
  const host = decodeHost(encoded);
  if (!host.ok) return host;
  if (duoHostId(host.value, "api-") === undefined)
    return fail("The activation code must point to a Duo API host (api-….duosecurity.com).");
  return ok({ code, host: host.value });
}

/**
 * A copied `https://` link. This uses the platform's WHATWG URL parser where
 * `crates/setup` uses the `url` crate; both follow the same standard.
 */
function parseUrl(text: string, depth: number): Result<string> {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return fail("That link is incomplete. Copy the whole QR image address or activation link.");
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    return fail(notActivation);
  if (duoHostId(host, "api-") !== undefined) {
    // The QR image address: `https://api-…/frame/qr?value=<the QR's text>`.
    const value = formPairs(url.search.slice(1)).find(([key]) => key === "value")?.[1];
    if (!value) return fail(duoPage);
    // Form decoding turns a literal `+` from the base64 host into a space.
    return parseActivationText(value.replaceAll(" ", "+"), depth + 1);
  }
  const id = duoHostId(host, "m-");
  const code = mobileCode(url.pathname);
  // What the QR code itself contains, and what Duo emails.
  if (id !== undefined && code !== undefined)
    return ok(encodeValue(code, `api-${id}.duosecurity.com`));
  if (host.endsWith(".duosecurity.com"))
    return fail(
      "That Duo link isn't an activation link. Copy the QR code shown after choosing “I have Duo Mobile installed”.",
    );
  return fail(
    "That's not a Duo link. Sign in to your Duo portal, add a device, then copy the QR code it shows.",
  );
}

/**
 * Decode every `%XX` byte, then read the bytes as UTF-8. Like Rust's
 * `u8::from_str_radix`, the two characters may be `+` and one hex digit.
 */
function percentDecode(text: string) {
  const bytes = utf8(text);
  const out: number[] = [];
  for (let index = 0; index < bytes.length;) {
    if (bytes[index] === 0x25) {
      if (index + 3 > bytes.length) return undefined;
      const byte = parseU32(String.fromCharCode(bytes[index + 1]!, bytes[index + 2]!), 16);
      if (byte === undefined || bytes[index + 1]! > 0x7f || bytes[index + 2]! > 0x7f)
        return undefined;
      out.push(byte);
      index += 3;
    } else out.push(bytes[index++]!);
  }
  return fromUtf8(new Uint8Array(out));
}

function parseActivationText(input: string, depth: number): Result<string> {
  if (depth > 2) return fail(notActivation);
  let text = trim(input);
  if (startsWithIgnoringCase(text, "duo%3a%2f%2f")) {
    const decoded = percentDecode(text);
    if (decoded === undefined) return fail(notActivation);
    text = decoded;
  }
  if (startsWithIgnoringCase(text, "duo://")) text = text.slice("duo://".length);
  if (startsWithIgnoringCase(text, "https://") || startsWithIgnoringCase(text, "http://"))
    return parseUrl(text, depth);
  const value = parseActivationValue(text);
  return value.ok ? ok(encodeValue(value.value.code, value.value.host)) : value;
}

/**
 * Accepts the QR image address, the QR's decoded text (`https://m-…/activate/CODE`
 * or `duo://CODE-HOST`), activation links from Duo emails, raw values, and any
 * of these inside a pasted message.
 */
function parseActivationInput(input: string): Result<string> {
  const text = trim(input);
  if (!text) return fail("Paste the QR code, its image address, or your activation link.");
  if (text.length > maxInput) return fail("That's too long to be a Duo activation link.");
  const parsed = parseActivationText(text, 0);
  if (parsed.ok || !hasSpace(text)) return parsed;
  // Pasted email or chat text: use the first Duo activation link inside it.
  // `\s` in `regex-lite` is ASCII whitespace only, as written out here.
  for (const [candidate] of text.matchAll(/(?:https:\/\/|duo:\/\/)[^\t\n\v\f\r <>"')\]]+/gi)) {
    // Sentences often end right after a link.
    let end = candidate.length;
    while (end && ".,;:!?".includes(candidate[end - 1]!)) end--;
    const value = parseActivationText(candidate.slice(0, end), 0);
    if (value.ok) return value;
  }
  return parsed;
}

/** Parse, returning nothing instead of a message. */
function tryParseActivation(text: string | undefined) {
  if (text === undefined) return undefined;
  const value = parseActivationInput(text);
  return value.ok ? value.value : undefined;
}

// ---------------------------------------------------------------------------
// html.rs: the `src` of the first `<img>` in copied HTML.

/** `u8::is_ascii_whitespace`: space, tab, line feed, form feed and carriage return. */
const isAsciiSpace = (character: string | undefined) =>
  character === " " ||
  character === "\t" ||
  character === "\n" ||
  character === "\f" ||
  character === "\r";

/** The character a reference such as `amp`, `#x2F` or `#47` names, if any. */
function entity(name: string) {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: String.fromCharCode(0xa0),
  };
  if (Object.hasOwn(named, name)) return named[name];
  let code: number | undefined;
  if (name.startsWith("#x") || name.startsWith("#X")) code = parseU32(name.slice(2), 16);
  else if (name.startsWith("#")) code = parseU32(name.slice(1), 10);
  if (code === undefined || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return undefined;
  return String.fromCodePoint(code);
}

/**
 * Decode the character references that appear in copied attribute values. A
 * reference ends at the first `;` at most ten characters after its `&`; Rust
 * counts bytes, but only ASCII names are valid, so the counts agree.
 */
function decodeEntities(value: string) {
  let out = "";
  let at = 0;
  for (let start = value.indexOf("&"); start !== -1; start = value.indexOf("&", at)) {
    out += value.slice(at, start);
    const end = value.slice(start, start + 11).indexOf(";");
    const character = end === -1 ? undefined : entity(value.slice(start + 1, start + end));
    if (character === undefined) {
      out += "&";
      at = start + 1;
    } else {
      out += character;
      at = start + end + 1;
    }
  }
  return out + value.slice(at);
}

/**
 * Where the next HTML comment opens: `<!` and then `--`, at or after `from`.
 * The page's script may not hold those four characters together.
 */
function commentStart(html: string, from: number) {
  let start = html.indexOf("<!", from);
  while (start !== -1 && !html.startsWith("--", start + 2)) start = html.indexOf("<!", start + 1);
  return start;
}

/** Drop HTML comments, which end at `-->`; an unterminated comment runs to the end. */
function withoutComments(html: string) {
  let out = "";
  let at = 0;
  for (let start = commentStart(html, 0); start !== -1; start = commentStart(html, at)) {
    out += html.slice(at, start);
    const end = html.indexOf("-->", start + 4);
    if (end === -1) return out;
    at = end + 3;
  }
  return out + html.slice(at);
}

/**
 * The `src` of the first `<img>` element, if any, as `DOMParser` and
 * `querySelector("img")` would find it. Every test is on ASCII characters, so
 * UTF-16 positions here stand in for Rust's byte positions.
 */
function firstImageSource(source: string) {
  const html = withoutComments(source);
  const lower = asciiLower(html);
  for (let found = lower.indexOf("<img"); found !== -1; found = lower.indexOf("<img", found + 4)) {
    const start = found + 4;
    const next = lower[start];
    if (!(isAsciiSpace(next) || next === "/" || next === ">")) continue;
    let index = start;
    for (;;) {
      while (index < html.length && (isAsciiSpace(html[index]) || html[index] === "/")) index++;
      if (index >= html.length || html[index] === ">") break;
      const nameStart = index;
      while (index < html.length && !isAsciiSpace(html[index]) && !"/>=".includes(html[index]!))
        index++;
      const name = lower.slice(nameStart, index);
      while (index < html.length && isAsciiSpace(html[index])) index++;
      let value: string | undefined;
      if (html[index] === "=") {
        index++;
        while (index < html.length && isAsciiSpace(html[index])) index++;
        const quote = html[index];
        let begin = index;
        let end: number;
        if (quote === '"' || quote === "'") {
          begin = index + 1;
          const close = html.indexOf(quote, begin);
          end = close === -1 ? html.length : close;
          index = Math.min(end + 1, html.length);
        } else {
          while (index < html.length && !isAsciiSpace(html[index]) && html[index] !== ">") index++;
          end = index;
        }
        value = html.slice(begin, end);
      }
      if (name === "src") return value === undefined ? undefined : decodeEntities(value);
    }
    // The first image has no src, like `querySelector("img")?.getAttribute("src")`.
    return undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// response.rs: Duo's pasted reply, the base32 secret and the otpauth:// link.

/** Duo's reply embeds the organization's logo, so allow generous sizes. */
const maxResponseLength = 2_000_000;
/** Duo's code for an activation link that is unknown, expired or already used. */
const unknownActivation = 40403;
const notResponse =
  "That doesn't look like Duo's reply. Click in Duo's reply, select everything (Ctrl+A or ⌘A), copy it, then paste it here.";

/** What an authenticator needs: the organization and the unpadded base32 secret. */
interface Account {
  customer: string;
  secret: string;
}

/** Why an import failed, and whether the user needs a fresh QR code. */
interface ReplyError {
  message: string;
  needsNewCode: boolean;
}

/** Browsers may add labels (e.g. Chrome's “Pretty-print”) around the JSON. */
function parseReplyJson(text: string) {
  const whole = parseJson(text);
  if (whole) return whole;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start !== -1 && end > start ? parseJson(text.slice(start, end + 1)) : undefined;
}

/**
 * One `name: value` field of Firefox's JSON viewer text: the quoted value, or
 * the bare one. In `regex-lite`, `\s` is ASCII whitespace and `^` in
 * multi-line mode matches only after `\n`, written out here.
 */
function viewerField(text: string, name: string) {
  const pattern = new RegExp(
    `(?:(?<![^\\n])|[\\t\\n\\v\\f\\r "{,])${name}"?[\\t\\n\\v\\f\\r :]*(?:"([^"\\n]*)"|([^\\t\\n\\v\\f\\r ",}]+))`,
  );
  const match = pattern.exec(text);
  return match ? { quoted: match[1], bare: match[2] } : undefined;
}

/**
 * Rust's `str::parse::<f64>`: a sign, then `inf`, `infinity`, `nan` or a
 * decimal number with an optional exponent.
 */
function parseF64(text: string) {
  if (!/^[+-]?(?:inf|infinity|nan|(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:e[+-]?[0-9]+)?)$/i.test(text))
    return undefined;
  const lower = asciiLower(text);
  if (lower.endsWith("nan")) return NaN;
  if (lower.endsWith("inf") || lower.endsWith("infinity"))
    return text.startsWith("-") ? -Infinity : Infinity;
  return Number(text);
}

/** Firefox's JSON viewer copies `key: value` lines instead of JSON. */
function parseViewerText(text: string): unknown {
  const stat = viewerField(text, "stat");
  const status = stat?.quoted ?? stat?.bare;
  if (status === "FAIL") {
    const code = parseF64(viewerField(text, "code")?.bare ?? "x");
    const message = viewerField(text, "message")?.quoted;
    const failure: Record<string, unknown> = { stat: "FAIL" };
    if (code !== undefined && Number.isInteger(code)) failure.code = code;
    if (message !== undefined) failure.message = message;
    return failure;
  }
  const secret = viewerField(text, "hotp_secret");
  const customer =
    /(?:(?<![^\n])|[\t\n\v\f\r "{,])customer_name"?[\t\n\v\f\r :]*(?:"([^"\n]*)"|([^\n]*))/.exec(
      text,
    );
  return {
    stat: status ?? null,
    response: {
      customer_name: customer ? trim(customer[1] ?? customer[2]!) : "",
      hotp_secret: secret?.quoted ?? secret?.bare ?? null,
    },
  };
}

/** True when pasted text is plausibly Duo's activation reply rather than a link. */
function looksLikeDuoResponse(text: string) {
  return /"?\b(?:hotp_secret|stat)\b"?[\t\n\v\f\r ]*:?/.test(text) && /\b(?:OK|FAIL)\b/.test(text);
}

/** A string of `min` to `max` UTF-16 code units. */
const stringUpTo = (value: unknown, min: number, max: number) =>
  typeof value === "string" && value.length >= min && value.length <= max ? value : undefined;

/** A JSON number that is a safe integer, as `z.number().int()` requires. */
const safeInteger = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && Math.abs(value) <= 9_007_199_254_740_991
    ? value
    : undefined;

/** RFC 4648 base32 without padding, as authenticator apps expect. */
function base32(bytes: Uint8Array) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = ((buffer << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += alphabet[(buffer >> bits) & 31];
    }
  }
  if (bits > 0) out += alphabet[(buffer << (5 - bits)) & 31];
  return out;
}

function duoError(code: number | undefined, message: string | undefined): ReplyError {
  if (code === unknownActivation)
    return {
      message:
        "Duo didn't accept this QR code: it has expired or was already used. Each code works once — create a new one in your Duo portal.",
      needsNewCode: true,
    };
  // At most 200 characters (code points, as Rust's `chars()` counts them).
  const detail = Array.from(words(message ?? "").join(" "))
    .slice(0, 200)
    .join("");
  const quoted = detail ? `: “${detail}”` : "";
  // `${-0}` is "0", as `-0.0 as i64` is.
  const number = code === undefined ? "" : ` (error ${code})`;
  return {
    message: `Duo didn't activate the device${quoted}${number}. Your organization may not allow adding devices this way.`,
    needsNewCode: false,
  };
}

/**
 * Returns only what an authenticator needs. Fails with Duo's reason when the
 * activation failed. Never evaluates code or echoes pasted credentials.
 */
function parseActivationResponse(text: string): { account: Account } | { error: ReplyError } {
  const other = (message: string) => ({ error: { message, needsNewCode: false } });
  if (text.length > maxResponseLength)
    return other("That's too long to be Duo's reply. Copy only the text of Duo's reply.");
  const parsed =
    parseReplyJson(text) ??
    (looksLikeDuoResponse(text) ? { value: parseViewerText(text) } : undefined);
  if (!parsed) return other(notResponse);
  const data = parsed.value;
  const stat = field(data, "stat");
  if (stat === "OK") {
    const response = field(data, "response");
    const customer = stringUpTo(field(response, "customer_name"), 0, 4096);
    const secret = stringUpTo(field(response, "hotp_secret"), 1, 4096);
    if (isObject(response) && customer !== undefined && secret !== undefined)
      return {
        account: { customer: trim(customer) || "Duo", secret: base32(utf8(secret)) },
      };
  }
  if (stat === "FAIL") {
    // Like zod's `.optional()`: a missing field is fine, but `null` is not.
    const code = field(data, "code");
    const message = field(data, "message");
    const codeOk = code === undefined || safeInteger(code) !== undefined;
    const messageOk = message === undefined || stringUpTo(message, 0, 1000) !== undefined;
    if (codeOk && messageOk)
      return { error: duoError(safeInteger(code), message as string | undefined) };
  }
  return other(notResponse);
}

/** Encode a URI component as JavaScript's `encodeURIComponent` does, byte by byte. */
function encodeComponent(text: string) {
  let out = "";
  for (const byte of utf8(text)) {
    const character = String.fromCharCode(byte);
    out += /[A-Za-z0-9\-_.!~*'()]/.test(character)
      ? character
      : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/**
 * A Key URI Format `otpauth://` link. HOTP is Duo's default: Duo checks this
 * device's passcodes against a counter that starts at 0.
 */
function otpauthUri(account: Account, totp: boolean) {
  const label = `Duo:${encodeComponent(account.customer)}`;
  const params = `secret=${account.secret}&issuer=Duo&algorithm=SHA1&digits=6`;
  return totp
    ? `otpauth://totp/${label}?${params}&period=30`
    : `otpauth://hotp/${label}?${params}&counter=0`;
}

// ---------------------------------------------------------------------------
// request.rs: the Duo Mobile activation URL; the host adds the fields and its key.

function activationRequest(value: string): Result<{ url: string }> {
  const input = parseActivationInput(value);
  if (!input.ok) return input;
  const parsed = parseActivationValue(input.value);
  if (!parsed.ok) return parsed;
  const { code, host } = parsed.value;
  return ok({ url: `https://${host}/push/v2/activation/${code}?customer_protocol=1` });
}

// ---------------------------------------------------------------------------
// core.rs: the step state machine and the scan loop.

/** Step indexes. */
const PORTAL = 0;
const QR = 1;
const ACTIVATE = 2;
const ADD = 3;
const steps = [
  ["Open portal", "Open your Duo device portal"],
  ["Copy QR code", "Copy the activation QR code"],
  ["Activate with Duo", "Activate with Duo"],
  ["Add to authenticator", "Add it to your authenticator"],
] as const;
const prepareFailure =
  "Your browser couldn't prepare the request. Use a current browser over HTTPS. Nothing was sent to Duo.";
/** The host waits half a second before each frame, so this is at least five minutes. */
const scanFrames = 600;
const dottedKey = "•••• •••• •••• •••• •••• ••••";
/** The most UTF-16 code units the page accepts in any string the plugin returns. */
const maxText = 65_536;

type Busy = "" | "prepare" | "image" | "scan";

/** Sensitive progress, held only in memory; reloading or closing the tab discards it. */
interface Session {
  value: string | null;
  submitted: boolean;
  account: Account | null;
}
const noSession = (): Session => ({ value: null, submitted: false, account: null });

/** Everything the page knows. Reloading or closing the tab discards it. */
interface Model {
  search: Search;
  session: Session;
  /** The step rendered last; `null` before the first render. */
  previous: number | null;
  /** The activation the host is generating a key for. `start` moves to `ACTIVATE`. */
  preparing: { value: string; start: boolean } | null;
  /** The Duo form's URL for an activation value, once the host has its key. */
  request: { value: string; url: string } | null;
  /** Values submitted in this tab, so going back cannot re-offer a used QR code. */
  sent: string[];
  /** Names the image or scan frame the plugin is waiting for; older ones are dropped. */
  ticket: number;
  scanFrames: number;
  linkError: string;
  linkBusy: Busy;
  scanNote: string;
  problem: ReplyError | null;
  revealed: boolean;
  copied: "" | "key" | "uri" | "portal";
  copyId: number;
  copyError: boolean;
  apple: boolean;
  canScan: boolean;
}

const newModel = (): Model => ({
  search: { step: null, totp: false },
  session: noSession(),
  previous: null,
  preparing: null,
  request: null,
  sent: [],
  ticket: 0,
  scanFrames: 0,
  linkError: "",
  linkBusy: "",
  scanNote: "",
  problem: null,
  revealed: false,
  copied: "",
  copyId: 0,
  copyError: false,
  apple: false,
  canScan: false,
});

/** What happened in the browser, after the checks serde makes. */
type Event =
  | {
      type: "load";
      hash: string;
      legacy: string;
      platform: string;
      scan: boolean;
    }
  | { type: "navigate"; hash: string }
  | { type: "goTo"; step: number }
  | { type: "changeType"; codeType: string }
  | { type: "startOver"; step: number }
  | { type: "input"; text: string | null; html: string | null; image: boolean }
  | { type: "editLink" | "scanStarted" | "scanSharing" | "retry" | "reveal" | "copyFailed" }
  | { type: "unreadable"; ticket: number }
  | { type: "decoded"; ticket: number; texts: string[] }
  | { type: "scanEnded"; error: string }
  | { type: "prepared"; value: string; ok: boolean }
  | { type: "submitted"; value: string }
  | { type: "copied"; kind: string }
  | { type: "copyDone"; id: number };

/** The closed list of things the logic can ask the host to do, as `core.rs` serializes them. */
type Effect =
  | { type: "prepare"; value: string }
  | { type: "readImage"; ticket: number }
  | { type: "scanFrame"; ticket: number }
  | { type: "stopScan" }
  | { type: "setText"; text: string }
  | { type: "focus"; id: string; scroll: string }
  | { type: "later"; ms: number; event: { type: "copyDone"; id: number } };

/** The call fails, as the plugin's does when serde can't read its input. */
function refuse(reason: string): never {
  throw new Error(`The setup logic can't read this event: ${reason}.`);
}

/** The JSON types of event fields: `u32` is also `usize`, 32 bits on `wasm32`. */
type Kind = "string" | "optional" | "boolean" | "u32" | "strings";

/**
 * Each event's fields in the order `core.rs` declares them, with their kind;
 * `true` marks `#[serde(default)]`, which a missing field takes: false or "".
 */
const eventFields: Record<string, [name: string, kind: Kind, defaulted?: true][]> = {
  load: [
    ["hash", "string"],
    ["legacy", "string"],
    ["platform", "string"],
    ["scan", "boolean"],
  ],
  navigate: [["hash", "string"]],
  goTo: [["step", "u32"]],
  changeType: [["codeType", "string"]],
  startOver: [["step", "u32"]],
  input: [
    ["text", "optional"],
    ["html", "optional"],
    ["image", "boolean", true],
  ],
  editLink: [],
  unreadable: [["ticket", "u32"]],
  decoded: [
    ["ticket", "u32"],
    ["texts", "strings"],
  ],
  scanStarted: [],
  scanSharing: [],
  scanEnded: [["error", "string", true]],
  prepared: [
    ["value", "string"],
    ["ok", "boolean"],
  ],
  submitted: [["value", "string"]],
  retry: [],
  reveal: [],
  copied: [["kind", "string"]],
  copyFailed: [],
  copyDone: [["id", "u32"]],
};

/**
 * The source text of each value at the top of an event's JSON, which
 * `JSON.parse` has already accepted: `[key, text]` for each entry of an
 * object, or `["", text]` for each element of a list. serde reads two things
 * from it that `JSON.parse` drops: a key written twice, and an integer
 * written as `1.0` or `1e0`, which serde reads as a float.
 */
function topLevel(json: string) {
  const entries: [string, string][] = [];
  let index = 0;
  const space = () => {
    while (index < json.length && " \t\n\r".includes(json[index]!)) index++;
  };
  const string = () => {
    const start = index++;
    while (json[index] !== '"') index += json[index] === "\\" ? 2 : 1;
    return json.slice(start, ++index);
  };
  const value = () => {
    const start = index;
    if (json[index] === '"') string();
    else if (json[index] === "{" || json[index] === "[") {
      let depth = 0;
      do {
        const character = json[index];
        if (character === '"') {
          string();
          continue;
        }
        if (character === "{" || character === "[") depth++;
        else if (character === "}" || character === "]") depth--;
        index++;
      } while (depth > 0);
    } else while (index < json.length && !",}] \t\n\r".includes(json[index]!)) index++;
    return json.slice(start, index);
  };
  space();
  const close = json[index++] === "{" ? "}" : "]";
  for (;;) {
    space();
    if (json[index] === close) return entries;
    if (json[index] === ",") index++;
    space();
    let key = "";
    if (close === "}") {
      key = JSON.parse(string()) as string;
      space();
      index++; // The colon.
      space();
    }
    entries.push([key, value()]);
  }
}

/**
 * Read one event as serde reads `core::Event`, an internally tagged enum: a
 * JSON object whose `type` names a variant, with each of its fields once and
 * of the right type, and other keys ignored; or, as serde also accepts, a list
 * of the variant's name and then its fields in order. Anything else fails the
 * call, as the plugin's does.
 */
function readEvent(json: string): Event {
  const parsed = parseJson(json);
  if (!parsed) refuse("not JSON that serde accepts");
  const data = parsed.value;
  if (typeof data !== "object" || data === null) refuse("not an object or list");
  const source = topLevel(json);
  const types = source.filter(([key]) => key === "type");
  if (!Array.isArray(data) && types.length > 1) refuse("type written twice");
  const type: unknown = Array.isArray(data) ? data[0] : field(data, "type");
  if (typeof type !== "string" || !Object.hasOwn(eventFields, type)) refuse("no known type");
  const fields = eventFields[type]!;
  /** The fields the JSON gives: their parsed value and source text. */
  const given = new Map<string, { value: unknown; text: string }>();
  if (Array.isArray(data)) {
    const values: unknown[] = data.slice(1);
    const required = fields.filter(([, , defaulted]) => !defaulted).length;
    if (values.length < required || values.length > fields.length)
      refuse("the wrong number of fields");
    values.forEach((value, index) =>
      given.set(fields[index]![0], { value, text: source[index + 1]![1] }),
    );
  } else
    for (const [name] of fields) {
      const entries = source.filter(([key]) => key === name);
      if (entries.length > 1) refuse(`${name} written twice`);
      if (entries.length) given.set(name, { value: field(data, name), text: entries[0]![1] });
    }
  const event: Record<string, unknown> = { type };
  for (const [name, kind, defaulted] of fields) {
    const entry = given.get(name);
    if (!entry) {
      if (kind === "optional") event[name] = null;
      else if (defaulted) event[name] = kind === "boolean" ? false : "";
      else refuse(`no ${name}`);
      continue;
    }
    const { value, text } = entry;
    const valid =
      kind === "string"
        ? typeof value === "string"
        : kind === "optional"
          ? value === null || typeof value === "string"
          : kind === "boolean"
            ? typeof value === "boolean"
            : kind === "u32"
              ? /^(?:0|[1-9][0-9]*)$/.test(text) && (value as number) <= 0xffff_ffff
              : Array.isArray(value) && value.every((item) => typeof item === "string");
    if (!valid) refuse(`${name} is not a ${kind}`);
    event[name] = value;
  }
  return event as Event;
}

/**
 * The step the URL names, or the furthest one before it that the session
 * allows.
 */
function currentStep(model: Model) {
  const { step } = model.search;
  const { session } = model;
  if (step === "add" && session.account) return ADD;
  if ((step === "activate" || step === "add") && session.value !== null) return ACTIVATE;
  if (step === "qr") return QR;
  return PORTAL;
}

/** The hash's step for `step`. The first step has none. */
function stepParam(step: number): Step | null {
  if (step === QR) return "qr";
  if (step === ACTIVATE) return "activate";
  if (step >= ADD) return "add";
  return null;
}

/** What the page found in one image or screen frame. */
interface QrResult {
  /** The first Duo activation among its QR codes, already normalized. */
  value: string | undefined;
  foundQr: boolean;
}

/** One event's changes to the model, and the effects it asks for. */
class Transition {
  effects: Effect[] = [];
  /** Whether this event set the text field, which a step change clears otherwise. */
  textSet = false;
  /** The link error before this event; a step change clears it if unchanged. */
  readonly linkError: string;

  constructor(readonly model: Model) {
    this.linkError = model.linkError;
  }

  current() {
    return currentStep(this.model);
  }

  submitted() {
    return this.current() === ACTIVATE && this.model.session.submitted;
  }

  setStep(step: number) {
    this.model.search.step = stepParam(step);
  }

  /** Fill the text field. Text longer than `maxText` clears it instead. */
  setText(text: string) {
    this.textSet = true;
    this.effects.push({ type: "setText", text: text.length > maxText ? "" : text });
  }

  /** Abandon pending work. Its results carry an older ticket or value and are dropped. */
  cancel() {
    if (this.model.linkBusy === "scan") this.effects.push({ type: "stopScan" });
    this.model.ticket = (this.model.ticket + 1) >>> 0;
    this.model.preparing = null;
    this.model.linkBusy = "";
    this.model.scanNote = "";
  }

  showLinkError(message: string) {
    this.model.linkError = message;
    if (this.current() !== QR) this.setStep(QR);
  }

  prepare(value: string, start: boolean) {
    this.model.preparing = { value, start };
    this.effects.push({ type: "prepare", value });
  }

  startActivation(value: string) {
    this.cancel();
    this.model.linkError = "";
    this.model.problem = null;
    this.model.linkBusy = "prepare";
    this.prepare(value, true);
  }

  importResponse(text: string) {
    const result = parseActivationResponse(text);
    if ("account" in result) {
      this.cancel();
      this.model.linkError = "";
      this.model.problem = null;
      const { session } = this.model;
      session.submitted = session.value !== null;
      session.account = result.account;
      this.model.search.totp = false;
      this.setStep(ADD);
    } else if (this.submitted()) this.model.problem = result.error;
    else this.showLinkError(result.error.message);
  }

  /**
   * Read the step from the URL, as after Back, Forward or a reload. The URL
   * never carries the session, so it stays as this tab left it.
   */
  restore(hash: string, legacy: string | null) {
    const search = parseSearch(hash);
    if (legacy !== null) {
      const old = parseSearch(legacy);
      search.step ??= old.step;
      search.totp ||= old.totp;
    }
    this.model.search = search;
  }

  endScan(message: string) {
    this.cancel();
    this.model.linkError = message;
  }

  readImage(result: QrResult) {
    this.model.linkBusy = "";
    if (result.value !== undefined) this.startActivation(result.value);
    else if (result.foundQr)
      this.showLinkError(
        "That QR code isn't a Duo activation code. Copy the one shown after choosing “I have Duo Mobile installed”.",
      );
    else
      this.showLinkError(
        "No QR code found in that image. Copy the QR code itself, or a screenshot where it's fully visible.",
      );
  }

  scanFrame(result: QrResult) {
    if (result.value !== undefined) return this.startActivation(result.value);
    if (result.foundQr)
      this.model.scanNote =
        "Found a QR code, but not Duo's. Keep the Duo activation QR code visible.";
    this.model.scanFrames += 1;
    if (this.model.scanFrames < scanFrames)
      this.effects.push({ type: "scanFrame", ticket: this.model.ticket });
    else this.endScan("No Duo QR code appeared within five minutes, so sharing stopped.");
  }

  apply(event: Event) {
    const { model } = this;
    switch (event.type) {
      case "load": {
        const platform = asciiLower(event.platform);
        model.apple = ["mac", "iphone", "ipad", "ipod"].some((name) => platform.includes(name));
        model.canScan = event.scan;
        this.restore(event.hash, event.legacy);
        return;
      }
      case "navigate":
        this.restore(event.hash, null);
        return;
      case "goTo":
        return this.setStep(event.step);
      case "changeType":
        model.search.totp = event.codeType === "totp";
        return;
      case "startOver":
        this.cancel();
        model.session = noSession();
        model.request = null;
        model.linkError = "";
        model.problem = null;
        model.search.totp = false;
        this.setText("");
        return this.setStep(event.step);
      case "input": {
        if (this.current() === ADD) return;
        const text = event.text === null ? null : trim(event.text) || null;
        if (this.submitted()) {
          if (text !== null) {
            this.setText(text);
            this.importResponse(text);
          }
          return;
        }
        if (text !== null && looksLikeDuoResponse(text)) return this.importResponse(text);
        const fromSource = tryParseActivation(
          event.html === null ? undefined : firstImageSource(event.html),
        );
        if (fromSource !== undefined) this.startActivation(fromSource);
        else if (event.image) {
          this.cancel();
          model.linkError = "";
          model.linkBusy = "image";
          this.effects.push({ type: "readImage", ticket: model.ticket });
        } else if (text !== null) {
          this.setText(text);
          const value = parseActivationInput(text);
          if (value.ok) this.startActivation(value.value);
          else this.showLinkError(value.error);
        }
        return;
      }
      case "editLink":
        model.linkError = "";
        return;
      case "unreadable":
        if (event.ticket === model.ticket && model.linkBusy === "image") {
          model.linkBusy = "";
          this.showLinkError("That image couldn't be read. Try a PNG or JPEG screenshot.");
        }
        return;
      case "decoded": {
        if (event.ticket !== model.ticket) return;
        // Unrelated QR codes are skipped; decoded URLs are never fetched.
        const result: QrResult = {
          value: event.texts.map(tryParseActivation).find((value) => value !== undefined),
          foundQr: event.texts.length > 0,
        };
        if (model.linkBusy === "image") this.readImage(result);
        else if (model.linkBusy === "scan") this.scanFrame(result);
        return;
      }
      case "scanStarted":
        this.cancel();
        model.linkError = "";
        model.linkBusy = "scan";
        model.scanFrames = 0;
        model.scanNote =
          "Choose the window that shows the Duo QR code. Nothing is recorded or uploaded.";
        return;
      case "scanSharing":
        if (model.linkBusy === "scan") {
          model.scanNote = "Looking for the Duo QR code in the shared window…";
          this.effects.push({ type: "scanFrame", ticket: model.ticket });
        }
        return;
      case "scanEnded":
        if (model.linkBusy === "scan")
          this.endScan(
            event.error === "AbortError"
              ? ""
              : event.error === "NotAllowedError"
                ? "Screen sharing was cancelled. Paste the QR code instead."
                : "Couldn't read the shared screen. Paste the QR code instead.",
          );
        return;
      case "prepared": {
        const preparing = model.preparing;
        if (!preparing || preparing.value !== event.value) return;
        model.preparing = null;
        if (preparing.start) model.linkBusy = "";
        const request = activationRequest(event.value);
        if (!request.ok || !event.ok) return this.showLinkError(prepareFailure);
        model.request = { value: event.value, url: request.value.url };
        if (preparing.start) {
          model.session = { ...noSession(), value: event.value };
          this.setText("");
          this.setStep(ACTIVATE);
        }
        return;
      }
      case "submitted":
        if (model.session.value !== event.value) return;
        if (!model.sent.includes(event.value)) model.sent.push(event.value);
        model.session.submitted = true;
        this.effects.push({ type: "focus", id: "duo-reply", scroll: "duo-reply" });
        return;
      case "retry": {
        model.problem = null;
        const { value } = model.session;
        model.sent = model.sent.filter((sent) => sent !== value);
        model.session.submitted = false;
        return;
      }
      case "reveal":
        model.revealed = !model.revealed;
        return;
      case "copied":
        model.copied = event.kind === "uri" || event.kind === "portal" ? event.kind : "key";
        model.copyError = false;
        model.copyId = (model.copyId + 1) >>> 0;
        this.effects.push({
          type: "later",
          ms: 2500,
          event: { type: "copyDone", id: model.copyId },
        });
        return;
      case "copyFailed":
        model.copyError = true;
        model.revealed = true;
        return;
      case "copyDone":
        if (event.id === model.copyId) model.copied = "";
        return;
    }
  }

  /** Keep the shown step valid and react to step changes, as a page refresh would. */
  normalize() {
    const { model } = this;
    const { value } = model.session;
    if (value !== null) {
      if (model.session.submitted && !model.sent.includes(value)) model.sent.push(value);
      if (model.sent.includes(value)) model.session.submitted = true;
    }
    const current = this.current();
    model.search.step = stepParam(current);
    if (model.previous !== current) {
      model.problem = null;
      if (!this.textSet) this.setText("");
      if (model.linkError === this.linkError) model.linkError = "";
      model.revealed = false;
      model.copied = "";
      model.copyError = false;
      if (model.previous !== null)
        this.effects.push({ type: "focus", id: "step-title", scroll: "setup-progress" });
      model.previous = current;
    }
    if (
      value !== null &&
      current === ACTIVATE &&
      !this.submitted() &&
      model.request?.value !== value &&
      model.preparing?.value !== value
    )
      this.prepare(value, false);
  }

  /** The logic never writes the address, and the page never changes it. */
  finish() {
    this.normalize();
    return { view: view(this.model), effects: this.effects };
  }
}

/** The secret in groups of four. */
const groupSecret = (secret: string) => secret.match(/.{1,4}/g)?.join(" ") ?? "";

/**
 * Display data, in the order `core.rs` declares its fields, which is the
 * order serde writes them in.
 */
function view(model: Model) {
  const current = currentStep(model);
  const { session } = model;
  const furthest = session.account ? ADD : session.value !== null ? ACTIVATE : QR;
  const hasCode = session.value !== null || session.account !== null;
  const finished = [
    current > PORTAL || hasCode,
    hasCode,
    session.account !== null,
    session.account !== null,
  ];
  const { totp } = model.search;
  const account =
    current === ADD && session.account
      ? {
          customer: session.account.customer,
          secret: session.account.secret,
          key: model.revealed ? groupSecret(session.account.secret) : dottedKey,
          revealed: model.revealed,
          uri: otpauthUri(session.account, totp),
          qrAlt: `${totp ? "Time-based" : "Counter-based"} authenticator QR code for ${session.account.customer}`,
        }
      : null;
  const value = current === ACTIVATE ? (session.value ?? "") : "";
  const request =
    model.request && current === ACTIVATE && model.request.value === value
      ? { url: model.request.url }
      : null;
  const count = steps.length;
  return {
    current,
    furthest,
    title: steps[current]![1],
    progress: steps.map(([label], index) => {
      const state = index === current ? "active" : finished[index] ? "complete" : "upcoming";
      const status =
        state === "active" ? "current step" : state === "complete" ? "done" : "not started";
      const number = index + 1;
      return {
        index,
        number,
        label,
        state,
        finished: finished[index],
        reachable: index <= furthest,
        description: `, step ${number} of ${count}, ${status}`,
      };
    }),
    value,
    request,
    submitted: current === ACTIVATE && session.submitted,
    codeType: totp ? "totp" : "hotp",
    account,
    linkError: model.linkError,
    linkBusy: model.linkBusy,
    scanNote: model.scanNote,
    canScan: model.canScan,
    problem: model.problem && {
      message: model.problem.message,
      needsNewCode: model.problem.needsNewCode,
    },
    copied: model.copied,
    copyError: model.copyError,
    shortcut: model.apple ? "⌘" : "Ctrl+",
  };
}

/**
 * The setup logic with a fresh model: each call applies one browser event,
 * given as JSON, and returns `{ view, effects }` as JSON, as the plugin's
 * `update` export does. It throws where the plugin's call fails: on an event
 * serde can't read.
 */
export function createSetupLogic(): (event: string) => string {
  const model = newModel();
  return (json) => {
    const event = readEvent(json);
    const change = new Transition(model);
    change.apply(event);
    return JSON.stringify(change.finish());
  };
}

/**
 * Load the setup logic as readable code in this script, in place of the
 * WebAssembly module: it runs `createSetupLogic()` through the same `guard` as the
 * module, so every output is checked before the page uses it. Calls run on the
 * page's thread like the module's, and `timeoutMs` applies once a call returns;
 * `maxPages` has no memory to cap here, but must still be a positive whole number.
 */
export async function loadJsSetupPlugin({
  maxPages,
  timeoutMs,
}: PluginLimits = defaultPluginLimits): Promise<SetupPlugin> {
  if (![maxPages, timeoutMs].every((limit) => Number.isInteger(limit) && limit > 0))
    throw new RangeError("Each plugin limit must be a positive whole number.");
  const update = createSetupLogic();
  return guard(async (event) => update(event), timeoutMs);
}
