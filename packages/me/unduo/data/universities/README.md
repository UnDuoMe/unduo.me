# @-/me.unduo.data.universities

The canonical university directory is the complete [WHED catalog 7299](https://mix-n-match.toolforge.org/#/catalog/7299) export from Wikimedia's Mix'n'match. `whed-directory.json` records each Global WHED ID, institution name and country/region. `whed-source.json` records the source, retrieval date, record count and export checksum. This is a versioned snapshot, not a live completeness guarantee. Of its 21,547 records, three have empty names and are excluded from search and page generation.

Every published `University.id` is its actual WHED identifier, including compound branch identifiers. Branch suffixes and leading zeroes are preserved. Branches stay distinct from their parent. Country subdivisions in the catalog become `stateProvince`.

The `universities-domains-list` npm directory enriches unambiguous name/country matches with domain aliases. Separately sourced Duo information in `mfa-overrides.ts` adds verified portal URLs and notes. Directory inclusion does not confirm Duo use, and ordinary website URLs never become enrollment URLs. All 32 portal URLs survive the migration; Rutgers' shared NetID portal appears on its three WHED campus records. Explicit `whedIds` mappings cite the relevant university service. Unmatched systems, departments and community colleges do not receive invented WHED IDs.

Run `vp run update:universities` to refresh the full catalog export, then review its diff and rebuild. This downloads all entries, including those without a Wikidata match. Edit `mfa-overrides.ts` for reviewed Duo information. Known legacy IDs such as `utoronto` remain search aliases where unambiguous. Never infer a portal hostname from a university name or website. Run `vp check`, `vp test` and `vp run build:web` after changes.
