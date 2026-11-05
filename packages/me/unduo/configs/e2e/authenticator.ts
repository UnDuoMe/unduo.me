import { createHmac } from "node:crypto";

/** The student's authenticator app: what it does with the link in a scanned QR code. */

const base32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function decodeBase32(text: string) {
  let bits = "";
  for (const letter of text.replace(/=+$/, "")) {
    const value = base32.indexOf(letter);
    if (value < 0) throw new Error(`Not base32: ${letter}`);
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((byte) => parseInt(byte, 2)));
}

/** RFC 4226: a six-digit code from a secret and a counter. */
export function hotp(secret: Uint8Array, counter: number) {
  const moving = Buffer.alloc(8);
  moving.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(moving).digest();
  const offset = digest[digest.length - 1]! & 0xf;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** RFC 6238: HOTP over 30-second windows. */
export function totp(secret: Uint8Array, now = Date.now()) {
  return hotp(secret, Math.floor(now / 30_000));
}

/** What an authenticator reads from an `otpauth://` link. */
export function readOtpauth(uri: string) {
  const url = new URL(uri);
  if (url.protocol !== "otpauth:") throw new Error(`Not an otpauth link: ${uri}`);
  const parameter = (name: string) => url.searchParams.get(name);
  return {
    type: url.hostname,
    label: decodeURIComponent(url.pathname.slice(1)),
    secret: decodeBase32(parameter("secret") ?? ""),
    issuer: parameter("issuer"),
    algorithm: parameter("algorithm"),
    digits: parameter("digits"),
    counter: parameter("counter"),
    period: parameter("period"),
    parameters: [...url.searchParams.keys()].sort(),
  };
}
