# `src/vscode-extension`: the editor adapter

This guide adds to the root [`AGENTS.md`](../../AGENTS.md); its checks and
rules still apply. Chapter 3 of the docs has the architecture in pictures.

The extension shows Inwards' diagnostics in VS Code, live. It is a thin
client: it starts `inwards server` (the CLI's language server,
`src/cli/src/lsp/`, ADR-041) over stdio and lets `vscode-languageclient` do
the rest. It has no engine and no server of its own (ADR-043), so what the
editor shows is changed in the CLI, never here.

## Folders

| Folder | Owns | Must not |
|---|---|---|
| `src/client/` | activation, settings and the restart command (`extension.ts`); which binary to start (`binary.ts`, pure); the documents it syncs (`selector.ts`) | import anything of ours, the engine included |
| `scripts/` | packaging one VSIX per platform with its binary (`package-target.ts`) | ship in the VSIX |
| `test/` | the binary lookup, the boundaries, and the packaged-artifact test with its small LSP client | ship in the VSIX |

## Dependency rules

The client imports `vscode`, `vscode-languageclient` and `node:*` only. fallow
enforces it (`vscode-client` and `vscode-dev` in `.fallowrc.jsonc`; a file in
a new `src/` folder matches no zone and fails until it gets one), and
`test/architecture.test.ts` checks the zones through `fallow guard` and that
`package.json` depends on `vscode-languageclient` alone.

## The shipped layout is a contract

- `bun run build` writes `dist/extension.js` (`package.json`'s `main`), with
  `vscode-languageclient` bundled and `vscode` external.
- `scripts/package-target.ts all <binaries> <out> <tag>` (cd.yml) writes one
  VSIX per VS Code platform in its `TARGETS`, each with that platform's
  release binary as `bin/inwards` (`bin/inwards.exe` on Windows) and its
  execute bit, plus a universal VSIX without a binary for every other
  platform. `vscode-publish.yml` uploads those same files.
- The client finds the binary in this order (`binary.ts`): `inwards.path`
  (never falling back when it is set but wrong), the bundled `bin/`, then
  `inwards` on PATH. Nothing found is an error message with buttons to the
  setting and the install guide, not a crash.
- `inwards.path` is a restricted setting (`capabilities.untrustedWorkspaces`):
  in an untrusted workspace VS Code returns only the user's value, so a cloned
  repository can't pick the program the extension starts.
- `test/packaged.test.ts` builds, packages this machine's platform VSIX and
  the universal one, unpacks them, checks what ships (and that tests, sources
  and guides don't), and drives the bundled binary over LSP until it reports a
  violation. It bundles `INWARDS_BIN` when set (CI's compiled binary), else a
  binary compiled from source. It deletes `dist/` when done.

## Where new code goes

- **What the editor shows.** In the CLI's server (`src/cli/src/lsp/`), with
  its tests there.
- **A new setting.** Declare it in `package.json` under
  `contributes.configuration`, read it in `extension.ts` (a change to any
  `inwards.*` setting restarts the server), and document it in the install
  guide (`docs/chapters/guides/install.md`, "VS Code"), EN and PL. A setting
  that names a program or a path to run goes in `restrictedConfigurations`.
- **A new platform.** A binary in `scripts/build-binaries.ts`, its VS Code
  target in `TARGETS`, a row in cd.yml's verify matrix, and the VSIX count
  in `vscode-publish.yml`.

## Traps

- **Node can't spawn a `.cmd` or `.bat` without a shell**, so on Windows the
  lookup accepts `inwards.exe` only.
- **Keep the package guides and tests out of the VSIX** (`.vscodeignore`).
- **The Marketplace and Open VSX take X.Y.Z only.** Release candidates are
  never published there; their VSIX already carries the final version.

## Local feedback

```sh
bun test src/vscode-extension       # the extension's tests (from the repo root)
bun run --cwd src/vscode-extension build
bun run check:cycles && bun run check:overviews
```

The root checks (Biome, `lint:docs`, typecheck, fallow and the docs checks)
are still required before a commit and a push.
