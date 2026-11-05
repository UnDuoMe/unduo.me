import { van } from "@-/com.npmjs.vanjs-core";

export { van };
export type { State } from "@-/com.npmjs.vanjs-core";

/**
 * The HTML elements the pages build, each a function of its properties and
 * children. A function or `State` as a value keeps that property or child up
 * to date. Text becomes text nodes, so nothing here writes HTML.
 */
export const {
  a,
  aside,
  button,
  code,
  details,
  dialog,
  div,
  em,
  fieldset,
  footer,
  form,
  h1,
  h2,
  h3,
  header,
  iframe,
  img,
  input,
  kbd,
  label,
  legend,
  li,
  main,
  nav,
  ol,
  p,
  pre,
  section,
  span,
  strong,
  summary,
  textarea,
  ul,
} = van.tags;

/** The icon elements, which need their namespace. */
export const { path, svg } = van.tags("http://www.w3.org/2000/svg");
