# `src/cli`: the command line and the Claude Code hook adapter

This guide adds to the root [`AGENTS.md`](../../AGENTS.md); its checks and
rules still apply. Chapter 3 of the docs has the architecture in pictures.

The CLI is an adapter around the engine (`@inwards/core`): it reads files,
runs git, talks to Claude Code through hooks, and writes the session record
and the run log. The engine decides; the CLI feeds it and acts on its answer.

## Folders

| Folder | Owns | Must not |
|---|---|---|
| `main.ts` | argv parsing, picking a command, the process lifecycle | hold logic a test would want to call |
| `commands/` | one module per command (`check`, `baseline`, `stats`, `hook`) | import `adapters/` |
| `claude-code/` | the hook adapter: `dispatch`, `session-start`, `config-guard` (with `shell-reader` and `edit-simulation`), `post-tool-use`, `stop-gate` and `changed-files`, `escalation`, `settings`, and `protocol` (shared by all of them) | read the environment or the filesystem itself |
| `session/` | the session record, start identity and start content, old errors (#134), agent suppressions (#50), layout changes | read files or run git itself |
| `project/` | running a check, the baseline, config discovery, project snapshots | own a filesystem walk (that is `adapters/file-walk.ts`) |
| `runlog/` | the run log, reading it back, stats, `--export` | keep notes in a module global |
| `init/` | `inwards init`: agent wiring, `--style`, the scaffold plan, the report, presets | write files itself (`InitFiles` does) |
| `paths/` | path text (`lexical`), the physical meaning of `..` (`physical`), display paths (`display`) | feed a display path into an identity check |
| `platform/` | the contracts for everything outside the process, and `print()` | implement any of them |
| `json/` | type guards for parsed JSON and TOML | import anything |
| `adapters/` | `node:fs`, git, the environment, stdio, state/baseline/export/init files, the grammars, the picker, TOML; `compose.ts` wires them into `AppDeps` | hold policy |

## Dependency rules

Everything below `main.ts` receives what it touches as parameters: the
`Platform` bundle (`probe`, `read`, `walk`, `git`, `clock`, `runtime`,
`streams`, `state`), feature contracts (`BaselineWriter`, `ExportFiles`,
`InitFiles`, `Picker`), and a bound `CheckRunner`. Functions take the
narrowest `Pick<>` they need, so a signature says what it touches.

Imports go downwards only: `platform`, `json` and `paths` are leaves, then
`project`, then `session`, then `runlog`, then `claude-code` and `init`,
then `commands`. Only `main.ts` imports `adapters/`. `eval/` may import
`claude-code/protocol.ts` and nothing else.

Enforced by:

- **fallow zones** (`.fallowrc.jsonc`): one zone per folder with its allowed
  edges. A file in a new folder matches no zone, and fallow fails
  (`requireAllFiles`) until the folder gets a zone and rules.
- **Biome** (`biome.jsonc`): the policy folders can't import `node:fs`,
  `node:child_process`, `node:os`, `node:process`, `node:readline`, the
  network modules (`node:http`, `node:https`, `node:net`, `node:dns`, ...)
  or `node:perf_hooks`, subpaths included (`node:fs/promises`,
  `node:dns/promises`), nor use the `Bun`, `process`, `fetch` or
  `performance` globals. The `no-direct-clock` GritQL plugin rejects any
  use of `Date` that reads the clock, aliases included (`Date.now`, `Date()`,
  `new Date()`, `const D = Date`): take the time from `Clock`. `node:path`,
  `node:crypto`, `Date.parse`, `new Date(value)` and the `Date` type are
  fine; they are pure.
- **`bun run check:cycles`**: no import cycles, type imports included. It
  asks the pinned TypeScript (tsgo) for the syntax tree and the resolved
  modules, so comments can't hide an edge and extensionless imports count.
- **`test/integration/architecture.test.ts`**: probes all of the above by
  behaviour.

When a change seems to need a new edge, don't add it to the rules first.
Move the shared piece down to the lower folder, or pass it in as a
parameter. If the edge is really right, change the rule in its own commit
and say why in the PR.

A relative path from the command line (`--config`, check targets,
`stats DIR`, `--export FILE`) is resolved against `Runtime.cwd`, never with a
bare `resolve(p)`, which would read the process's working directory behind
the contract's back.

## State lifetimes

The CLI runs one command per process, but tests and future callers may run
several invocations in one process. Mutable state is made per invocation:

- `createStartLookups` for start identity and start content caches (shared by
  the suppression and old-error checks of one hook run);
- `createRunLog` for what the handlers noted.

A module-level `Map` or array that grows at run time is a bug.

## Where new code goes

- **A new rule.** Rules live in the engine (`src/core`). The CLI only needs
  a change when the rule needs new project input: add it to `ProjectIo`
  (`project/contracts.ts`), implement it in an adapter, and wire it in
  `adapters/compose.ts`.
- **A new hook event.** Add a handler module in `claude-code/`, route to it
  in `dispatch.ts`, take `HookDeps`, and add E2E fixtures in
  `test/support/fixtures/claude-code` with a case in
  `test/integration/e2e.test.ts`.
- **A new CLI command.** Add a module to `commands/` that takes `AppDeps`,
  route to it in `main.ts`, and add its usage line to `USAGE`.
- **A new config key.** The engine parses config (`src/core`). The CLI's
  config guard protects the whole `[tool.inwards]` table, so a key needs no
  guard change, but add a guard test that an edit of it is denied.
- **A new outside capability** (a new kind of file, a subprocess). Add a
  narrow contract (in `platform/contracts.ts` when several features use it,
  else in the feature's `contracts.ts`), an adapter for it, and wire it in
  `compose.ts`. Pass plain values instead when a single value is enough.
- **Docs.** Any change the user can see updates the English docs and
  `docs/pl` in the same PR (root `AGENTS.md`, "Polish docs").

## Traps that already cost review rounds

- **Identity paths vs display paths** (#165, #171, #175). `session/start-identity.ts`
  decides which file a path named at session start. A file has an identity
  only when its path as written equals its physical path and it isn't a
  symlink. Display helpers (`paths/display.ts`) respell paths for people;
  never feed their output into an identity check, or symlink aliases can
  borrow another file's suppressions and excuses again.
- **Start content comes from git without running anything the agent set up.**
  Only `cat-file blob` with `--no-lazy-fetch`, never `--filters` or
  `--textconv`, and `adapters/git.ts` turns off fsmonitor and hooks.
- **Escalation ordering is policy.** PostToolUse computes escalation before
  recording the edit, old and context findings don't count, and Stop counts
  fresh and continuing turns differently. Don't hide it in a wrapper.
- **Fail closed.** No start record, a changed `[tool.inwards]`, a config
  that appeared mid-session, or missing hooks all block at Stop. A filesystem
  observation that fails answers "not there", which means "no start
  identity", never "unchanged".
- **Hook stdin is read synchronously** (`adapters/stdio.ts`): awaiting stdin in
  the Windows binary lost violations.
- **Temp directories in tests** go through `test/support/temp.ts`, and
  `bun test` runs from the repo root so the preload removes them.

## Local feedback

```sh
bun test src/cli                    # the CLI's tests (from the repo root)
bun test src/cli/test/claude-code   # one folder
bun run check:cycles && bun run check:overviews
```

The root checks (Biome, `lint:docs`, typecheck, fallow, the docs checks and
`act`) are still required before a commit and a push.
