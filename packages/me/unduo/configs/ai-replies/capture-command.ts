import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { captureAiReplies } from "#capture";
import type { Site } from "#sites";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const { values } = parseArgs({
  options: {
    site: { type: "string", multiple: true },
    file: { type: "string", default: join(root, "www/files/unduo") },
    name: { type: "string", default: "UnDuo - University of Toronto.html" },
    images: { type: "string", default: join(root, "apps/unduo-web/src/assets") },
    results: { type: "string", default: fileURLToPath(new URL("results.json", import.meta.url)) },
    focus: { type: "boolean", default: false },
  },
});

const captures = await captureAiReplies({
  file: values.file,
  fileName: values.name,
  images: values.images,
  results: values.results,
  raw: join(root, ".output/ai-replies"),
  sites: (values.site ?? ["chatgpt", "gemini", "claude"]) as Site["id"][],
  focus: values.focus,
});
for (const { name, model, verdict, screenshot, whole, error } of captures)
  console.log(
    error
      ? `${name}: failed: ${error}`
      : `${name} (${model}): Safe: ${verdict}  ${join(values.images, screenshot!)}${whole ? "" : "  (the tree cut part of the reply short)"}`,
  );
if (captures.some(({ verdict }) => verdict !== "yes")) process.exitCode = 1;
console.log("If a reply changed, update it in packages/me/unduo/components/home/ai-replies.ts.");
