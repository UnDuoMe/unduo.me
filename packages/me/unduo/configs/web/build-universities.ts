import { universities } from "@-/me.unduo.data.universities";

/**
 * The institutions the site publishes files for: the main records of the
 * University of Toronto, the University of Waterloo and Western University
 * (the University of Western Ontario). Their branches and affiliated colleges
 * stay out.
 */
const published = ["IAU-020599", "IAU-020623", "IAU-020629"];

/** Keep generated routes and the browser picker on the same publication scope. */
export function getBuildUniversities(scope = process.env.UNDUO_UNIVERSITIES ?? "published") {
  if (scope === "all") return universities;
  if (scope !== "published") {
    throw new Error(
      `Invalid UNDUO_UNIVERSITIES=${JSON.stringify(scope)}. Use "published" or "all".`,
    );
  }
  const selected = universities.filter((university) => published.includes(university.id));
  if (selected.length !== published.length)
    throw new Error("A published institution is missing from the university directory.");
  return selected;
}
