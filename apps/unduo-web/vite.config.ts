import { createRequire } from "node:module";
import {
  auditableBuild,
  cdnLibraries,
  pageDefines,
  universityCatalog,
} from "@-/me.unduo.configs.web";
import { defineConfig } from "vite-plus";
import { sitePages } from "./src/pages";

const { resolve } = createRequire(import.meta.url);
/**
 * Each page's stylesheet: the setup files' own, and the home page's, which adds
 * its rules to the setup files'. Each is pinned in its own assets commit.
 */
const stylesheets = {
  setup: resolve("@-/me.unduo.components.setup/styles.css"),
  home: resolve("@-/me.unduo.components.home/styles.css"),
};

export default defineConfig({
  appType: "custom",
  define: pageDefines,
  server: { host: "127.0.0.1", port: 3000, strictPort: true, open: false },
  optimizeDeps: { noDiscovery: true },
  plugins: [universityCatalog(), cdnLibraries(), auditableBuild(sitePages(), stylesheets)],
  build: {
    // UNDUO_WEB_OUTPUT builds elsewhere, as build:web:self-contained does.
    outDir: process.env.UNDUO_WEB_OUTPUT ?? "../../www",
    emptyOutDir: true,
    // Tailwind already minifies its CSS; a second pass changes values and repeats declarations.
    minify: false,
    rolldownOptions: { input: stylesheets },
  },
});
