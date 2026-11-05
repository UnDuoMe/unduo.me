import { expect, test } from "vite-plus/test";
import { validateStylesheet } from "#html-security";
import { readCdnSource } from "#cdn-source";
import { reviewedStylesheet, trimUikit, usedUikitClasses } from "#self-contained";

test("finds uk- classes in class attributes, template contents included, and in the script", () => {
  const html = `<!doctype html><html><head><style>.uk-style-only{}</style></head><body>
    <div class="uk-card uk-card-default p-4"><button class="uk-button">Go</button></div>
    <template><input class="uk-input"></template>
    <p data-note="uk-not-a-class" title="uk-title">x</p>
    <script type="module">div({ class: "uk-form-danger" });</script></body></html>`;
  expect([...usedUikitClasses(html)].sort()).toEqual([
    "uk-button",
    "uk-card",
    "uk-card-default",
    "uk-form-danger",
    "uk-input",
  ]);
});

test("keeps a selector only if each of its .uk- classes is used, or it has none", () => {
  const css = [
    "/*! License */",
    "html{color:red}",
    ".uk-button,.uk-button-small,[class*=uk-icon]{padding:0}",
    ".uk-button:not(.uk-unused){margin:0}",
    ".uk-width-1-2\\@m{width:50%}",
    "@media (min-width:640px){.uk-unused{top:0}}",
    "@media (min-width:960px){.uk-button{left:0}@supports (gap:1px){.uk-unused{gap:0}}}",
    ".uk-button{animation:uk-fade .2s}",
    "@keyframes uk-fade{0%{opacity:0}to{opacity:1}}",
    "@keyframes uk-unused-spin{to{rotate:1turn}}",
  ].join("");
  expect(trimUikit(css, new Set(["uk-button", "uk-width-1-2@m"]))).toBe(
    [
      "/*! License */",
      "html{color:red}",
      ".uk-button,[class*=uk-icon]{padding:0}",
      ".uk-width-1-2\\@m{width:50%}",
      "@media (min-width:960px){.uk-button{left:0}}",
      ".uk-button{animation:uk-fade .2s}",
      "@keyframes uk-fade{0%{opacity:0}to{opacity:1}}",
    ].join(""),
  );
});

test("trims the reviewed UIkit stylesheet to the classes the pages use", () => {
  const url = Object.keys(readCdnSource().assets)[0]!;
  const { css } = reviewedStylesheet(url);
  const used = new Set([
    "uk-alert-danger",
    "uk-button",
    "uk-button-default",
    "uk-card",
    "uk-input",
    "uk-radio",
  ]);
  const trimmed = trimUikit(css, used);
  expect(trimmed.startsWith("/*! UIkit 3.25.29 |")).toBe(true);
  expect(trimmed.length).toBeLessThan(css.length / 10);
  validateStylesheet(trimmed);
  for (const [, name] of trimmed.matchAll(/\.(uk-[\w-]+)/g)) expect(used).toContain(name);
  expect(trimmed).toMatch(/\.uk-button-default\{/);
  expect(trimmed).not.toMatch(/@media[^{]*\{\}/);
});
