import { defineConfig } from "vite-plus";

/**
 * Builds the extension into `dist/`: `public/` (the manifest and icons) as is, and
 * `src/content.ts` as one classic script, since a manifest's content scripts can't be
 * modules. It stays unminified so anyone can read what runs on Duo's page.
 */
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: "src/content.ts",
      formats: ["iife"],
      name: "unduoExtension",
      fileName: () => "content.js",
    },
  },
});
