import { defineConfig } from "vite-plus";
import flatcap from "eslint-plugin-flatcap";

export default defineConfig({
  test: {
    // Vitest v4 compatibility: preserve mock call history.
    // Remove after tests no longer rely on calls from setup or earlier tests.
    // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
    // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
    clearMocks: false,
  },
  staged: { "*": "vp check --fix" },
  // Formatting the generated HTML would invalidate its script-hash CSP, and the
  // page's copy of VanJS stays byte for byte as published.
  fmt: { ignorePatterns: ["/www/**", "/packages/com/npmjs/vanjs-core/*.nomodule.js"] },
  lint: {
    ...flatcap.configs.oxlint,
    ignorePatterns: ["www/**", "packages/com/npmjs/vanjs-core/*.nomodule.js"],
    options: { typeAware: true, typeCheck: true },
  },
});
