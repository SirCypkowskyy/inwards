# `src/core`: the engine

This guide adds to the root [`AGENTS.md`](../../AGENTS.md); its checks and
rules still apply. Chapter 3 of the docs has the architecture in pictures.

The engine (`@inwards/core`) turns Python source and `[tool.inwards]` text
into diagnostics. It does no I/O at all: adapters (the CLI, the hook, the
language server, the tests) hand it bytes, text and small ports, and do
everything else. It runs on Bun in the CLI and on Node inside VS Code, so it
can't lean on either runtime.

## Folders

| Folder | Owns | Must not |
|---|---|---|
| `index.ts` | the public API, the only module adapters import | export anything by accident (`test/api.test.ts` pins the list) |
| `contracts/` | the records the engine and adapters exchange (`records.ts`) | hold behaviour or import anything |
| `meta/` | product metadata (`product.ts`), the rule registry and `diagnostic()` (`registry.ts`) | know about config or rules' logic |
| `config/` | parsing `[tool.inwards]`: layers, rule settings, shapes, `generated`, globs, source spans | read files (it gets the text) |
| `python/` | tree-sitter parsing, import extraction, module names, the prescan, PEP 263 encodings, literals, stdlib names | know about layers or rules |
| `lookup/` | the module index (`ProjectIndex`), module lookup, the directory-listing ports | decide what is a violation |
| `rules/` | one module or folder per rule, named after the rule; `shared/` for what several rules need | import another rule |
| `baseline/` | baseline keys and which modules a baseline accepts in full | render or write anything |
| `engine/` | the facade: order of the checks, rule precedence, suppressions, the baseline shortcut | hold a rule's logic |
| `report/` | text, concise, JSON and SARIF rendering | decide severities or filter findings |

## Dependency rules

Imports go downwards: `contracts`, then `meta`, then `config`; `python` (on
`contracts`) and `lookup` (on `python`) beside it; then `rules/shared`, then
each rule; then `baseline`, `engine` and `report`. `index.ts` may re-export
any of them. Nothing in core imports the CLI, the extension, tests or
scripts.

Enforced by:

- **fallow zones** (`.fallowrc.jsonc`): one zone per folder and one per
  rule, with explicit edges. Rules may use `rules/shared` and the folders
  below it, never each other. A file in a new folder matches no zone, and
  fallow fails (`requireAllFiles`) until the folder gets a zone and rules.
  The forbidden-call list (`Bun.*`, `process.*`, `fs.*`, `console.*`, ...)
  covers every core zone. fallow judges an adapter's import of
  `@inwards/core` by the zone of the module behind `index.ts`, so the
  adapter zones allow every zone `index.ts` re-exports from; when `index.ts`
  starts re-exporting from another zone, add it to those lists. The rule
  pack `.fallow-core-api.jsonc` refuses an adapter's direct import of a
  module under `src/core/src/`.
- **Biome** (`biome.jsonc`): no Node or Bun modules, no `process.env`, and
  no `process`, `Bun`, `Deno`, `fetch`, `performance`, `Date`, `globalThis`,
  `global` or `Function` globals: the engine reads no clock and reaches
  nothing through the global object.
- **`bun run check:cycles`**: no import cycles, type imports included.
- **`src/core/test/architecture.test.ts`** and **`api.test.ts`**: probe the
  above by behaviour (the zones through `fallow guard`, so they test what
  fallow actually applies), and pin every public export, types included.

When a change seems to need a new edge, move the shared piece down (into
`rules/shared/`, `lookup/` or `python/`) rather than widening a rule's zone.

## Lifetimes that are deliberate

- **The grammar loads once per process** (`python/parser.ts`).
  `Parser.init` sets up a global WASM module, so concurrent loads race; a
  failed load clears the promise so the next call retries.
- **Every tree is freed** with `tree.delete()` in a `finally`: WASM memory
  isn't garbage collected.
- **`ProjectIndex` caches** what it has listed, probed and read, and never
  sees later changes. Building one is free; a long-lived adapter builds a new
  one when files are created, deleted or renamed, and on saves too if it
  relies on `importersOf` or `extendsPath` (an edited `__init__.py` can start
  or stop extending its package's path).

## Where new code goes

- **A new rule.** Add its entry to `meta/registry.ts`; write it in
  `rules/<rule-name>.ts` (or a folder when it has parts) using only
  `rules/shared/` and the lower folders; call it from `engine/engine.ts` and
  decide its precedence there; give it a zone and edges in `.fallowrc.jsonc`;
  add `test/rules/<rule-name>.test.ts`; add its page to
  `docs/chapters/rules/` and `docs/pl/rules/` with `resource:` pointing at the
  module, and a row in the rule catalogue.
- **A new config key.** Parse and validate it in `config/` (unknown keys
  already fail), add it to `InwardsConfig`, cover it in `test/config/`, and
  document it where the other keys are (chapter 1's configuration section,
  and the guide for the feature it serves), EN and PL.
- **A new project input.** Add a narrow port (a function type, like
  `ListDir`) in `lookup/` or `contracts/`, take it through `ProjectFiles` or a
  parameter, and implement it in every adapter.

## Traps that already cost review rounds

- **Core stays I/O-free.** No `node:*`, no `Bun`, no `process`, no
  `console`. The grammars come in as bytes (`GrammarBinaries`).
- **Prescan soundness.** `python/prescan.ts` must never miss an import: it
  returns null (full parse) whenever `import` shows up somewhere it can't
  account for. `src/core/scripts/prescan-diff.ts` checks it against the full
  parse on the stdlib and a generated corpus; keep it at 0 misses.
- **Rule precedence lives in the engine.** An outward import gets INW001
  alone; a missing module gets INW010, not INW006 as well. Don't make a rule
  filter another rule's findings.
- **The baseline shortcut.** `baseline/accepted.ts` lets the engine skip the
  confirming parse when a baseline accepts every skeleton finding of a
  module. A change to how findings are keyed must keep that answer exact.
- **INW000, INW007, INW008 and INW009 can't be suppressed inline**, and
  INW000 can't be turned off by `[tool.inwards.rules]` (ADR-027).
- **The public API is a contract.** Adding or renaming an export in
  `index.ts` is a deliberate change: update `test/api.test.ts` in the same
  commit.

## Local feedback

```sh
bun test src/core                  # the engine's tests (from the repo root)
bun test src/core/test/rules       # one folder
bun run src/core/scripts/prescan-diff.ts   # prescan vs full parse
bun run check:cycles && bun run check:overviews
```

The root checks (Biome, `lint:docs`, typecheck, fallow, the docs checks and
`act`) are still required before a commit and a push.
