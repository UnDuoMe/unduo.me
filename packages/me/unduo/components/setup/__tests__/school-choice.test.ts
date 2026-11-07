import { expect, test } from "vite-plus/test";
import type { SetupSchool } from "#entities";
import { otherSchool, schoolFromPath } from "#school-choice";

const school = (id: string, name: string): SetupSchool => ({
  id,
  name,
  sourceUrl: "",
  screenshots: "traditional",
});
const toronto = school("IAU-020599", "University of Toronto");
const waterloo = school("IAU-020623", "University of Waterloo");
const choices = [toronto, waterloo, otherSchool];

test("the file's name, as the home page saves it, picks its institution", () => {
  expect(
    schoolFromPath("/Users/a/Downloads/UnDuo%20-%20University%20of%20Toronto.html", choices),
  ).toBe(toronto);
  expect(schoolFromPath("C:/Users/a/Downloads/UnDuo - University of Waterloo.html", choices)).toBe(
    waterloo,
  );
});

test("a browser's mark for another copy, case, dashes and spacing don't matter", () => {
  for (const name of [
    "UnDuo - University of Toronto (1).html",
    "UnDuo - University of Toronto(2).html",
    "UnDuo - University of Toronto 2.html",
    "unduo_university_of_toronto.HTML",
    "University of Toronto.html",
  ])
    expect(schoolFromPath(`/d/${encodeURIComponent(name)}`, choices), name).toBe(toronto);
});

test("a name that names no institution picks none, so the page shows Other", () => {
  for (const path of [
    "/storage/emulated/0/Download/12345",
    "/d/unduo",
    "/d/UnDuo - Other.html",
    "/d/UnDuo.html",
    "/d/UnDuo - University of Toronto Scarborough.html",
    "/d/%E0%A4%A",
    "/",
  ])
    expect(schoolFromPath(path, choices), path).toBeUndefined();
});
