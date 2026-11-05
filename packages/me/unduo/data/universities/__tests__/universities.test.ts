import { describe, expect, test } from "vite-plus/test";
import { universities } from "@-/me.unduo.data.universities";
import { mfaOverrides } from "#mfa-overrides";
import directory from "#whed-directory" with { type: "json" };
import source from "#whed-source" with { type: "json" };

describe("canonical WHED directory", () => {
  test("every record from the complete catalog has exactly one canonical WHED identity", () => {
    expect(directory.length).toBe(source.records);
    expect(directory.length).toBeGreaterThan(20_000);
    const named = directory.filter(([, name]) => name.trim());
    expect(universities).toHaveLength(named.length);
    const ids = new Set(universities.map((university) => university.id));
    expect(ids.size).toBe(named.length);
    for (const [id] of named) {
      expect(id).toMatch(/^IAU-\d{6}(?:-\d{6})*$/);
      expect(ids.has(id)).toBe(true);
    }
  });

  test("verified enrollment URLs survive the identity migration", () => {
    const oldUrls = new Set(mfaOverrides.map((profile) => profile.portalUrl).filter(Boolean));
    const newUrls = new Set(universities.map((university) => university.portalUrl).filter(Boolean));
    expect(oldUrls.size).toBe(31);
    expect(newUrls).toEqual(oldUrls);
    for (const university of universities.filter((school) => school.portalUrl)) {
      const profile = mfaOverrides.find((school) => school.portalUrl === university.portalUrl)!;
      expect(university.sourceUrl).toBe(profile.sourceUrl);
      expect(university.checkedAt).toBe(profile.checkedAt);
    }
  });

  test("directory inclusion never becomes a guessed portal or Duo confirmation", () => {
    for (const university of universities.filter((entry) => entry.sourceKind === "directory")) {
      expect(university.portalUrl).toBeUndefined();
      expect(university.checkedAt).toBeUndefined();
      expect(university.sourceUrl).toBe(`https://www.whed.net/institutions/${university.id}`);
    }
    const toronto = universities.find((university) => university.id === "IAU-020599")!;
    expect(toronto.portalUrl).toBe("https://enroll.utormfa.utoronto.ca/");
    expect(toronto.aliases).toContain("utoronto");
    expect(toronto.aliases).toContain("toronto.edu");
    expect(toronto.country).toBe("Canada");
    expect(toronto.stateProvince).toBe("Ontario");
  });

  test("branches retain separate WHED IDs and never inherit a parent's portal", () => {
    const branches = universities.filter((university) => university.id.startsWith("IAU-020599-"));
    expect(branches.length).toBeGreaterThan(0);
    for (const branch of branches) expect(branch.portalUrl).toBeUndefined();
  });
});
