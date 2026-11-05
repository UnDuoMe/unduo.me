/** One element line of an `orca computer` accessibility tree: its index and description. */
export interface TreeLine {
  index: string;
  text: string;
}

/** The element lines of a tree, without their indentation. */
export function treeLines(tree: string): TreeLine[] {
  return tree.split("\n").flatMap((line) => {
    const match = /^\s*(\d+) (.*)$/.exec(line);
    return match ? [{ index: match[1]!, text: match[2]! }] : [];
  });
}

/** The first element whose description matches `pattern`. */
export const findLine = (tree: string, pattern: RegExp) =>
  treeLines(tree).find(({ text }) => pattern.test(text));

/** A line of the reply that gives the verdict; the prompt's own "Start your reply with…" doesn't count. */
const verdictLine = /^(?:text|heading|container, Text:) .*?\bSafe:\s*(yes|no)\b/i;
/** A button that stops a reply still being written. */
const busyLine = /^button (?:Stop|Stop response|Stop streaming|Stop generating)\b/;

export interface Reply {
  /** The verdict the reply starts with. */
  verdict: "yes" | "no";
  /** The verdict's element, which the page scrolls to. */
  index: string;
  /** The reply's text as the accessibility tree gives it; long containers come truncated. */
  text: string;
}

/** The finished reply in `tree`, or nothing while there is none or it is still being written. */
export function finishedReply(tree: string): Reply | undefined {
  const lines = treeLines(tree);
  if (lines.some(({ text }) => busyLine.test(text))) return undefined;
  const start = lines.findIndex(
    ({ text }) => verdictLine.test(text) && !text.includes("Start your reply"),
  );
  if (start === -1) return undefined;
  const parts: string[] = [];
  for (const { text } of lines.slice(start)) {
    if (/^button (?:Copy|Retry)\b|^toggle button|^pop up button/.test(text)) break;
    const content = /^(?:text|heading|container, Text:) (.*)$/.exec(text)?.[1]?.trim();
    if (content) parts.push(content);
  }
  const verdict = verdictLine.exec(lines[start]!.text)![1]!.toLowerCase() as Reply["verdict"];
  return { verdict, index: lines[start]!.index, text: parts.join("\n") };
}

const words = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * Whether the text box at `box` holds `text` and nothing else, as its tree line
 * shows it: the box's label, then the text, with whitespace collapsed.
 */
export function holdsOnly(tree: string, box: RegExp, text: string) {
  const line = findLine(tree, box);
  if (!line) return false;
  const label = box.exec(line.text)![0];
  return words(line.text.slice(label.length)).replace(/^, Value: /, "") === words(text);
}
