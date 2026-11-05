import { defineCommand } from "@-/com.npmjs.citty";
import { parseDevPort } from "#dev-port";
import { createMprocsConfig } from "#generate-mprocs-config";
import { resolveNodeExecutable, startDevStack } from "#start-dev-stack";

export const devCommand = defineCommand({
  meta: { name: "_dev", description: "Run the Vite dev server in mprocs." },
  args: {
    port: {
      type: "string",
      description: "mprocs base port (default 2999); Vite uses the next port.",
    },
    "print-config": {
      type: "boolean",
      description: "Print the generated config without starting processes.",
    },
  },
  async run({ args }) {
    const port = parseDevPort(args.port);
    const nodeExecutable = resolveNodeExecutable();
    if (args["print-config"]) {
      process.stdout.write(
        `${JSON.stringify(createMprocsConfig(port, nodeExecutable), null, 2)}\n`,
      );
      return;
    }
    process.exitCode = await startDevStack(port, nodeExecutable);
  },
});
