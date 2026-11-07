/** One element line of an `orca computer` accessibility tree: its index, description and indentation. */
export interface TreeLine {
  index: string;
  text: string;
  depth: number;
}

/** The element lines of a tree, with their indentation as a depth. */
export function treeLines(tree: string): TreeLine[] {
  return tree.split("\n").flatMap((line) => {
    const match = /^(\s*)(\d+) (.*)$/.exec(line);
    return match ? [{ index: match[2]!, text: match[3]!, depth: match[1]!.length }] : [];
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

/** The first Copy button below the reply's verdict, which copies the whole reply. */
export function copyButton(tree: string, reply: Pick<Reply, "index">) {
  const lines = treeLines(tree);
  const start = lines.findIndex(({ index }) => index === reply.index);
  if (start === -1) return undefined;
  return lines.slice(start).find(({ text }) => /^button Copy\b/.test(text))?.index;
}

/** Where a reply ends: the buttons under it. */
const replyEnd = /^(?:toolbar|button (?:Copy|Retry)\b|toggle button)/;
/** A heading only screen readers get, such as "Claude responded: …" or "Gemini said", which isn't part of the reply. */
const announcement = /^heading \S+ (?:responded|said)\b/;
/** An element that holds a reply's words. */
const textLine = /^(?:text|heading) (.*)$/;

/**
 * Join the pieces of one paragraph. The tree trims each piece, so put a space
 * back between them, except next to brackets and before punctuation.
 */
export function joinPieces(pieces: string[]) {
  return pieces.reduce(
    (text, piece) =>
      !text || /[([“‘/]$/.test(text) || /^[.,;:!?)\]”’]/.test(piece)
        ? text + piece
        : `${text} ${piece}`,
    "",
  );
}

/** A paragraph or list item's pieces, its first in bold when it's a lead such as "Where data can go:". */
function inline(pieces: string[]) {
  const [lead, ...rest] = pieces;
  return lead?.endsWith(":") && rest.length
    ? `**${lead}** ${joinPieces(rest)}`
    : joinPieces(pieces);
}

/**
 * The finished reply in `tree` as Markdown: its paragraphs, headings and lists,
 * a list item's lead in bold. `whole` is false when the tree cut a paragraph
 * short, as it does when it sums up a long one in a single line. Buttons, such
 * as a thinking summary or a cited file, and their text are left out.
 */
export function replyMarkdown(tree: string) {
  const reply = finishedReply(tree);
  if (!reply) return undefined;
  const lines = treeLines(tree);
  const start = lines.findIndex(({ index }) => index === reply.index);
  const end = lines.findIndex((line, at) => at > start && replyEnd.test(line.text));
  const body = lines.slice(start, end === -1 ? undefined : end);
  const parentOf = (at: number) => {
    for (let before = at - 1; before >= 0; before--)
      if (body[before]!.depth < body[at]!.depth) return before;
    return -1;
  };
  const buttons = new Set<string>();
  const blocks: string[] = [];
  let whole = true;
  let paragraph: { parent: number; pieces: string[] } | undefined;
  const flush = () => {
    if (paragraph?.pieces.length) blocks.push(inline(paragraph.pieces));
    paragraph = undefined;
  };
  const piece = (text: string) => {
    if (text.endsWith("...") || text.endsWith("…")) whole = false;
    return text;
  };
  for (let at = 0; at < body.length; at++) {
    const { text, depth } = body[at]!;
    const button = /^(?:button|pop up button|link) (.*)$/.exec(text);
    if (button) {
      buttons.add(button[1]!);
      continue;
    }
    if (announcement.test(text)) continue;
    if (/^(?:content )?list\b/.test(text)) {
      flush();
      const items: string[] = [];
      let ordered = false;
      let item: string[] | undefined;
      for (at++; at < body.length && body[at]!.depth > depth; at++) {
        const line = body[at]!;
        if (line.depth === depth + 1) {
          if (item?.length) items.push(inline(item));
          item = [];
        }
        const marker = /^axlistmarker, Value: (.*)$/.exec(line.text);
        if (marker) ordered ||= /^\d+[.)]$/.test(marker[1]!.trim());
        const content =
          textLine.exec(line.text)?.[1] ?? /^container, Text: (.*)$/.exec(line.text)?.[1];
        if (content && !buttons.has(content)) (item ??= []).push(piece(content));
      }
      at--;
      if (item?.length) items.push(inline(item));
      blocks.push(items.map((text, n) => `${ordered ? `${n + 1}.` : "-"} ${text}`).join("\n"));
      continue;
    }
    const heading = /^heading (.*)$/.exec(text);
    if (heading && at > 0) {
      flush();
      blocks.push(`### ${piece(heading[1]!)}`);
      continue;
    }
    const content = textLine.exec(text)?.[1] ?? /^container, Text: (.*)$/.exec(text)?.[1];
    if (!content || buttons.has(content)) continue;
    // Pieces of one paragraph share a plain container, such as text broken up by a bold phrase.
    const parent = parentOf(at);
    const inParagraph = parent !== -1 && body[parent]!.text === "container";
    if (!inParagraph || paragraph?.parent !== parent) flush();
    paragraph ??= { parent: inParagraph ? parent : -1, pieces: [] };
    paragraph.pieces.push(piece(content));
    if (!inParagraph) flush();
  }
  flush();
  return { verdict: reply.verdict, markdown: blocks.join("\n\n"), whole };
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

/** A button that unfolds a long prompt: ChatGPT's and Claude's "Show more", Gemini's "Expand". */
const unfold = /^button (?:Show more|Expand)$/;

/**
 * The button that unfolds `prompt` in the conversation, if the site folded it:
 * the first such button after the prompt's opening words and before the reply.
 */
export function promptUnfolder(tree: string, prompt: string) {
  const lines = treeLines(tree);
  const opening = words(prompt).slice(0, 60);
  const start = lines.findIndex(
    ({ text }) => /^(?:text|heading) /.test(text) && words(text).includes(opening),
  );
  if (start === -1) return undefined;
  const end = lines.findIndex(
    ({ text }, at) => at > start && verdictLine.test(text) && !text.includes("Start your reply"),
  );
  return lines.slice(start, end === -1 ? undefined : end).find(({ text }) => unfold.test(text))
    ?.index;
}

/** A list of past chats, as a site's sidebar shows one when it's open. */
const chatList = /^(?:heading|text) (?:Recents?|Chats|Your chats|Chat history)$/;

/** Whether the page shows a list of the account's other chats, which a screenshot mustn't. */
export const showsChatList = (tree: string) =>
  treeLines(tree).some(({ text }) => chatList.test(text));
