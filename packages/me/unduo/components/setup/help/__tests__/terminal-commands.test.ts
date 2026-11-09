import { execFile } from "node:child_process";
import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "vite-plus/test";
import { terminalCommands } from "#terminal-commands";

/** The fields the page's guard writes into its Duo form, besides `pubkey`. */
const deviceFields = {
  pkpush: "rsa-sha512",
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
};

interface Received {
  method?: string;
  url?: string;
  type?: string;
  agent?: string;
  body: string;
}

/** Run the three blocks in `sh` against a local server that answers with `reply`. */
async function run(reply: { status: number; body: unknown }) {
  const received: Received = { body: "" };
  const server = createServer((req, res) => {
    Object.assign(received, {
      method: req.method,
      url: req.url,
      type: req.headers["content-type"],
      agent: req.headers["user-agent"],
    });
    req.on("data", (chunk: Buffer) => (received.body += chunk.toString()));
    req.on("end", () => {
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const activate = terminalCommands.activate.replace('"https://$host/', '"http://$host/');
  expect(activate).not.toBe(terminalCommands.activate);
  const script = [
    terminalCommands.values,
    `host=127.0.0.1:${port}`,
    activate,
    terminalCommands.account,
  ].join("\n");
  try {
    const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) =>
      execFile("sh", ["-c", script], (error, stdout, stderr) =>
        resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr }),
      ),
    );
    return { ...result, received };
  } finally {
    server.close();
  }
}

test(
  "posts the page's Duo request and prints the key and otpauth link",
  { timeout: 30_000 },
  async () => {
    const { code, stdout, stderr, received } = await run({
      status: 200,
      body: {
        response: {
          customer_name: "U of T / St. George",
          hotp_secret: "0123456789abcdef0123456789abcdef",
          use_totp: true,
          logo: "x".repeat(100_000),
        },
        stat: "OK",
      },
    });
    expect(stderr).not.toMatch(/Traceback|curl:/);
    expect(code).toBe(0);
    expect(received.method).toBe("POST");
    expect(received.url).toBe("/push/v2/activation/ABCDE12345?customer_protocol=1");
    expect(received.type).toBe("application/x-www-form-urlencoded");
    expect(received.agent).toBe("okhttp/2.7.5");
    const { pubkey, ...fields } = Object.fromEntries(new URLSearchParams(received.body));
    expect(fields).toEqual(deviceFields);
    expect(pubkey).toMatch(
      /^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+\n-----END PUBLIC KEY-----$/,
    );
    expect(createPublicKey(pubkey!).asymmetricKeyDetails?.modulusLength).toBe(2048);
    // base32 of the secret's ASCII bytes, unpadded, as an authenticator expects.
    const key = "GAYTEMZUGU3DOOBZMFRGGZDFMYYDCMRTGQ2TMNZYHFQWEY3EMVTA";
    expect(stdout).toBe(
      `Key: ${key}\notpauth://totp/Duo:U%20of%20T%20%2F%20St.%20George?secret=${key}&issuer=Duo&algorithm=SHA1&digits=6&period=30\n`,
    );
  },
);

test.each([false, undefined, null, "true", 1])(
  "prints no key unless Duo turns on time-based codes, for use_totp=%s",
  { timeout: 30_000 },
  async (setting) => {
    const result = await run({
      status: 200,
      body: {
        stat: "OK",
        response: {
          customer_name: "ACME",
          hotp_secret: "secret",
          use_totp: setting,
        },
      },
    });
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(
      /\nYour organization’s Duo is using an unsupported setting :\(\n$/,
    );
  },
);

test("reports Duo's error and exits non-zero", { timeout: 30_000 }, async () => {
  const { code, stdout, stderr } = await run({
    status: 404,
    body: { code: 40403, message: "Unknown activation code", stat: "FAIL" },
  });
  expect(code).not.toBe(0);
  expect(stdout).toBe("");
  expect(stderr).toMatch(/Duo said: Unknown activation code\n$/);
});

test("has no # lines, which zsh would run as commands", () => {
  for (const commands of Object.values(terminalCommands)) expect(commands).not.toMatch(/^\s*#/m);
});

test("the README shows the same commands", () => {
  const readme = readFileSync(new URL("../../../../../../../README.md", import.meta.url), "utf8");
  for (const commands of Object.values(terminalCommands)) {
    expect(readme).toContain("```sh\n" + commands + "\n```");
  }
});
