# Inwards: working rules

Architecture linter for Python, written in TypeScript on Bun. Engine in
`src/core`, CLI in `src/cli`, VS Code extension in `src/vscode-extension`,
docs in `docs/` (Zensical). Backlog: `.claude/plan/backlog.yaml`, synced to
GitHub issues and milestones by `scripts/sync-backlog.py`.

Bun lives in `~/.bun/bin`; prefix `PATH` in non-interactive shells.

## Before every commit

```sh
bun x biome ci .        # lint + format, every rule group at error
bun run lint:docs       # oxlint + eslint-plugin-jsdoc: TSDoc on every function
bun run typecheck       # tsgo, strictest flags (tsconfig.base.json)
bun run fallow          # dead code, unused deps, boundaries, duplication
bun test                # unit + CLI + E2E snapshots
```

CI also runs `prescan-diff` (the prescan must never miss an import) and the
tests against the compiled binary on Linux, macOS and Windows.

## Code rules

- **Strict typing, no escape hatches** (tsc, Biome). No `any`, no non-null `!`,
  no `as` casts except at a trust boundary right after validation, with a
  `biome-ignore lint/nursery/noUnsafeTypeAssertion: <what was checked>`.
  Prefer `unknown` plus a type guard. Explicit types on every function.
  Rule exceptions live in `biome.jsonc`, each with its reason.
- **Every function is documented** (`lint:docs`) with a TSDoc block,
  including private helpers and arrow functions bound to a name:
  - first line: a title that says what it does;
  - then 1-3 lines of description (what, and why when it isn't obvious);
  - a longer section when the behaviour has edge cases, invariants or a
    non-obvious reason (see `importSkeleton` in `src/core/src/prescan.ts`);
  - `@param` for every parameter and `@returns` for every non-void return.
- **Ports and adapters where it pays.** The engine (`src/core`) is the
  hexagon: pure, no I/O, no `Bun`/`Deno`/`node:fs`. Anything it needs from outside comes through a port, an
  interface the core owns (`GrammarBinaries`, `SourceFile`), and adapters
  (CLI, LSP, tests) implement it. Adapters import `@inwards/core` only, never
  core internals (fallow boundaries in `.fallowrc.jsonc`; Biome bans Node,
  Bun and env access in `src/core/src`). Add a port only when a second
  adapter or a test needs it; one interface with one implementation and no
  test seam is just indirection.
- Machine output (JSON, SARIF, hook stderr) goes through
  `process.stdout/stderr.write`, never `console.*` (Bun colours
  `console.error` under `FORCE_COLOR`). Biome's noConsole enforces it outside
  scripts.
- Anything an agent reads is a contract: `inwards/diagnostics@1` fields are
  only ever added, and E2E snapshots (`bun test`) pin exit codes and output.

## Writing

Docs, commit messages and PR text in English, plain and specific (the
`humanizer` skill's rules): no filler, no em dashes, numbers over adjectives.
