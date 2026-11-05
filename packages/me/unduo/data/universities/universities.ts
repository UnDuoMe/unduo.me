import { universityDirectory } from "@-/com.npmjs.universities-domains-list";
import type { University } from "@-/me.unduo.data.universities.entities";
import { mfaOverrides } from "#mfa-overrides";
import directory from "#whed-directory" with { type: "json" };

function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#39|#\d+|#x[\da-f]+);/gi, (entity) => {
    const named: Record<string, string> = {
      "&amp;": "&",
      "&quot;": '"',
      "&apos;": "'",
      "&#39;": "'",
      "&lt;": "<",
      "&gt;": ">",
    };
    if (named[entity]) return named[entity];
    const code = entity.startsWith("&#x")
      ? parseInt(entity.slice(3), 16)
      : Number(entity.slice(2, -1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}
function normalize(value: string): string {
  return decodeEntities(value)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/^the /, "")
    .trim();
}
function location(value: string): { country: string; stateProvince?: string } {
  for (const [prefix, country] of [
    ["United States of America - ", "United States"],
    ["Canada - ", "Canada"],
    ["Belgium - ", "Belgium"],
  ]) {
    if (value.startsWith(prefix))
      return { country, stateProvince: decodeEntities(value.slice(prefix.length)) };
  }
  return {
    country:
      (
        {
          "China - Hong Kong SAR": "Hong Kong",
          "China - Macao SAR": "Macao",
          "China - Taiwan": "Taiwan",
          "Korea (Republic of)": "Korea, Republic of",
          "Slovak Republic": "Slovakia",
          Türkiye: "Turkey",
          "North Macedonia (Republic of)": "Macedonia",
        } as Record<string, string>
      )[value] ?? value,
  };
}
const records = directory
  .filter(([, name]) => name.trim())
  .map(([id, name, region]) => ({
    id,
    name: decodeEntities(name),
    ...location(region),
  }));
const byName = new Map<string, (typeof records)[number][]>();
for (const record of records) {
  const key = `${normalize(record.country)}|${normalize(record.name)}`;
  byName.set(key, [...(byName.get(key) ?? []), record]);
}
function exact(country: string, names: readonly string[]) {
  const matches = new Set(
    names.flatMap((name) => byName.get(`${normalize(country)}|${normalize(name)}`) ?? []),
  );
  return matches.size === 1 ? [...matches][0] : undefined;
}
const aliases = new Map<string, Set<string>>();
function addAliases(id: string, values: readonly string[]) {
  const names = aliases.get(id) ?? new Set<string>();
  values.forEach((value) => names.add(value));
  aliases.set(id, names);
}
// Domains enrich verified name/country matches; they never create institutions
// or establish that an institution uses Duo.
for (const record of universityDirectory) {
  const matched = exact(record.country, [record.name]);
  if (matched) addAliases(matched.id, [record.name, ...record.domains]);
}
const profiles = new Map<string, University>();
for (const profile of mfaOverrides) {
  const domainMatches = universityDirectory.filter(
    (record) =>
      normalize(record.country) === normalize(profile.country) &&
      record.domains.some((domain) => profile.aliases.includes(domain)),
  );
  const matched = profile.whedIds
    ? records.filter((record) => profile.whedIds!.includes(record.id))
    : [
        exact(profile.country, [
          profile.name,
          ...profile.aliases,
          ...(domainMatches.length === 1 ? [domainMatches[0].name] : []),
        ]),
      ].filter((record) => record !== undefined);
  for (const record of matched) {
    profiles.set(record.id, profile);
    addAliases(record.id, [profile.id, profile.name, ...profile.aliases]);
  }
}
/** Full WHED catalog snapshot; the WHED ID is the canonical route and identity. */
export const universities: readonly University[] = records
  .map((record) => {
    const profile = profiles.get(record.id);
    return {
      ...profile,
      ...record,
      aliases: [...(aliases.get(record.id) ?? [])],
      sourceUrl: profile?.sourceUrl ?? `https://www.whed.net/institutions/${record.id}`,
      sourceKind: profile?.sourceKind ?? "directory",
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
