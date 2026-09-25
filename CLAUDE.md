# Inwards: working rules

Architecture linter for Python, written in TypeScript on Bun. Engine in
`src/core`, CLI in `src/cli`, VS Code extension in `src/vscode-extension`,
docs in `docs/` (Zensical). Backlog: `.claude/plan/backlog.yaml`, synced to
GitHub issues and milestones by `scripts/sync-backlog.py`.

Bun lives in `~/.bun/bin`; prefix `PATH` in non-interactive shells.

## Before every commit

```sh
bun x biome ci .        # lint + format, zero warnings
bun run typecheck       # tsgo, strict
bun test                # unit + CLI + E2E snapshots
```

CI also runs `prescan-diff` (the prescan must never miss an import) and the
tests against the compiled binary on Linux, macOS and Windows.

## Code rules

- **Strict typing, no escape hatches.** No `any`, no non-null `!`, no `as`
  casts except at a trust boundary right after validation (parsed JSON, TOML,
  hook payloads), with a comment saying what was checked. Prefer `unknown`
  plus a type guard. Explicit return types on exported functions.
- **Every function is documented** with a TSDoc block, including private
  helpers and arrow functions bound to a name:
  - first line: a title that says what it does;
  - then 1-3 lines of description (what, and why when it isn't obvious);
  - a longer section when the behaviour has edge cases, invariants or a
    non-obvious reason (see `importSkeleton` in `src/core/src/prescan.ts`);
  - `@param` for every parameter and `@returns` for every non-void return.
- **Ports and adapters where it pays.** The engine (`src/core`) is the
  hexagon: pure, no I/O, no `Bun`/`Deno`/`node:fs` (Biome enforces the Bun
  and Deno half). Anything it needs from outside comes through a port, an
  interface the core owns (`GrammarBinaries`, `SourceFile`), and adapters
  (CLI, LSP, tests) implement it. Add a port only when a second adapter or a
  test needs it; one interface with one implementation and no test seam is
  just indirection.
- Machine output (JSON, SARIF, hook stderr) goes through
  `process.stdout/stderr.write`, never `console.*` (Bun colours
  `console.error` under `FORCE_COLOR`).
- Anything an agent reads is a contract: `inwards/diagnostics@1` fields are
  only ever added, and E2E snapshots pin exit codes and output.

## Writing

Docs, commit messages and PR text in English, plain and specific (the
`humanizer` skill's rules): no filler, no em dashes, numbers over adjectives.
