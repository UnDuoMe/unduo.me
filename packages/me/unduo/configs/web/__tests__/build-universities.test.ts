import { afterEach, expect, test, vi } from "vite-plus/test";
import { universities } from "@-/me.unduo.data.universities";
import { getBuildUniversities } from "../build-universities";

afterEach(() => vi.unstubAllEnvs());

test("defaults to UofT, Waterloo and Western, excluding branches", () => {
  vi.stubEnv("UNDUO_UNIVERSITIES", undefined);
  const selected = getBuildUniversities();
  expect(selected.map(({ id, portalUrl, duoPrompt }) => [id, portalUrl, duoPrompt])).toEqual([
    ["IAU-020599", "https://enroll.utormfa.utoronto.ca/", undefined],
    ["IAU-020623", "https://uwaterloo.login.duosecurity.com/devices", "universal"],
    ["IAU-020629", "https://identity.uwo.ca/", undefined],
  ]);
});

test("the environment flag can restore the full directory", () => {
  vi.stubEnv("UNDUO_UNIVERSITIES", "all");
  expect(getBuildUniversities()).toBe(universities);
  expect(getBuildUniversities("published").map(({ id }) => id)).toEqual([
    "IAU-020599",
    "IAU-020623",
    "IAU-020629",
  ]);
});

test.each(["", "ALL", "toronto", "uoft", "uoft,mit"])("rejects an invalid scope: %s", (scope) => {
  expect(() => getBuildUniversities(scope)).toThrow(/UNDUO_UNIVERSITIES.*"published" or "all"/);
});
