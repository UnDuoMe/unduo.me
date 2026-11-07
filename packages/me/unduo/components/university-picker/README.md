# @-/me.unduo.components.university-picker

The home page's searchable university dropdown. It searches the published subset of the WHED directory locally by name, acronym, country, province and available domain aliases, and lists the matches under the field as an ARIA combobox: the arrow keys move the highlight, Enter or a click chooses, and Escape, Tab or a click elsewhere closes the list.

```ts
export { universityPicker } from "#university-picker";
```

`universityPicker(choose)` returns the dropdown, whose field has the id `university`, and calls `choose` with the institution chosen. **Other** (`otherInstitution`, "Any other school or company") is always the last option, even when nothing matches, and leads to the file that names no institution. The web adapter defaults to UofT, Waterloo and Western and can publish the full directory with `UNDUO_UNIVERSITIES=all`. No activation codes or secrets enter the picker. A directory record does not establish that the institution uses Duo.
