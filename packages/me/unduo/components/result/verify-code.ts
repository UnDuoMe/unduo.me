const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Decode the unpadded base32 key from the guarded authenticator account. */
function secretBytes(secret: string) {
  if (!/^[A-Z2-7]+$/.test(secret)) throw new Error("Invalid setup key.");
  const bytes = new Uint8Array(Math.floor((secret.length * 5) / 8));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const letter of secret) {
    buffer = (buffer << 5) | alphabet.indexOf(letter);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (buffer >> bits) & 255;
      buffer &= (1 << bits) - 1;
    }
  }
  return bytes;
}

/**
 * RFC 6238, SHA-1 and six digits: check this and the adjacent 30-second
 * windows. Web Crypto runs locally; neither the key nor the code leaves the tab.
 */
export async function verifyCode(secret: string, code: string, now = Date.now()) {
  if (!/^[0-9]{6}$/.test(code) || !Number.isSafeInteger(now) || now < 0) return false;
  const bytes = secretBytes(secret);
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-1" }, false, [
      "sign",
    ]);
  } finally {
    bytes.fill(0);
  }
  const step = Math.floor(now / 30_000);
  for (const offset of [0, -1, 1]) {
    if (step + offset < 0) continue;
    const moving = new Uint8Array(8);
    new DataView(moving.buffer).setBigUint64(0, BigInt(step + offset));
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, moving));
    const start = digest[digest.length - 1]! & 15;
    const value = new DataView(digest.buffer).getUint32(start) & 0x7fffffff;
    if (String(value % 1_000_000).padStart(6, "0") === code) return true;
  }
  return false;
}
