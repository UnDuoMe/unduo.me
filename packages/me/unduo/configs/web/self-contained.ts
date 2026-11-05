import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseHtml } from "parse5";
import postcss, { type Container } from "postcss";
import { installedPackage, integritySource, readCdnSource } from "#cdn-source";

/**
 * An experiment: with UNDUO_SELF_CONTAINED=1 (and UNDUO_JS_PLUGIN=1, so no
 * WebAssembly is fetched), each page holds its stylesheets and screenshots
 * and loads nothing over the network.
 */
export const selfContained = process.env.UNDUO_SELF_CONTAINED === "1";

const sri = (bytes: Buffer) => `sha256-${createHash("sha256").update(bytes).digest("base64")}`;

/**
 * Every `uk-` class a document names: in the `class` attributes of its markup,
 * template contents included, and in its script, which builds the rest of the
 * page. A `uk-` word in the script that isn't a class only keeps a rule.
 */
export function usedUikitClasses(html: string) {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map(
    ([, code]) => code!,
  );
  const shell = html
    .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script\s*>)/gi, "$1$2")
    .replace(/(<style\b[^>]*>)[\s\S]*?(<\/style\s*>)/gi, "$1$2");
  const used = new Set<string>();
  const collect = (text: string) => {
    for (const [token] of text.matchAll(/(?<![\w-])uk-[\w-]+/g)) used.add(token);
  };
  type Node = {
    attrs?: { name: string; value: string }[];
    childNodes?: Node[];
    content?: Node;
  };
  const visit = (node: Node) => {
    for (const { name, value } of node.attrs ?? []) if (name === "class") collect(value);
    for (const child of node.childNodes ?? []) visit(child);
    if (node.content) visit(node.content);
  };
  visit(parseHtml(shell) as Node);
  scripts.forEach(collect);
  return used;
}

/**
 * The CSS of a reviewed npm stylesheet, such as UIkit's, read from the
 * installed package only if its SHA-256 is the one the normal pages pin.
 */
export function reviewedStylesheet(url: string) {
  const reviewed = readCdnSource().assets[url];
  const npm = integritySource(url);
  if (!reviewed || !npm) throw new Error(`Not a reviewed stylesheet: ${url}`);
  const bytes = readFileSync(join(installedPackage(npm.name).directory, npm.file));
  if (sri(bytes) !== reviewed.integrity)
    throw new Error(`The installed file differs from the reviewed one: ${url}`);
  return { css: bytes.toString("utf8"), integrity: reviewed.integrity, ...npm };
}

/**
 * Trim UIkit's CSS to what a page can use. A selector stays only if every
 * `.uk-` class in it is in `used`, or it names none; a rule left with no
 * selectors goes, then each `@keyframes` no remaining `animation` names, then
 * every at-rule left empty. Comments, including the license, stay.
 */
export function trimUikit(css: string, used: ReadonlySet<string>) {
  const root = postcss.parse(css);
  root.walkRules((rule) => {
    if (
      rule.parent?.type === "atrule" &&
      /keyframes$/i.test((rule.parent as { name: string }).name)
    )
      return;
    // A class name may hold CSS escapes, as in `.uk-width-1-2\@m`.
    const kept = rule.selectors.filter((selector) =>
      [...selector.matchAll(/\.(uk-(?:[\w-]|\\.)+)/g)].every(([, name]) =>
        used.has(name!.replace(/\\(.)/g, "$1")),
      ),
    );
    if (kept.length) rule.selectors = kept;
    else rule.remove();
  });
  const animations = new Set<string>();
  root.walkDecls(/^(?:-webkit-)?animation(?:-name)?$/i, (declaration) => {
    for (const word of declaration.value.split(/[\s,]+/)) animations.add(word);
  });
  root.walkAtRules(/keyframes$/i, (atRule) => {
    if (!animations.has(atRule.params)) atRule.remove();
  });
  /** Remove at-rules left empty, innermost first. */
  const prune = (container: Container) =>
    container.each((node) => {
      if (node.type !== "atrule" || !node.nodes) return;
      prune(node);
      if (!node.nodes.length) node.remove();
    });
  prune(root);
  return root.toString();
}
