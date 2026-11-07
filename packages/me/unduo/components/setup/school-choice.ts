import type { SetupSchool } from "#entities";

/** The choice for a file name that names no institution: no name, portal link or logo. */
export const otherSchool: SetupSchool = { id: "", name: "", sourceUrl: "", screenshots: "generic" };

/** Letters and digits only, lowercased, so spaces, dashes, case and accents don't matter. */
const key = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();

/**
 * The institution that the last part of `path`, the file's name, names: as the
 * home page saves it (`UnDuo - <name>.html`), as earlier pages did
 * (`<name>.html`), or with a browser's mark for another copy, such as ` (1)` or
 * ` 2`. A name that matches none, such as an Android `content://` address that
 * holds only a number, gives `undefined`. The name only picks one of `schools`.
 */
export function schoolFromPath(path: string, schools: readonly SetupSchool[]) {
  let name = path.slice(path.lastIndexOf("/") + 1);
  try {
    name = decodeURIComponent(name);
  } catch {
    return undefined;
  }
  const base = key(name.replace(/\.html?$/i, "").replace(/\s*\(\d+\)$|\s+\d+$/, ""));
  if (!base) return undefined;
  return schools.find(
    (school) =>
      school.name && (key(`UnDuo - ${school.name}`) === base || key(school.name) === base),
  );
}

/** The institutions in the page's `#setup-schools` template, from their data attributes. */
export function readSchools(): SetupSchool[] {
  const template = document.getElementById("setup-schools") as HTMLTemplateElement | null;
  return [...(template?.content.children ?? [])].map((element) => {
    const data = (element as HTMLElement).dataset;
    return {
      id: data.schoolId ?? "",
      name: data.schoolName ?? "",
      portalUrl: data.portalUrl,
      duoPrompt: data.duoPrompt,
      note: data.schoolNote,
      sourceUrl: data.sourceUrl ?? "",
      screenshots: data.screenshots ?? "traditional",
    };
  });
}
