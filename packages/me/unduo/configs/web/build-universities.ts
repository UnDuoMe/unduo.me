import { universities } from "@-/me.unduo.data.universities";

/** Keep generated routes and the browser picker on the same publication scope. */
export function getBuildUniversities(scope = process.env.UNDUO_UNIVERSITIES ?? "uoft") {
  if (scope === "all") return universities;
  if (scope !== "uoft") {
    throw new Error(`Invalid UNDUO_UNIVERSITIES=${JSON.stringify(scope)}. Use "uoft" or "all".`);
  }
  // Only the main UofT record has been confirmed supported; branches stay out.
  const selected = universities.filter((university) => university.id === "IAU-020599");
  if (selected.length !== 1) throw new Error("UofT is missing from the university directory.");
  return selected;
}
