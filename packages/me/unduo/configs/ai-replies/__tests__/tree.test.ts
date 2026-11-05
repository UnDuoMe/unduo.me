import { expect, test } from "vite-plus/test";
import { findLine, finishedReply, holdsOnly, treeLines } from "#tree";

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

test("reads element lines and finds one by pattern", () => {
  const lines = tree([
    "7 text field (settable) Address and search bar, Value: example.com",
    "51 button Send",
  ]);
  expect(treeLines(lines)).toEqual([
    { index: "7", text: "text field (settable) Address and search bar, Value: example.com" },
    { index: "51", text: "button Send" },
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
