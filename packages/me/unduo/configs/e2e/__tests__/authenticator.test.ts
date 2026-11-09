import { describe, expect, test } from "vite-plus/test";
import { decodeBase32, hotp, readOtpauth, totp } from "#authenticator";

describe("the end-to-end test's authenticator", () => {
  const secret = Buffer.from("12345678901234567890");

  test("HOTP matches RFC 4226's test values", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314"];
    expect(expected.map((_, counter) => hotp(secret, counter))).toEqual(expected);
  });

  test("TOTP matches RFC 6238's SHA-1 values, cut to six digits", () => {
    expect(totp(secret, 59_000)).toBe("287082");
    expect(totp(secret, 1_111_111_109_000)).toBe("081804");
  });

  test("base32 decodes RFC 4648's values", () => {
    expect(decodeBase32("MZXW6YTB").toString()).toBe("fooba");
    expect(decodeBase32("MZXW6YTBOI======").toString()).toBe("foobar");
    expect(() => decodeBase32("not base32")).toThrow();
  });

  test("reads a Duo link", () => {
    const link = readOtpauth(
      "otpauth://totp/Duo:A%20School?secret=MZXW6YTB&issuer=Duo&algorithm=SHA1&digits=6&period=30",
    );
    expect(link).toMatchObject({
      type: "totp",
      label: "Duo:A School",
      period: "30",
      counter: null,
    });
    expect(link.secret.toString()).toBe("fooba");
    expect(() => readOtpauth("https://example.com/")).toThrow();
  });
});
