import { afterEach, expect, test, vi } from "vite-plus/test";
import { universities } from "@-/me.unduo.data.universities";
import { getBuildUniversities } from "../build-universities";

afterEach(() => vi.unstubAllEnvs());

test("defaults to the confirmed UofT institution, excluding branches", () => {
  vi.stubEnv("UNDUO_UNIVERSITIES", undefined);
  const selected = getBuildUniversities();
  expect(selected.map(({ id }) => id)).toEqual(["IAU-020599"]);
  expect(selected[0]?.portalUrl).toBe("https://enroll.utormfa.utoronto.ca/");
});

test("the environment flag can restore the full directory", () => {
  vi.stubEnv("UNDUO_UNIVERSITIES", "all");
  expect(getBuildUniversities()).toBe(universities);
  expect(getBuildUniversities("uoft").map(({ id }) => id)).toEqual(["IAU-020599"]);
});

test.each(["", "ALL", "toronto", "uoft,mit"])("rejects an invalid scope: %s", (scope) => {
  expect(() => getBuildUniversities(scope)).toThrow(/UNDUO_UNIVERSITIES.*"uoft" or "all"/);
});
