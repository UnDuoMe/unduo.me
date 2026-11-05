/** Text as HTML text, which needs only these two escaped, so the source reads as typed. */
export function escapeText(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
}

/**
 * The attributes the build writes on a page's few elements, each with a space
 * before it. An undefined value leaves its attribute out.
 */
export function attributes(values: Record<string, string | undefined>) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => ` ${name}="${escapeText(value!).replaceAll('"', "&quot;")}"`)
    .join("");
}
