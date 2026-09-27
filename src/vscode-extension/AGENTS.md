# `src/vscode-extension`: the editor adapter

This guide adds to the root [`AGENTS.md`](../../AGENTS.md); its checks and
rules still apply. Chapter 3 of the docs has the architecture in pictures.

The extension shows Inwards' diagnostics in VS Code, live, with the same
engine as `inwards check`. It is two programs in two processes: a thin
client that VS Code loads, and a language server (LSP) that wraps
`@inwards/core`. Both run on Node, bundled to CommonJS.

## Folders

| Folder | Owns | Must not |
|---|---|---|
| `src/client/` | activation (`extension.ts`): starting and stopping the server over IPC; the documents it syncs (`selector.ts`) | import the engine or the server |
| `src/server/` | the language server (`server.ts`), the workspace pass and the index's files (`workspace.ts`), reading pyproject.toml (`config-file.ts`) | import the client or anything but `@inwards/core` of ours |
| `scripts/` | build helpers (`copy-wasm.ts`) | ship in the VSIX |
| `test/` | the LSP harness, server and config tests, the packaged-artifact smoke test | ship in the VSIX |

## Dependency rules

The client imports `vscode` and `vscode-languageclient` only; the server
imports `vscode-languageserver` and the engine through `@inwards/core`.
They share nothing but the protocol. fallow enforces it (`vscode-client`,
`vscode-server` and `vscode-dev` in `.fallowrc.jsonc`; a file in a new `src/`
folder matches no zone and fails until it gets one), `test/architecture.test.ts`
checks the zones through `fallow guard`, and `bun run check:cycles` covers
this package too. Both sides are runtime
adapters, so `node:*` modules are allowed here.

## The shipped layout is a contract

- `bun run build` writes `dist/extension.js` (`package.json`'s `main`),
  `dist/server.js` (the client's `asAbsolutePath("dist/server.js")`) and both
  grammars beside `server.js`. The build names its entries explicitly
  (`--entry-naming [name].[ext]`); without that, Bun would write
  `dist/client/` and `dist/server/`.
- The server finds the grammars next to the running script
  (`process.argv[1]`), not through `__dirname`, which Bun's bundler fixes at
  build time to the build machine's directory.
- `vscode` is external: VS Code provides it at run time.
- `test/packaged.test.ts` runs the real build and starts the shipped server
  on Node. The other LSP tests bundle the server themselves, so only that
  test catches a broken package.

## State that lives as long as the server

The server keeps the engine, the module index, the diagnostics per file,
its file watchers and a 100 ms debounce for as long as it runs. Config
reloads and workspace passes run one after another through `enqueue`, so a
reload can never interleave with a pass. Without watched-file support in the
client, every check builds a fresh index and saves of pyproject.toml re-read
the config. These are deliberate; don't make them per request.

## Where new code goes

- **A new diagnostic source.** Engine logic goes in `src/core`; the server
  only decides when to run it (on open and change, or in the workspace pass
  for files nobody opened).
- **A new setting.** Declare it in `package.json` under
  `contributes.configuration`, read it in the server, and document it in the
  install guide (`docs/chapters/guides/install.md`), EN and PL.
- **A new file the server reads.** Keep it in `server/`, treat an unreadable
  file as an error rather than a missing one (#163), and add a test with the
  harness.

## Traps that already cost review rounds

- **An unreadable pyproject.toml is a config error**, never "no config",
  which would silently turn the checks off (#163).
- **Watcher fallback.** A client without `didChangeWatchedFiles` gets no file
  events: never keep an index across checks then.
- **Serialized reloads.** A new async step that touches `state` goes through
  `enqueue`, or a slow reload can publish stale findings over fresh ones.
- **Keep the package guides and tests out of the VSIX** (`.vscodeignore`).

## Local feedback

```sh
bun test src/vscode-extension       # the extension's tests (from the repo root)
bun run --cwd src/vscode-extension build
bun run check:cycles && bun run check:overviews
```

The root checks (Biome, `lint:docs`, typecheck, fallow, the docs checks and
`act`) are still required before a commit and a push.
