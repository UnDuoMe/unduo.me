import { universities } from "@-/me.unduo.data.universities";
import type { University } from "@-/me.unduo.data.universities.entities";

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.]+/gu, " ")
    .trim();
}

function searchable(university: University) {
  const name = normalize(university.name);
  const aliases = [name, ...university.aliases.map(normalize)];
  const text = normalize(
    [
      university.id,
      university.name,
      university.country,
      university.stateProvince ?? "",
      ...university.aliases,
    ].join(" "),
  );
  return { university, name, aliases, text, words: new Set(text.split(/\s+/)) };
}
const entries = universities.map(searchable);
const byUniversity = new Map(entries.map((entry) => [entry.university, entry]));
const byId = new Map(entries.map((entry) => [normalize(entry.university.id), entry.university]));
const byAlias = new Map<string, University | undefined>();
for (const entry of entries) {
  for (const alias of new Set(entry.aliases)) {
    byAlias.set(alias, byAlias.has(alias) ? undefined : entry.university);
  }
}
function matches(entry: (typeof entries)[number], tokens: string[]): boolean {
  return tokens.every((token) =>
    token.length <= 2 ? entry.words.has(token) : entry.text.includes(token),
  );
}

/** Resolve exact identifiers only. Ambiguous aliases never preselect a school. */
export function findUniversity(value: string | undefined): University | undefined {
  if (!value || value.length > 160) return undefined;
  const query = normalize(value);
  return query ? (byId.get(query) ?? byAlias.get(query)) : undefined;
}

export function universityMatches(university: University, value: string): boolean {
  return matches(
    byUniversity.get(university) ?? searchable(university),
    normalize(value).split(/\s+/).filter(Boolean),
  );
}

/** Return a bounded menu, ranking exact names/domains before broad text matches. */
export function searchUniversities(value: string, limit = 50): readonly University[] {
  const maximum = Math.min(100, Math.max(0, Math.floor(limit)));
  if (!maximum || value.length > 160) return [];
  const query = normalize(value);
  const tokens = query.split(/\s+/).filter(Boolean);
  const exact = findUniversity(value);
  return entries
    .filter((entry) => matches(entry, tokens))
    .map((entry) => ({
      university: entry.university,
      rank:
        entry.university === exact
          ? 0
          : !query
            ? entry.university.portalUrl
              ? 1
              : 2
            : entry.aliases.includes(query)
              ? 1
              : entry.name.startsWith(query)
                ? 2
                : entry.name.includes(query)
                  ? 3
                  : 4,
    }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, maximum)
    .map((entry) => entry.university);
}
