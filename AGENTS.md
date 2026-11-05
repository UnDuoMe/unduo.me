<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Running Scripts

Run TypeScript and JavaScript files with `vpx <file>`, for example `vpx ./scripts/seed.ts --dry-run`. It handles enums, decorators, JSX, and tsconfig `paths`, so do not add `tsx` or `ts-node` to run scripts. `vpx --watch <file>` reruns the file when a file it uses changes, in place of `tsx watch`. `vp node <file>` runs plain Node.js.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

## Flatcap layout

- Follow [DEVELOPMENT.md](./DEVELOPMENT.md) before changing package structure.
- Keep the framework adapter in `apps/unduo-web` thin.
- Keep development, build, update, and QA scripts in `packages/me/unduo/configs/...`; do not add app-level `scripts/` directories.
- Shared packages live in `packages/me/unduo` and use `@-/me.unduo.*` names matching their paths. npm wrappers live in `packages/com/npmjs`.
- Keep schemas and types in nested `+entities` packages under their owning feature; omit the leading `+` from the package name. Do not use a top-level `entities/` package.
- Each package has `package.json`, a README, and an explicit `+.ts` or `+server.ts` public API. Keep implementation files flat and use `#...` imports within a package; import other packages through their public API.
- `_` package segments are protected to their parent scope; `__` segments are private to their parent package. Co-locate tests in `__tests__`.
- Keep third-party versions in the root Bun catalog and workspace dependencies explicit.
- Flatcap conventions are enforced by the published `eslint-plugin-flatcap` through Vite+'s lint configuration.
- Validate with `vp check`, `vp test`, and `vp run build:web`.

## Git identity

- All commits, including generated CDN asset commits, must use `cursoragent
  <199161495+cursoragent@users.noreply.github.com>` for both author and committer.
- Never add `Co-authored-by` trailers or personal attribution. Keep copyright
  and project metadata under UnDuoMe. This applies to every agent and tool,
  including Cursor CLI and Cloud Agents.
- Run `vp run setup:git` to restore the repository-local identity and `vp hooks
  enable` to restore Vite+ hooks. Never bypass the identity policy.
- Run `vp run check:git` before every push. Do not push any history containing
  another author or committer, or any coauthor trailers. GitHub push authentication is separate;
  all pushes must authenticate as the UnDuoMe Automation GitHub App. Never use
  personal credentials, a personal HTTP Authorization header, or an SSH remote.
- Run `vp run setup:github-app` to register/install the App and `vp run
  check:github-app` before pushing. The repository credential helper creates
  short-lived installation tokens restricted to this repo and never falls back
  to personal credentials. Keep the App key outside the repository.
