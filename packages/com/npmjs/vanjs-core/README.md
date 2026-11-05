# @-/com.npmjs.vanjs-core

Workspace wrapper for VanJS. The exact upstream version lives in the root catalog. `van` is a global, declared in `global.d.ts`, so code uses it without importing it; import only the `State` and `Van` types from this package. No page's script contains the npm package: `cdnLibraries` refuses any import of it.

`van-<version>.nomodule.js` is `public/van-<version>.nomodule.js` from
[github.com/vanjs-org/van](https://github.com/vanjs-org/van), byte for byte, which
the pages hold in their own script element, in the dev server as in a build. It sets
`window.van`, the global the pages' code uses in place of a copy of VanJS. Formatting
and linting skip it, the build fails if it differs from the SHA-256 the element names,
and `vp run verify:cdn` compares the element with GitHub's copy. To update VanJS, replace this file and
`vanjsCommit` in `configs/web/auditable-build.ts` along with the catalog version.
