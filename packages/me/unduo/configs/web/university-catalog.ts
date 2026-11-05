import type { Plugin } from "vite";
import { getBuildUniversities } from "#build-universities";

/** Enrich the catalog locally; browsers receive only the resulting records. */
export function universityCatalog(): Plugin {
  const universities = getBuildUniversities();
  const id = "\0unduo:university-catalog";
  return {
    name: "build-university-catalog",
    enforce: "pre",
    applyToEnvironment(environment) {
      return environment.name === "client";
    },
    resolveId(source) {
      if (source === "@-/me.unduo.data.universities") return id;
    },
    load(source) {
      if (source === id) return `export const universities = ${JSON.stringify(universities)};`;
    },
  };
}
