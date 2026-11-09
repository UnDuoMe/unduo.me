import { expect, test, vi } from "vite-plus/test";
import { createHash } from "node:crypto";
import {
  defaultPluginLimits,
  guard,
  loadSetupPlugin,
  newPublicKey,
} from "@-/me.unduo.components.setup.plugin";
import type { SetupEvent } from "@-/me.unduo.components.setup.plugin";
import { readSetupPlugin } from "@-/me.unduo.components.setup.plugin/server";
import { readFileSync, readdirSync } from "node:fs";
import { pageTexts } from "#setup-plugin";

// These drive the guard with crafted output from a fake plugin,
// and with the real plugin's output. The headless browser check runs the real
// plugin through the page.

const url =
  "https://api-12345678.duosecurity.com/push/v2/activation/TESTCODE123?customer_protocol=1";
/** The activation link a user pastes for `url`. */
const link = "https://m-12345678.duosecurity.com/activate/TESTCODE123";
const pastedLink: SetupEvent = { type: "input", text: link };
const secret = "ON2XAZLSONSWG4TFORVWK6I";
const uri = `otpauth://totp/Duo:ACME%20University?secret=${secret}&issuer=Duo&algorithm=SHA1&digits=6&period=30`;

// Duo Mobile's activation form, as the guard builds it around this page's key.
const fields = (pubkey: string) => [
  { name: "pkpush", value: "rsa-sha512" },
  { name: "pubkey", value: pubkey },
  ...Object.entries({
    jailbroken: "false",
    architecture: "arm64",
    region: "US",
    app_id: "com.duosecurity.duomobile",
    full_disk_encryption: "true",
    passcode_status: "true",
    platform: "Android",
    app_version: "4.124.0",
    app_build_number: "4124000",
    version: "13",
    manufacturer: "Google",
    language: "en",
    model: "Cheetah",
    security_patch_level: "2024-01-01",
  }).map(([name, value]) => ({ name, value })),
];
const progress = () =>
  [
    "Open portal",
    "Authenticate with Duo",
    "Copy QR code",
    "Activate with Duo",
    "Add to authenticator",
  ].map((label, index) => ({
    index,
    number: index + 1,
    label,
    state: index ? "upcoming" : "active",
    finished: false,
    reachable: !index,
    description: `, step ${index + 1} of 5, ${index ? "not started" : "current step"}`,
  }));
/** An honest view of the first step, with `extra` fields replaced. */
const view = (extra = {}) => ({
  current: 0,
  furthest: 1,
  title: "Open your Duo device portal",
  progress: progress(),
  value: "",
  request: null,
  submitted: false,
  account: null,
  linkError: "",
  linkBusy: "",
  scanNote: "",
  scanFound: false,
  canScan: true,
  problem: null,
  copied: "",
  copyError: false,
  shortcut: "⌘",
  ...extra,
});
/** An honest account for `link`: its name, QR code description and hidden key. */
function account(link: string, key = secret) {
  let name = "Duo";
  try {
    name = decodeURIComponent(/\/Duo:([^?]*)\?/.exec(link)?.[1] ?? "") || "Duo";
  } catch {}
  return {
    customer: name,
    secret: key,
    key: pageTexts.hiddenKey,
    revealed: false,
    uri: link,
    qrAlt: `Time-based authenticator QR code for ${name}`,
  };
}
/** A fake plugin call that returns `output` as JSON. */
const returns = (output: unknown) => async () => JSON.stringify(output);
/** The guard's verdict on one output from a fake plugin, answering `event`. */
const run = (output: unknown, event = pastedLink) => guard(returns(output))(event);
const unsafe = async (output: unknown) => {
  await expect(run(output)).rejects.toThrow("unsafe output");
};
const output = (extra = {}, effects: unknown[] = []) => ({ view: view(extra), effects });
const form = (url: string) => output({ request: { url } });
/** The key the guard wrote into an honest form. */
const formKey = async () =>
  (await run(form(url))).view.request!.fields.find((field) => field.name === "pubkey")!.value;
/** A fresh copy of the guard module, as a newly loaded page has it: no key and no Duo host yet. */
async function freshModule() {
  vi.resetModules();
  return import("@-/me.unduo.components.setup.plugin");
}
/**
 * The guard's verdict in a newly loaded page that, unless `key` is false, has
 * made its key. `event` is the browser event the plugin answers.
 */
async function freshPage({ key = true } = {}) {
  const page = await freshModule();
  if (key) await page.newPublicKey();
  return (output: unknown, event: SetupEvent = pastedLink) => page.guard(returns(output))(event);
}

await newPublicKey();

/** Duo's reply for `uri`, as the user pastes it. */
const reply = JSON.stringify({
  stat: "OK",
  response: { customer_name: "ACME University", hotp_secret: "supersecretkey", use_totp: true },
});
const pastedReply: SetupEvent = { type: "input", text: reply };

test("passes honest updates", async () => {
  for (const current of [0, 1, 2, 3]) {
    const honest = output({ current }, [{ type: "setText", text: "" }]);
    await expect(run(honest)).resolves.toEqual(honest);
  }
  for (const link of [uri, uri.replace("ACME%20University", "")])
    await expect(run(output({ account: account(link) }), pastedReply)).resolves.toBeTruthy();
  const effects = [
    { type: "prepare", value: "TESTCODE123-YXBp" },
    { type: "readImage", ticket: 1 },
    { type: "scanFrame", ticket: 2 },
    { type: "stopScan" },
    { type: "focus", id: "step-title", scroll: "setup-progress" },
    { type: "focus", id: "activation-input", scroll: "scan-found" },
    { type: "later", ms: 2500, event: { type: "copyDone", id: 3 } },
  ];
  await expect(run(output({}, effects))).resolves.toEqual(output({}, effects));
});

test("builds the Duo form here, taking only the URL from the plugin", async () => {
  const key = await formKey();
  // An RSA-2048 SubjectPublicKeyInfo is 294 bytes of DER.
  const body = key.match(
    /^-----BEGIN PUBLIC KEY-----\n([A-Za-z0-9+/=\n]+)\n-----END PUBLIC KEY-----\n$/,
  );
  expect(atob(body![1]!.replaceAll("\n", ""))).toHaveLength(294);
  const { view: checked } = await run(form(url));
  expect(checked.request).toEqual({
    url,
    host: "api-12345678.duosecurity.com",
    fields: fields(key),
  });
  // A plugin could otherwise hide the activation code or the secret in a
  // device field, and an attacker's own Duo account would display it.
  for (const extra of [
    { fields: fields("x").map((f) => (f.name === "model" ? { ...f, value: "TESTCODE123" } : f)) },
    { fields: [] },
    { host: "evil.example" },
    { action: "https://evil.example/" },
  ])
    await unsafe(output({ request: { url, ...extra } }));
});

test("writes each new key into the form", async () => {
  const before = await formKey();
  await newPublicKey();
  const after = await formKey();
  expect(after).not.toBe(before);
  expect((await run(form(url))).view.request!.fields).toEqual(fields(after));
});

test.each([
  "https://evil.example/push/v2/activation/TESTCODE123?customer_protocol=1",
  "https://api-1.duosecurity.com.evil.example/push/v2/activation/TESTCODE123?customer_protocol=1",
  url.replace("https:", "http:"),
  `${url}&next=https://evil.example/`,
  `${url}#fragment`,
  url.replace("https://", "https://user@"),
  url.replace(".com/", ".com:8443/"),
  url.replace("/push/v2/activation/", "/push/v2/other/"),
  url.replace("TESTCODE123", "../../frame"),
  // The host name goes out unencrypted, so it must be Duo's eight characters.
  url.replace("api-12345678", "api-1234567"),
  url.replace("api-12345678", "api-123456789"),
  url.replace("api-12345678", `api-${"on2xazlsonswg4tforvwk6i".repeat(2)}`),
  url.replace("api-12345678", "API-12345678"),
  url.replace("api-12345678", "api-1234567-"),
])("rejects the form URL %s", async (bad) => {
  // In a new page, so the host lock can't be what rejects it.
  await expect((await freshPage())(form(bad))).rejects.toThrow("unsafe output at view.request.url");
});

test("allows one Duo host per page load", async () => {
  const run = await freshPage();
  const other = url.replace("api-12345678", "api-abcdefgh");
  const otherLink: SetupEvent = { type: "input", text: link.replace("12345678", "abcdefgh") };
  await expect(run(form(other), otherLink)).resolves.toBeTruthy();
  await expect(run(form(other), otherLink)).resolves.toBeTruthy();
  // Pasted too, but the page already sent its activation to another host.
  await expect(run(form(url), pastedLink)).rejects.toThrow("unsafe output");
});

test("refuses a form before this page has made a key", async () => {
  const run = await freshPage({ key: false });
  await expect(run(form(url))).rejects.toThrow("unsafe output");
});

// What a user can paste for the activation in `url`. The base64 host is
// "api-12345678.duosecurity.com".
const host64 = "YXBpLTEyMzQ1Njc4LmR1b3NlY3VyaXR5LmNvbQ";
const pasted = {
  link: { text: link },
  email: { text: "Activate here: https://m-12345678.duosecurity.com/android/TESTCODE123/." },
  address: {
    text: `https://api-12345678.duosecurity.com/frame/qr?value=duo%3A%2F%2FTESTCODE123-${host64}`,
  },
  nested: {
    text: `https://api-12345678.duosecurity.com/frame/qr?value=duo%253A%252F%252FTESTCODE123-${host64}`,
  },
  value: { text: `TESTCODE123-${host64}==` },
  urlSafe: { text: `duo://TESTCODE123-${host64.replaceAll("+", "-").replaceAll("/", "_")}` },
  html: {
    html: `<img src="https://api-12345678.duosecurity.com/frame/qr?value=duo%3A%2F%2FTESTCODE123-${host64}">`,
  },
};

test.each(Object.entries(pasted))("accepts the form for a pasted %s", async (_, input) => {
  const run = await freshPage();
  await expect(run(form(url), { type: "input", ...input })).resolves.toBeTruthy();
});

test("accepts the form for a QR code the page read", async () => {
  for (const texts of [[link], ["https://example.com/other", `duo://TESTCODE123-${host64}`]]) {
    const run = await freshPage();
    await expect(run(output(), { type: "input", image: true })).resolves.toBeTruthy();
    await expect(run(form(url), { type: "decoded", ticket: 1, texts })).resolves.toBeTruthy();
  }
});

test.each([
  // Another code, or the authenticator secret, in place of the pasted one.
  url.replace("TESTCODE123", "OTHERCODE99"),
  url.replace("TESTCODE123", secret),
  // Part of the pasted code, or a longer one.
  url.replace("TESTCODE123", "TESTCODE12"),
  url.replace("TESTCODE123", "TESTCODE1234"),
  // Another Duo host, which DNS and TLS would show.
  url.replace("api-12345678", "api-abcdefgh"),
  // Another word from the same text, whose length the size of the POST would show.
  url.replace("TESTCODE123", "frame"),
  url.replace("TESTCODE123", "value"),
  url.replace("TESTCODE123", "12345678"),
  url.replace("TESTCODE123", "duosecurity"),
  url.replace("TESTCODE123", "activate"),
  // The pasted code in another case.
  url.replace("TESTCODE123", "testcode123"),
])("rejects a form URL that the page didn't read: %s", async (bad) => {
  const events: SetupEvent[] = [
    ...Object.values(pasted).map((input) => ({ type: "input" as const, ...input })),
    { type: "decoded", ticket: 1, texts: [link] },
  ];
  for (const event of events) {
    const run = await freshPage();
    await expect(run(form(bad), event)).rejects.toThrow("unsafe output at view.request.url");
  }
});

test("checks each new form URL against what the page read since it loaded or started over", async () => {
  const run = await freshPage();
  const other = url.replace("TESTCODE123", "OTHERCODE99");
  // Before any input, and after an image the page found no QR code in.
  await expect(run(form(url), { type: "reveal" })).rejects.toThrow("view.request.url");
  for (const event of [
    { type: "input", image: true },
    { type: "decoded", ticket: 1, texts: [] },
    { type: "scanStarted" },
  ] as SetupEvent[]) {
    const run = await freshPage();
    await expect(run(form(url), event)).rejects.toThrow("view.request.url");
  }
  await expect(run(output(), pastedLink)).resolves.toBeTruthy();
  // The page makes a key and reports it; the form follows.
  await expect(run(form(url), { type: "prepared", value: "x", ok: true })).resolves.toBeTruthy();
  // Duo's reply, pasted while the same form is still shown.
  await expect(run(form(url), { type: "input", text: '{"stat":"OK"}' })).resolves.toBeTruthy();
  await expect(run(form(other), { type: "reveal" })).rejects.toThrow("view.request.url");
  const restarted = await freshPage();
  await expect(restarted(output(), pastedLink)).resolves.toBeTruthy();
  await expect(restarted(form(url), { type: "startOver", step: 0 })).rejects.toThrow(
    "view.request.url",
  );
});

test("caps strings, effects and the output's size", async () => {
  const long = "x".repeat(65_536);
  // A pasted text at the cap, echoed into the text field.
  await expect(
    run(output({}, [{ type: "setText", text: long }]), { type: "input", text: long }),
  ).resolves.toBeTruthy();
  for (const bad of [
    output({ title: `${long}x` }),
    output({ problem: { message: `${long}x`, needsNewCode: false } }),
    output({}, [{ type: "setText", text: `${long}x` }]),
    output({}, Array(17).fill({ type: "stopScan" })),
    // Each field within its cap, 1 MiB in all.
    output({}, Array(16).fill({ type: "setText", text: long })),
  ])
    await expect(run(bad)).rejects.toThrow("unsafe output");
  await expect(guard(async () => undefined)(pastedLink)).rejects.toThrow("unsafe output");
});

test.each([
  account(uri.replace("totp", "hotp")),
  account(uri.replace("period=30", "counter=0")),
  account(uri.replace("totp", "hotp").replace("period=30", "counter=0")),
  account("javascript:alert(1)"),
  account(`https://evil.example/?secret=${secret}`),
  account(`${uri}&image=https://evil.example/?s=${secret}`),
  account(uri, "GEZDGNBVGY3TQOJQ"),
  account(uri.replace("ACME%20University", "ACME University")),
  account(`${uri} `),
  account(uri.replace(secret, ""), ""),
  account(uri.replace("issuer=Duo", "issuer=Other")),
  { ...account(uri), uri: [uri] },
  { ...account(uri), image: "https://evil.example/" },
])("rejects the authenticator link %j", (bad) => unsafe(output({ account: bad })));

test("accepts nothing outside the schema", async () => {
  const cases = [
    null,
    {},
    { view: view() },
    { view: null, effects: [] },
    { view: [], effects: [] },
    { ...output(), extra: 1 },
    output({ html: "<img src=x onerror=alert(1)>" }),
    output({ title: 1 }),
    output({ current: 5 }),
    output({ current: 1.5 }),
    output({ furthest: -1 }),
    output({ linkBusy: "evil" }),
    output({ codeType: "steam" }),
    output({ shortcut: "Cmd" }),
    output({ progress: progress().slice(1) }),
    output({ progress: [...progress(), ...progress().slice(0, 2)] }),
    output({ progress: progress().map((step) => ({ ...step, number: 0 })) }),
    output({ copied: "secret" }),
    output({ progress: progress().map((step) => ({ ...step, state: "evil" })) }),
    output({ progress: progress().map((step) => ({ ...step, href: "https://evil.example/" })) }),
    output({ problem: { message: "x", needsNewCode: false, html: "<b>" } }),
    output({ submitted: "yes" }),
    // JSON.parse makes `__proto__` an own key, which the schema doesn't know.
    { ...output(), ...JSON.parse('{"__proto__": {"polluted": true}}') },
  ];
  for (const bad of cases) await expect(run(bad)).rejects.toThrow("unsafe output");
  for (const effect of [
    null,
    { type: "evil" },
    { type: "stopScan", extra: 1 },
    // The plugin can't change the address.
    { type: "writeHash", hash: "step=qr", push: true },
    { type: "readImage", ticket: -1 },
    { type: "focus", id: "duo-portal", scroll: "duo-reply" },
    { type: "later", ms: 2500, event: { type: "input", text: "x" } },
    { type: "later", ms: 1e9, event: { type: "copyDone", id: 1 } },
  ])
    await expect(run(output({}, [effect]))).rejects.toThrow("unsafe output at effects.0");
});

/** The committed plugin as a `data:` URL, with its SRI hash. */
const { bytes } = readSetupPlugin();
const pluginUrl = `data:application/wasm;base64,${bytes.toString("base64")}`;
const pluginIntegrity = `sha256-${createHash("sha256").update(bytes).digest("base64")}`;

test("passes every output of the real plugin through a whole setup", async () => {
  const page = await freshModule();
  const send = await page.loadSetupPlugin(pluginUrl, pluginIntegrity);
  const decoded = (ticket: number, texts: string[] = []) =>
    send({ type: "decoded", ticket, texts });
  const ticketOf = (effects: { type: string; ticket?: number }[], type: string) =>
    effects.find((effect) => effect.type === type)!.ticket!;

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
  await decoded(ticketOf(image.effects, "readImage"), ["https://example.com/"]);
  await send({ type: "scanStarted" });
  const sharing = await send({ type: "scanSharing" });
  await decoded(ticketOf(sharing.effects, "scanFrame"));
  await send({ type: "scanEnded", error: "AbortError" });
  // The activation link as an image: the page reads it and sends its text.
  const pasted = await send({ type: "input", image: true });
  const found = await decoded(ticketOf(pasted.effects, "readImage"), [link]);
  const { value } = found.effects.find((effect) => effect.type === "prepare") as {
    value: string;
  };
  await page.newPublicKey();
  const prepared = await send({ type: "prepared", value, ok: true });
  expect(prepared.view.request?.url).toBe(url);
  expect(prepared.view.request?.fields).toHaveLength(16);
  await send({ type: "submitted", value });
  const reply = JSON.stringify({
    stat: "OK",
    response: { customer_name: "ACME University", hotp_secret: "supersecretkey", use_totp: true },
  });
  const added = await send({ type: "input", text: reply });
  expect(added.view.account?.uri).toMatch(/^otpauth:\/\/totp\//);
  await send({ type: "reveal" });
  const copied = await send({ type: "copied", kind: "uri" });
  const later = copied.effects.find((effect) => effect.type === "later")!;
  await send((later as { event: SetupEvent }).event);
  await send({ type: "navigate", hash: "#step=qr" });
  await send({ type: "startOver", step: 0 });
});

test.each([true, false, undefined])(
  "the real plugin makes only time-based accounts, for use_totp=%s",
  async (flag) => {
    const module = await freshModule();
    const plugin = readSetupPlugin();
    const send = await module.loadSetupPlugin(
      `data:application/wasm;base64,${plugin.bytes.toString("base64")}`,
      `sha256-${createHash("sha256").update(plugin.bytes).digest("base64")}`,
    );
    await send({
      type: "load",
      hash: "#step=qr&type=totp",
      legacy: "",
      platform: "MacIntel",
      scan: false,
    });
    const output = await send({
      type: "input",
      text: JSON.stringify({
        stat: "OK",
        response: {
          customer_name: "ACME",
          hotp_secret: "secret",
          use_totp: flag,
        },
      }),
    });
    if (flag) {
      expect(output.view.current).toBe(4);
      expect(output.view.problem).toBeNull();
      const uri = output.view.account!.uri;
      expect(uri.startsWith("otpauth://totp/")).toBe(true);
      expect(uri.endsWith("&period=30")).toBe(true);
    } else {
      expect(output.view.current).not.toBe(4);
      expect(output.view.account).toBeNull();
      expect(output.view.linkError).toBe(
        "Your organization's Duo is using an unsupported setting :(",
      );
    }
  },
);

test("accepts an account only from Duo's pasted reply", async () => {
  const run = await freshPage();
  // Not pasted yet, or only as the text of a QR code.
  await expect(run(output({ account: account(uri) }))).rejects.toThrow("at view.account");
  const fromQr = await freshPage();
  await expect(
    fromQr(output({ account: account(uri) }), { type: "decoded", ticket: 0, texts: [reply] }),
  ).rejects.toThrow("at view.account");
  // Pasted as JSON, as Firefox's viewer copies it, or as HTML.
  for (const event of [
    pastedReply,
    {
      type: "input",
      text: "customer_name: ACME University\nhotp_secret: supersecretkey\nuse_totp: true\nstat: OK",
    },
    { type: "input", html: `<pre>${reply}</pre>` },
  ] as SetupEvent[]) {
    const page = await freshPage();
    await expect(page(output({ account: account(uri) }), event)).resolves.toBeTruthy();
  }
  // A JSON-escaped name.
  const quoted = await freshPage();
  const escaped = JSON.stringify({
    stat: "OK",
    response: { customer_name: 'ACME "U"', hotp_secret: "supersecretkey", use_totp: true },
  });
  const link = uri.replace("ACME%20University", encodeURIComponent('ACME "U"'));
  await expect(
    quoted(output({ account: account(link) }), { type: "input", text: escaped }),
  ).resolves.toBeTruthy();
});

test.each([
  ["another secret", uri.replaceAll(secret, "MZXW6YTBOI"), "MZXW6YTBOI"],
  ["another name", uri.replace("ACME%20University", "Evil%20Corp"), secret],
  ["a malformed name", uri.replace("ACME%20University", "%E0%A4"), secret],
  ["a secret that isn't UTF-8", uri.replaceAll(secret, "7777"), "7777"],
])("refuses an account with %s than the reply", async (_, link, key) => {
  const run = await freshPage();
  await expect(
    run(output({ account: { ...account(link), secret: key } }), pastedReply),
  ).rejects.toThrow("at view.account");
});

test("shows only the page's own texts and what you pasted", async () => {
  for (const extra of [
    { title: "Paste your key at evil.example" },
    { linkError: "Paste your key at evil.example" },
    { scanNote: "Paste your key at evil.example" },
    { progress: progress().map((step) => ({ ...step, label: "Go to evil.example" })) },
    { progress: progress().map((step) => ({ ...step, description: ", visit evil.example" })) },
    { problem: { message: "Paste your key at evil.example", needsNewCode: false } },
  ])
    await expect(run(output(extra))).rejects.toThrow("unsafe output at view.");
  for (const message of pageTexts.messages) {
    await expect(run(output({ linkError: message }))).resolves.toBeTruthy();
    await expect(run(output({ problem: { message, needsNewCode: false } }))).resolves.toBeTruthy();
  }
  const page = await freshPage();
  const honest = account(uri);
  await expect(page(output({ account: honest }), pastedReply)).resolves.toBeTruthy();
  const revealed = { ...honest, revealed: true, key: "ON2X AZLS ONSW G4TF ORVW K6I" };
  await expect(page(output({ account: revealed }))).resolves.toBeTruthy();
  for (const [field, value] of [
    ["customer", "Evil Corp"],
    ["qrAlt", "Scan this at evil.example"],
    ["key", "Paste this at evil.example"],
  ])
    await expect(page(output({ account: { ...honest, [field]: value } }))).rejects.toThrow(
      `at view.account.${field}`,
    );
});

test("shows Duo's refusal only with a reason and code from the pasted reply", async () => {
  const refusal = (detail: string) =>
    `Duo didn't activate the device${detail}. Your organization may not allow adding devices this way.`;
  const failed = JSON.stringify({ stat: "FAIL", code: 40002, message: "Device  limit reached" });
  for (const [detail, ok] of [
    ["", true],
    [": “Device limit reached” (error 40002)", true],
    [" (error 40002)", true],
    [": “Visit evil.example” (error 40002)", false],
    [": “Device limit reached” (error 99999)", false],
  ] as const) {
    const page = await freshPage();
    const result = page(output({ problem: { message: refusal(detail), needsNewCode: false } }), {
      type: "input",
      text: failed,
    });
    if (ok) await expect(result).resolves.toBeTruthy();
    else await expect(result).rejects.toThrow("at view.problem.message");
  }
});

test("doesn't quote text from anything but a reply that failed as Duo's refusal", async () => {
  const refusal = (detail: string) =>
    `Duo didn't activate the device: “${detail}”. Your organization may not allow adding devices this way.`;
  const quoted = (detail: string, text: string) =>
    freshPage().then((page) =>
      page(output({ problem: { message: refusal(detail), needsNewCode: false } }), {
        type: "input",
        text,
      }),
    );
  // A reply that succeeded holds the key, and a link holds the activation code.
  await expect(quoted("supersecretkey", reply)).rejects.toThrow("at view.problem.message");
  await expect(quoted("TESTCODE123", link)).rejects.toThrow("at view.problem.message");
  // A reply with both can't be Duo's, so it can't supply the words either.
  const both = JSON.stringify({
    stat: "FAIL",
    message: "x",
    hotp_secret: "supersecretkey",
    use_totp: true,
  });
  await expect(quoted("supersecretkey", both)).rejects.toThrow("at view.problem.message");
  // Firefox's viewer shows a reply as lines of text.
  await expect(quoted("Device limit", "message: Device limit\nstat: FAIL")).resolves.toBeTruthy();
});

test("fills the text field only with text you pasted or a QR code the page read", async () => {
  const page = await freshPage();
  await expect(page(output({}, [{ type: "setText", text: link }]))).resolves.toBeTruthy();
  await expect(page(output({}, [{ type: "setText", text: "" }]))).resolves.toBeTruthy();
  await expect(
    page(output({}, [{ type: "setText", text: "Paste your key at evil.example" }])),
  ).rejects.toThrow("at effects.0.text");
  const scanned = `duo://TESTCODE123-${btoa("api-87654321.duosecurity.com")}`;
  const frame: SetupEvent = { type: "decoded", ticket: 1, texts: [` ${scanned}\n`] };
  const scan = await freshPage();
  await expect(
    scan(output({}, [{ type: "setText", text: scanned }]), { type: "scanSharing" }),
  ).rejects.toThrow("at effects.0.text");
  await expect(
    scan(output({ scanFound: true }, [{ type: "setText", text: scanned }]), frame),
  ).resolves.toBeTruthy();
});

test("lists exactly the texts crates/setup writes", () => {
  const sources = new URL("../../../../../../../crates/setup/src/", import.meta.url);
  const written = new Set<string>();
  for (const name of readdirSync(sources).filter((file) => file.endsWith(".rs"))) {
    const code = readFileSync(new URL(name, sources), "utf8")
      .split("#[cfg(test)]")[0]!
      .replace(/r#".*?"#/gs, "");
    for (const [, literal] of code.matchAll(/"((?:[^"\\]|\\.)*)"/g))
      if (/^[A-Z•]/.test(literal!) && literal!.includes(" ") && !literal!.includes("{"))
        written.add(literal!);
  }
  const listed = [
    ...pageTexts.titles,
    ...pageTexts.labels,
    ...pageTexts.messages,
    pageTexts.hiddenKey,
  ];
  expect([...new Set(listed)].sort()).toEqual([...written].sort());
});

test("fails every later call after unsafe output", async () => {
  const outputs: unknown[] = [null, output()];
  const call = guard(async () => returns(outputs.shift())());
  await expect(call(pastedLink)).rejects.toThrow();
  await expect(call(pastedLink)).rejects.toThrow();
});

test("fails a call that runs past the time limit, and every later call", async () => {
  const honest = output();
  const slow = async () => {
    const end = performance.now() + 30;
    while (performance.now() < end);
    return returns(honest)();
  };
  const call = guard(slow, 10);
  await expect(call(pastedLink)).rejects.toThrow("timed out");
  await expect(guard(returns(honest), 10)(pastedLink)).resolves.toEqual(honest);
  await expect(call(pastedLink)).rejects.toThrow();
});

test.each([
  { ...defaultPluginLimits, maxPages: 0 },
  { ...defaultPluginLimits, maxPages: -1 },
  { ...defaultPluginLimits, timeoutMs: 1.5 },
  { ...defaultPluginLimits, timeoutMs: Number.NaN },
  { ...defaultPluginLimits, maxPages: "1024" as unknown as number },
])("refuses the plugin limits %j", async (limits) => {
  await expect(loadSetupPlugin(pluginUrl, pluginIntegrity, limits)).rejects.toThrow(RangeError);
});

test.each(["", "0", pluginIntegrity.replace("sha256-", "sha384-"), `${pluginIntegrity} `])(
  "refuses to load the plugin without one SHA-256: %j",
  async (integrity) => {
    await expect(loadSetupPlugin(pluginUrl, integrity)).rejects.toThrow("needs its SHA-256");
  },
);

test.each([
  // Imports evil.fetch, a function with no parameters or results.
  [
    0x01,
    0x04,
    0x01,
    0x60,
    0x00,
    0x00,
    0x02,
    0x0e,
    0x01,
    0x04,
    ...Buffer.from("evil"),
    0x05,
    ...Buffer.from("fetch"),
    0x00,
    0x00,
  ],
  // Imports and exports nothing.
  [],
])("refuses a module with other imports or exports: %j", async (...sections) => {
  const bytes = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, ...sections.flat()]);
  const integrity = `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
  await expect(
    loadSetupPlugin(`data:application/wasm;base64,${bytes.toString("base64")}`, integrity),
  ).rejects.toThrow("imports or exports something else");
});

test("refuses plugin bytes that don't match the SHA-256", async () => {
  const other = `sha256-${createHash("sha256").update("other").digest("base64")}`;
  await expect(loadSetupPlugin(pluginUrl, other)).rejects.toThrow();
});

const load: SetupEvent = {
  type: "load",
  hash: "",
  legacy: "",
  platform: "",
  scan: false,
};

test("fails a call whose input or memory goes over maxPages", async () => {
  // The module's own memory starts above two pages.
  const small = await loadSetupPlugin(pluginUrl, pluginIntegrity, {
    ...defaultPluginLimits,
    maxPages: 2,
  });
  await expect(small(load)).rejects.toThrow("memory limit");
  const plugin = await loadSetupPlugin(pluginUrl, pluginIntegrity, {
    ...defaultPluginLimits,
    maxPages: 64,
  });
  await expect(plugin(load)).resolves.toBeTruthy();
  // An input bigger than the kernel's 4 MiB fails the call.
  await expect(plugin({ type: "input", text: "x".repeat(5_000_000) })).rejects.toThrow();
  await expect(plugin(load)).rejects.toThrow();
});
