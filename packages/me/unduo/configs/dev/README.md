# @-/me.unduo.configs.dev

Unduo's repo-root `_dev` entrypoint, following Haniverse's mprocs pattern:
a thin Citty command generates a per-session config and supervises the Vite
dev server in an mprocs pane.

```sh
vp install
vp run dev                       # same as vpx _dev
vpx _dev --port 14999             # control 14999, Vite 15000
vpx _dev --print-config           # inspect config without starting processes
vp run dev:web                   # Vite alone, no TUI
```

The default base port is 2999: mprocs control listens on `127.0.0.1:2999`, and
Vite serves `http://127.0.0.1:3000`. It stays in the foreground and never opens a browser.
The pane inherits `UNDUO_UNIVERSITIES`, so the default remains UofT, Waterloo and Western;
`UNDUO_UNIVERSITIES=all vpx _dev` enables the full picker and route directory.

`--port P` selects control port P and Vite port P+1. Existing listeners cause a
clear error; the launcher never kills them or silently chooses another port.
Each invocation owns its mprocs session; it does not attach to or replace an
existing session. Interactive use requires a terminal (including an allocated
PTY in automation). There is no detached daemon or headless mode.

Generated JSON-as-YAML configs live in this package's ignored
`node_modules/.cache/_dev/mprocs.<P>.yaml`. Pane output is mirrored to
`<repo>/.mprocs-logs/<P>/` and truncated when that session starts. Configs use
argv arrays and absolute working directories, so paths containing spaces work.

Use `q` or Ctrl-C from mprocs' process list to quit. Each pane runs through a
Node signal relay so stopping it also stops the Vite descendants launched
through Vite+. SIGTERM/SIGHUP to `_dev` requests a graceful mprocs shutdown.

Remote control is loopback-only:

```sh
vpx mprocs --server 127.0.0.1:2999 --ctl '{c: select-proc, index: 0}'
vpx mprocs --server 127.0.0.1:2999 --ctl '{c: restart-proc}'
vpx mprocs --server 127.0.0.1:2999 --ctl '{c: quit}'
```

The web pane is index 0. Always specify the intended session's control
port. mprocs 0.9.6 must never be checked with an empty TCP connection: use its
valid control commands or inspect listener ownership. Startup checks bind and
release ports instead of connecting to existing control sockets.

The public package API exports `devCommand`; implementation modules use `#...`
imports. `_dev.ts` is executable and registered through `package.json`'s `bin`.
