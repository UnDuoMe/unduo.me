import { aiPrompt } from "@-/me.unduo.components.home/server";
import { expect, test } from "vite-plus/test";
import {
  copyButton,
  findLine,
  finishedReply,
  holdsOnly,
  joinPieces,
  promptText,
  promptUnfolder,
  replyMarkdown,
  showsChatList,
  treeLines,
} from "#tree";

const tree = (lines: string[]) =>
  [
    "App=com.google.Chrome (pid 1)",
    "",
    ...lines.map((line) => `\t\t${line}`),
    "",
    "The focused UI element is 3 text.",
  ].join("\n");

const prompt =
  'text Answer "Safe: no" only if you can point to how. Start your reply with "Safe: yes" or "Safe: no", then explain.';

test("no paragraph of the real prompt reads as the AI's verdict", () => {
  // The sites show each paragraph as its own line, and only "Start your reply" marks one as the prompt's.
  expect(
    finishedReply(tree(aiPrompt.split("\n\n").map((paragraph) => `text ${paragraph}`))),
  ).toBeUndefined();
});

test("reads element lines and finds one by pattern", () => {
  const lines = tree([
    "7 text field (settable) Address and search bar, Value: example.com",
    "51 button Send",
  ]);
  expect(treeLines(lines)).toEqual([
    {
      index: "7",
      text: "text field (settable) Address and search bar, Value: example.com",
      depth: 2,
    },
    { index: "51", text: "button Send", depth: 2 },
  ]);
  expect(findLine(lines, /^button Send$/)?.index).toBe("51");
});

test("finds the finished reply, not the prompt's own wording", () => {
  expect(finishedReply(tree([`12 ${prompt}`]))).toBeUndefined();
  const reply = finishedReply(
    tree([
      `12 ${prompt}`,
      "40 text Safe: yes",
      "41 text The activation code goes only to Duo.",
      "42 container, Text: The key stays in your browser.",
      "43 button Copy",
      "44 text ChatGPT can make mistakes.",
    ]),
  );
  expect(reply).toEqual({
    verdict: "yes",
    index: "40",
    text: "Safe: yes\nThe activation code goes only to Duo.\nThe key stays in your browser.",
  });
  expect(
    finishedReply(tree(["40 container, Text: Safe: no — the page posts the key."]))?.verdict,
  ).toBe("no");
});

test("rebuilds the reply as Markdown: paragraphs, lists and leads, without buttons", () => {
  const reply = replyMarkdown(
    tree([
      `12 ${prompt}`,
      "13 button Copy",
      "40 heading Claude responded: Safe: yes.",
      "41 container",
      "\t42 button Tracing how the secret could leave",
      "\t43 text Tracing how the secret could leave",
      "44 text Safe: yes. Nothing sends your code anywhere but Duo.",
      "45 content list",
      "\t46 container",
      "\t\t47 axlistmarker, Value: •",
      "\t\t48 text Where data can go:",
      "\t\t49 text Only Duo's servers (",
      "\t\t50 text *.duosecurity.com",
      "\t\t51 text ) and a few fixed files.",
      "\t52 container",
      "\t\t53 axlistmarker, Value: •",
      "\t\t54 text The key stays in your browser.",
      "55 container",
      "\t56 text It restricts all network activity",
      "\t57 button University of Toronto.html",
      "\t58 text .",
      "59 heading How it does that",
      "60 content list",
      "\t61 container",
      "\t\t62 axlistmarker, Value: 1.",
      "\t\t63 text A strict policy.",
      "64 toolbar Message actions",
      "65 button Copy",
      "66 text Claude can make mistakes.",
    ]),
  );
  expect(reply).toEqual({
    verdict: "yes",
    whole: true,
    markdown: [
      "Safe: yes. Nothing sends your code anywhere but Duo.",
      "- **Where data can go:** Only Duo's servers (*.duosecurity.com) and a few fixed files.\n- The key stays in your browser.",
      "It restricts all network activity.",
      "### How it does that",
      "1. A strict policy.",
    ].join("\n\n"),
  });
  // A long paragraph the tree sums up in one line comes cut short.
  expect(
    replyMarkdown(tree(["40 text Safe: yes", "41 container, Text: The page’s security rules..."]))
      ?.whole,
  ).toBe(false);
});

test("finds the Copy button under the reply, not the one under the prompt", () => {
  const lines = tree([
    `12 ${prompt}`,
    "13 button Copy",
    "40 text Safe: yes",
    "41 text The activation code goes only to Duo.",
    "43 button Copy response",
  ]);
  expect(copyButton(lines, { index: "40" })).toBe("43");
  expect(copyButton(lines, { index: "99" })).toBeUndefined();
});

test("puts back the spaces between a paragraph's pieces", () => {
  expect(joinPieces(["in your browser", ". It restricts", "“", "this", "”", "too"])).toBe(
    "in your browser. It restricts “this” too",
  );
});

test("waits while the reply is still being written", () => {
  expect(finishedReply(tree(["40 text Safe: yes", "50 button Stop streaming"]))).toBeUndefined();
});

test("sends only a box that holds exactly the prompt", () => {
  const box = /^text entry area \(settable\) Ask ChatGPT/;
  const prompt = "First paragraph.\n\nSecond “quoted” paragraph.";
  const filled = (value: string) => tree([`47 text entry area (settable) Ask ChatGPT ${value}`]);
  expect(holdsOnly(filled("First paragraph. Second “quoted” paragraph."), box, prompt)).toBe(true);
  // Keys typed while Chrome was in front, before or after the pasted prompt.
  expect(holdsOnly(filled("leoFirst paragraph. Second “quoted” paragraph."), box, prompt)).toBe(
    false,
  );
  expect(holdsOnly(filled("First paragraph. Second “quoted” paragraph.x"), box, prompt)).toBe(
    false,
  );
  expect(holdsOnly(tree(["3 button Send"]), box, prompt)).toBe(false);
});

test("finds the button that unfolds the prompt, not one in the reply", () => {
  const asked =
    "The attached file is from a website for setting up Duo two-factor authentication. Please read it.";
  const page = (unfold: string) =>
    tree([
      "5 button Show more",
      "10 heading You said:",
      "11 text The attached file is from a website for setting up Duo two-factor  authentication.",
      `12 button ${unfold}`,
      "40 text Safe: yes",
      "41 button Show more",
    ]);
  expect(promptUnfolder(page("Show more"), asked)).toBe("12");
  // The prompt's own text, a safe place to click.
  expect(promptText(page("Show less"), asked)).toBe("11");
  expect(promptUnfolder(page("Expand"), asked)).toBe("12");
  // Unfolded, it offers to fold again; the reply's own button doesn't count.
  expect(promptUnfolder(page("Show less"), asked)).toBeUndefined();
  expect(promptUnfolder(page("Collapse"), asked)).toBeUndefined();
});

test("notices a sidebar's list of chats", () => {
  expect(showsChatList(tree(["5 link New chat", "6 button Open sidebar"]))).toBe(false);
  expect(showsChatList(tree(["5 heading Recents", "6 link Plans for Friday"]))).toBe(true);
  expect(showsChatList(tree(["5 text Your chats"]))).toBe(true);
});
