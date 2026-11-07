import { describe, expect, test } from "vite-plus/test";
import { universities } from "@-/me.unduo.data.universities";
import {
  findUniversity,
  otherInstitution,
  searchUniversities,
  universityMatches,
} from "@-/me.unduo.lib.universities";

function matching(query: string) {
  return universities
    .filter((university) => universityMatches(university, query))
    .map((university) => university.id);
}

describe("university selection", () => {
  test("other resolves to the choice that names no institution, and no search returns it", () => {
    expect(findUniversity("other")).toBe(otherInstitution);
    expect(findUniversity(" Other ")).toBe(otherInstitution);
    for (const query of ["", "other", "Other"])
      expect(searchUniversities(query, 100)).not.toContain(otherInstitution);
  });

  test("Toronto deep links resolve by stable ID, name, nickname and domain", () => {
    for (const query of [
      "utoronto",
      "University of Toronto",
      "U of T",
      "UofT",
      "UTORONTO.CA",
      "university-of-toronto",
    ]) {
      expect(findUniversity(query)?.id).toBe("IAU-020599");
      expect(findUniversity(query)?.portalUrl).toBe("https://enroll.utormfa.utoronto.ca/");
    }
  });

  test("ambiguous and partial names never preselect a school", () => {
    for (const query of [
      "UW",
      "university",
      "Toronto",
      "",
      "https://evil.example",
      "a".repeat(161),
    ]) {
      expect(findUniversity(query)).toBeUndefined();
    }
  });

  test("search matches names, acronyms, countries and domains locally", () => {
    expect(matching("U of T")).toEqual(["IAU-020599"]);
    expect(matching("mit.edu")).toContain("IAU-011447");
    expect(matching("toronto canada")).toContain("IAU-020599");
    expect(matching("UCLA")).toContain("IAU-020060");
    expect(searchUniversities("UCLA")[0]?.id).toBe("IAU-020060");
    expect(matching("香港中文大學")).toEqual(["IAU-016414"]);
    expect(matching("zzzz-no-such-school")).toEqual([]);
    expect(matching(" ")).toHaveLength(universities.length);
  });

  test("search ignores accents, capitalization and punctuation", () => {
    expect(matching("UNIVÉRSITY TÓRONTO")).toContain("IAU-020599");
    expect(matching("Stony-Brook")).toContain("IAU-015891");
  });

  test("global directory searches are bounded and rank exact domains first", () => {
    const harvard = findUniversity("harvard.edu");
    expect(harvard?.name).toBe("Harvard University");
    expect(harvard?.sourceKind).toBe("directory");
    expect(searchUniversities("harvard.edu")[0]).toBe(harvard);
    expect(searchUniversities("university")).toHaveLength(50);
    expect(searchUniversities("university", 5)).toHaveLength(5);
    expect(searchUniversities("university", 1000)).toHaveLength(100);
    expect(searchUniversities("", 0)).toEqual([]);
    expect(searchUniversities("a".repeat(161))).toEqual([]);
    expect(searchUniversities("zzzz-no-such-school")).toEqual([]);
    expect(
      searchUniversities("")
        .slice(0, 31)
        .every((university) => university.portalUrl),
    ).toBe(true);
    expect(searchUniversities("mit.edu")[0]?.id).toBe("IAU-011447");
    expect(
      searchUniversities("toronto canada").some((university) => university.id === "IAU-020599"),
    ).toBe(true);
    expect(
      searchUniversities("toronto ontario").some((university) => university.id === "IAU-020599"),
    ).toBe(true);
  });

  test("same-name institutions never silently preselect a country", () => {
    const names = new Map<string, number>();
    for (const university of universities)
      names.set(university.name, (names.get(university.name) ?? 0) + 1);
    const duplicate = [...names].find(([, count]) => count > 1);
    expect(duplicate).toBeDefined();
    expect(findUniversity(duplicate![0])).toBeUndefined();
  });

  test("shared links canonicalize known names and leave unknown IDs unresolved", () => {
    expect(findUniversity(" UofT ")?.id).toBe("IAU-020599");
    expect(findUniversity("new-school-not-yet-listed")).toBeUndefined();
    expect(findUniversity("a".repeat(161))).toBeUndefined();
  });
});

describe("university directory integrity", () => {
  test("all published IDs are stable, unique and resolvable", () => {
    expect(new Set(universities.map((university) => university.id)).size).toBe(universities.length);
    for (const university of universities) {
      expect(university.id).toMatch(/^IAU-\d{6}(?:-\d{6})*$/);
      expect(findUniversity(university.id)).toBe(university);
      if (university.sourceKind !== "directory") {
        expect(university.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      expect(university.name.length).toBeGreaterThan(0);
    }
  });

  test("all sources and optional portals are HTTPS without embedded credentials", () => {
    for (const university of universities) {
      for (const value of [university.sourceUrl, university.portalUrl].filter(
        (url) => url !== undefined,
      )) {
        const url = new URL(value);
        expect(url.protocol).toBe("https:");
        expect(url.username).toBe("");
        expect(url.password).toBe("");
      }
      if (university.portalUrl) expect(university.sourceKind).toBe("university");
    }
  });

  test("unknown enrollment URLs remain absent instead of guessed", () => {
    expect(findUniversity("bay-path")?.portalUrl).toBeUndefined();
    expect(findUniversity("york")?.sourceKind).toBe("university");
  });
});
