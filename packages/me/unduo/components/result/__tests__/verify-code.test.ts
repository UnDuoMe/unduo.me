import { expect, test, vi } from "vite-plus/test";
import { verifyCode } from "#verify-code";

// RFC 6238 Appendix B's SHA-1 key and vectors, reduced to six digits.
const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test.each([
  [59, "287082"],
  [1_111_111_109, "081804"],
  [1_111_111_111, "050471"],
  [1_234_567_890, "005924"],
  [2_000_000_000, "279037"],
  [20_000_000_000, "353130"],
])("matches the RFC vector at %i seconds, including leading zeroes", async (seconds, code) => {
  await expect(verifyCode(secret, code, Number(seconds) * 1000)).resolves.toBe(true);
});

test("accepts only the current and adjacent 30-second windows", async () => {
  for (const now of [0, 30_000, 59_999, 60_000, 89_999])
    await expect(verifyCode(secret, "287082", now)).resolves.toBe(true);
  for (const now of [90_000, 120_000])
    await expect(verifyCode(secret, "287082", now)).resolves.toBe(false);
});

test("rejects a code for a different account", async () => {
  await expect(verifyCode("ON2XAZLSONSWG4TFORVWK6I", "287082", 59_000)).resolves.toBe(false);
});

test.each(["", "12345", "1234567", "abcdef", "１２３４５６", " 287082", "287082\n"])(
  "refuses malformed codes: %j",
  async (code) => {
    await expect(verifyCode(secret, code, 59_000)).resolves.toBe(false);
  },
);

test.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
  "refuses an invalid clock: %s",
  async (now) => {
    await expect(verifyCode(secret, "287082", now)).resolves.toBe(false);
  },
);

test("surfaces browser crypto failures so the UI does not claim a mismatch", async () => {
  const sign = vi.spyOn(crypto.subtle, "sign").mockRejectedValueOnce(new Error("Unavailable"));
  try {
    await expect(verifyCode(secret, "287082", 59_000)).rejects.toThrow("Unavailable");
  } finally {
    sign.mockRestore();
  }
});
