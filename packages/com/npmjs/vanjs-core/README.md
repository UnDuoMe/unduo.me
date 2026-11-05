# @-/com.npmjs.vanjs-core

Workspace wrapper for VanJS. The exact upstream version lives in the root catalog. Import `van` and the `State` type from this package. It is the one npm package the page's script may contain, and `cdnLibraries` allows only its `src/van.js`.

`van-<version>.nomodule.js` is `public/van-<version>.nomodule.js` from
[github.com/vanjs-org/van](https://github.com/vanjs-org/van), byte for byte, which
the built pages hold in their own script element. It sets `window.van`, which the
pages' bundles read in place of a copy of VanJS. Formatting and linting skip it, the
build fails if it differs from the SHA-256 the element names, and `vp run verify:cdn`
compares the element with GitHub's copy. To update VanJS, replace this file and
`vanjsCommit` in `configs/web/auditable-build.ts` along with the catalog version.
