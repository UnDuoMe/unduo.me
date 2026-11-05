import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { captureAiReplies } from "#capture";
import type { Site } from "#sites";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const { values } = parseArgs({
  options: {
    site: { type: "string", multiple: true },
    file: { type: "string", default: join(root, "www/files/020599") },
    name: { type: "string", default: "University of Toronto.html" },
    out: { type: "string", default: fileURLToPath(new URL("screenshots", import.meta.url)) },
    focus: { type: "boolean", default: false },
  },
});

const captures = await captureAiReplies({
  file: values.file,
  fileName: values.name,
  out: values.out,
  raw: join(root, ".output/ai-replies"),
  sites: (values.site ?? ["chatgpt", "gemini", "claude"]) as Site["id"][],
  focus: values.focus,
});
for (const { name, model, verdict, screenshot, error } of captures)
  console.log(
    error
      ? `${name}: failed: ${error}`
      : `${name} (${model}): Safe: ${verdict}  ${join(values.out, screenshot!)}`,
  );
if (captures.some(({ verdict }) => verdict !== "yes")) process.exitCode = 1;
