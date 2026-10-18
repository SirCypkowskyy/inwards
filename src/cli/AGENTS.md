# `src/cli`: the command line and the Claude Code hook adapter

This guide adds to the root [`AGENTS.md`](../../AGENTS.md); its checks and
rules still apply. Chapter 3 of the docs has the architecture in pictures.

The CLI is an adapter around the engine (`@inwards/core`): it reads files,
runs git, talks to Claude Code through hooks, and writes the session record
and the run log. The engine decides; the CLI feeds it and acts on its answer.

## Folders

| Folder | Owns | Must not |
|---|---|---|
| `main.ts` | argv parsing, picking a command, the process lifecycle; on a worker thread it runs `serveExtractions` instead (ADR-040) | hold logic a test would want to call |
| `commands/` | `usage` for the help text, and `deps` (`AppDeps`, `DaemonDeps`); every command is a slice's `cli.ts` now, and `commands/` goes in step 14 | import `adapters/` |
| `hook/` | an ADR-047 slice: `index.ts` its face (`hookClaudeCode`), `cli.ts` the `inwards hook claude-code` handler, `contracts.ts` (`HookDeps`, `hookProject`, `ASK_USER`, and the session record's shapes `Start`, `SessionStart`, `Check`; the eval may import this module and nothing else), `adapters/state-files.ts` for the session and run-log state on disk. Three mini-domains, each with its `index.ts`. `claude-code/` is the hook adapter (`_dispatch`, `_session-start`, `_config-guard` with `_shell-reader` and `_edit-simulation`, `_shape-guard`, `_post-tool-use`, `_stop-gate` and `_changed-files`, `_escalation`, `_settings` and `_hook-host` (whether the agent still has Inwards wired in)); its `index.ts` re-exports `dispatch` and the pieces `init/` reads. `session/` splits into `commands/` (the session record `_record`, the start record with its witness `_start-record` (#88), the copies of dirty files `_start-copies`, start identity `_start-identity`) and `queries/` (old errors #134, agent suppressions #50, layout changes, the committed-config check, start content, the per-invocation `_lookups`); `session/index.ts` re-exports both for `claude-code/`. `daemon/` is the hook daemon's side of ADR-039 (#429), a third mini-domain: `index.ts` re-exports the `inwards-daemon/1` wire format and the daemon's file names (`_protocol`), the hook's side (`viaDaemon` and `askDaemon` in `_client`), the request handler (`_server`) and the caches kept between requests (`_memory`); `contracts.ts` holds `DaemonLink` and `DaemonHost`; `cli.ts` is the `inwards daemon` handler (was `commands/daemon.ts`), which `hook/index.ts` re-exports, not `daemon/index.ts`. `adapters/daemon-link.ts`, `daemon-host.ts`, `daemon-loop.ts` and `daemon-files.ts` are the socket, the lock and the record | read files or run git itself (`session/` and `claude-code/`), or re-export `adapters/` from `index.ts`; let `session/commands/` import `queries/`; do I/O in `daemon/` (the socket, the record and the lock are `adapters/daemon-*.ts`) |
| `check/` | an ADR-047 slice, formerly `project/`: `index.ts` its face (`checkCommand`, `baselineCommand`, `runCheck`, `runPlan`, `planCheck`, config discovery, the project snapshot, `overlayTexts`, `fingerprint`, and the diagram and baseline helpers the other slices read), `cli.ts` the `inwards check` and `inwards baseline` handlers, `contracts.ts` (`CheckRunner`, `CheckDeps`, `CheckRunNotes`, `BaselineWriter`, `ExtractionPool`, `ProjectIo`), and private modules for running a check (`_check`), which files it reads and under which module names, then reading them (`_sources`: one batch from 1,000 files, #281), config discovery and routing (`_config-discovery`, `_routing`, uv workspace members in `_workspace`), a check over several configs (`_runs`), project snapshots (`_snapshot`), layer-package symlinks (`_links`), virtualenv site-packages (`_site-packages`), hiding modules added since the start (`_absent`), how many threads parse a full check (`_threads`, ADR-040), texts laid over the disk for one check, files not yet written included (`_overlay`, for `inwards mcp`), the files `_diagrams` names, violation fingerprints (`_fingerprint`, shared by the session record, escalation and the run log), and the checks only a whole-project run makes (`_whole`). `baseline/` is a mini-domain (its `index.ts` and `_file.ts`: the baseline file's name, reader, writer and hashes) that `_check.ts` reads, so `inwards baseline` stays in `cli.ts`. `adapters/` holds `baseline-files.ts` and the extraction cache, store, entry, pool and worker (`extraction-*`) | own a filesystem walk (that is `adapters/file-walk.ts`) or start a thread outside `check/adapters/extraction-pool.ts`; import `runlog/` (`CheckRunNotes` stands in for the run log), or re-export an adapter from `index.ts` |
| `runlog/` | an ADR-047 slice: `index.ts` its face (`statsCommand`, `createRunLog`, `RunLog`, and the readers the tests use), `cli.ts` the `inwards stats` handler, `contracts.ts` (`ExportFiles`, `StatsDeps`), `commands/` writing the run log (`_record`), `queries/` reading it back (`_runs`), the numbers (`_stats`) and `--export` (`_export`), and `adapters/export-files.ts` for the export key and file | keep notes in a module global, or let `queries/` import `commands/` |
| `init/` | an ADR-047 slice: `index.ts` its face (the five handlers and `STYLE_NAMES` for the help text), `cli.ts` the `inwards init` handler, `contracts.ts` (`InitDeps`, `InitFiles`, `Picker`, `InitFlags`), and private modules for agent wiring (`_claude` with its `.mcp.json` in `_mcp-json`, `_opencode`, `_agents`), `--style auto`'s name table and command (`_auto`, `_auto-command`), the scaffold plan, the report, presets and the text their templates add (`_template-text`), marked sections in Markdown files (`_section`) and appending an imported table (`_append-table`). Three mini-domains, each with its `index.ts` and `cli.ts`: `brief/` (the architecture brief for `--brief` and `inwards context`, with its opt-in rules part), `diagram/` (`inwards diagram`, and `inwards import-diagram` with the table a read diagram becomes) and `import-linter/` (`inwards import-config`). `adapters/files.ts` writes, `adapters/picker.ts` asks on a terminal and loads `@clack/prompts` with a dynamic `import()` | write files itself (`InitFiles` does), or re-export an adapter from `index.ts` |
| `rules/` | an ADR-047 slice: `index.ts` its face (`rulesCommand`, `ruleCommand`), `cli.ts` the `inwards rules` and `inwards rule` handlers, `_sources.ts` which config key turns each rule on, `page/` the rule-page reader (`readRulePage`, `RulePage`) with its own `index.ts`, and `adapters/pages.ts` embedding the English rule pages as text | import the SDK, or re-export `adapters/pages.ts` from `index.ts` |
| `paths/` | path text (`lexical`), the physical meaning of `..` (`physical`), display paths (`display`) | feed a display path into an identity check |
| `lsp/` | the language server slice (`inwards server`, ADR-041), the first one in the ADR-047 layout: the `server` handler (`cli`, re-exported by `index`), when to run a whole pass or a one-document check (`_session`), the two checks through `planCheck` and `runCheck` (`_checks`), what each file shows (`_publish`), which file events matter (`_events`), the `Editor`, `LanguageServer` and `ServerCheck` contracts, and the LSP connection over stdio (`adapters/connection`) | import the protocol library or touch a stream outside `lsp/adapters/` |
| `mcp/` | the MCP server slice (`inwards mcp`, ADR-042) in the ADR-047 layout: the `mcp` handler (`cli`), re-exported by `index` with `explainRule` for `inwards rules`, the three tools (`_check-files`, `_explain-rule` with `_rule-page`, `_where` with `_where-answer` and `_hints`), their arguments and answers and the `RulePages` type (`contracts`), running them one at a time (`_tools`), and the MCP connection over stdio with the SDK and Zod (`adapters/connection`) | import the SDK or Zod, or touch a stream, outside `mcp/adapters/` |
| `platform/` | the contracts for everything outside the process, `print()`, and `time.ts`, the one place that may name `Date` to parse a recorded timestamp | implement any of them |
| `json/` | type guards for parsed JSON and TOML | import anything |
| `adapters/` | `node:fs`, git, the environment, stdio, state files, the grammars, TOML, `compose.ts` wires them into `AppDeps` | hold policy |

## Dependency rules

Everything below `main.ts` receives what it touches as parameters: the
`Platform` bundle (`probe`, `read`, `walk`, `git`, `clock`, `runtime`,
`streams`, `state`), feature contracts (`BaselineWriter`, `ExportFiles`,
`InitFiles`, `Picker`), and a bound `CheckRunner`. Functions take the
narrowest `Pick<>` they need, so a signature says what it touches.

Imports go downwards only: `platform`, `json` and `paths` are leaves, then
`check`, then `runlog` (`runlog/` reads `check/`, and `check/` takes a run log through its own `CheckRunNotes`), then
`hook` and `init`, then `commands`. `hook/daemon/` (a mini-domain of `hook/`) imports
only `platform` and `json` (and the engine's API), except its `cli.ts`, which also
reads `hook/cli.ts` and `commands/deps.ts`; `hook/cli.ts`, `commands/deps.ts`,
`adapters/compose.ts` and the `hook/adapters/daemon-*` files use `daemon/index.ts`
and `daemon/contracts.ts`. `lsp/` sits beside it too and imports `platform`,
`json`, `paths` and `check` (for `planCheck`), and `commands/deps.ts` for
`AppDeps` until step 14 moves it to the root; `main.ts` imports its
`index.ts`, `commands/deps.ts` and `adapters/compose.ts` its `contracts.ts`. `mcp/` sits beside them with the same
imports as `lsp/`, plus `check/index.ts` for `runPlan`; `main.ts` and
`rules/cli.ts` import its `index.ts`, `commands/deps.ts` and
`adapters/compose.ts` its `contracts.ts`, and `compose.ts` loads
`mcp/adapters/connection.ts` with a dynamic `import()`, so the SDK and Zod
stay in a chunk only `inwards mcp` reads. Only the root (`main.ts`, and `adapters/compose.ts` until it moves up)
imports `adapters/` or a slice's `adapters/`. `init/`'s handlers take `AppDeps`
from `commands/deps.ts` too, until step 14, and `commands/usage.ts` reads
`STYLE_NAMES` and `AGENTS` from `init/`. `rules/` imports `platform`, `json`, `check`, `commands/deps.ts` and `mcp/index.ts` (for `explainRule`); `mcp/` reads the page reader through `rules/page/index.ts`, not `rules/index.ts`, which would close a cycle; `main.ts` imports `rules/index.ts` and `compose.ts` loads `rules/adapters/pages.ts` with a dynamic `import()`. `hook/` imports `platform`, `json`, `paths`, `check`, `runlog` and `daemon/` (`cli.ts` forwards PostToolUse through `daemon/index.ts`); `commands/deps.ts` reads `hook/contracts.ts`, `main.ts` imports `hook/index.ts`, `init/` reads `hook/claude-code/index.ts` and `compose.ts` loads `hook/adapters/state-files.ts`. `eval/` may
import `hook/contracts.ts` and nothing else.

Enforced by:

- **fallow zones** (`.fallowrc.jsonc`): one zone per folder with its allowed
  edges. A file in a new folder matches no zone, and fallow fails
  (`requireAllFiles`) until the folder gets a zone and rules.
- **Biome** (`biome.jsonc`): the policy folders can't import `node:fs`,
  `node:child_process`, `node:os`, `node:process`, `node:readline`, the
  network modules (`node:http`, `node:https`, `node:net`, `node:dns`, ...)
  or `node:perf_hooks`, subpaths included (`node:fs/promises`,
  `node:dns/promises`), nor use the `Bun`, `process`, `fetch`,
  `performance`, `Date`, `globalThis`, `global` or `Function` globals. Take
  the time from `Clock` (an ISO string), and parse a recorded timestamp with
  `platform/time.ts`, the one place allowed to name `Date`. `node:path` and
  `node:crypto` are fine; they are pure.
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

## Slice names (ADR-047)

The CLI is moving to vertical slices one step at a time (ADR-047 in chapter
5 has the target map and the 15 steps). Until a folder's step lands, it
keeps the layout above. A migrated slice holds only these names:

- `index.ts`: the slice's public face, re-exports only; it never re-exports
  an adapter.
- `_name.ts`: private to the folder it sits in.
- `contracts.ts`: the ports and records the slice owns.
- `cli.ts`: the slice's `inwards <command>` handlers, which replace
  `commands/`.
- `adapters/`: the slice's I/O; only the root (`main.ts`, later `compose.ts`)
  imports it.
- `*.d.ts` typings, and subfolders (mini-domains) with their own `index.ts`.

Biome enforces two of these already. The policy override covers
`src/cli/src/**` except the root's own `*.ts` and every `adapters/` folder,
so a new folder gets the I/O ban without being listed. In the same override
`noRestrictedImports` refuses another folder's `_x.ts`: `./_x.ts` and
`../_x.ts` pass, `../check/_x.ts` and `./session/_x.ts` fail. Biome doesn't
merge one rule's options across overrides, so a new override that sets
`noRestrictedImports` on policy files repeats the pattern. `noBarrelFile`
is off for every `index.ts`. `test/integration/architecture.test.ts` probes
both, and its `MIGRATED_SLICES` list holds the folders the naming check
walks: a move PR adds its folder there.

`lsp/` moved first (#418), then `mcp/` (#419), and later steps copy them (`hook/`, #428, and `check/`, #427, are described below; `rules/`, #420, is the third mini-domain case: `page/` exists so `mcp/` can import the page reader without a cycle):

1. Move the files and rewrite the imports with
   `bun run scripts/move-slice.ts OLD=NEW...` (repo-relative paths). It runs
   `git mv`, so history follows, and it only rewrites a specifier that no
   longer resolves, so it can run again. After a rebase, take the base's
   version of a conflicting file and rerun the same command from the PR
   description. Paths in comments, docs and test probes are fixed by hand.
2. Give the slice an `index.ts` that re-exports its `cli.ts` handlers;
   `main.ts` imports that. A type the root wires (`ServerCheck`, `RulePages`) goes in
   `contracts.ts`, which `commands/deps.ts` and `adapters/compose.ts` import
   directly: through `index.ts` the type import would close a cycle
   (`index.ts`, `cli.ts`, `deps.ts`, `index.ts`) that `check:cycles` refuses.
3. In `.fallowrc.jsonc`, add `cli-<slice>-adapters` before `cli-<slice>`,
   allowing the engine, `platform`, `json`, `paths` and its own slice, and
   add it to `cli-main`'s list only. `cli-main` is the root zone and holds
   `adapters/compose.ts` until step 14. The architecture test checks that
   only `cli-main` allows an adapters zone, besides `cli-test` when a test
   drives the real adapter (`test/support/mcp-client.ts`).
4. Add the folder to `MIGRATED_SLICES`.

`runlog/` (#421) followed these steps with two differences. Its `cli.ts`
takes `StatsDeps` from its own `contracts.ts` instead of `AppDeps`, so the
slice never imports `commands/deps.ts` and `index.ts` can re-export both the
handler and `RunLog`. And it splits into `commands/` (writing the log) and
`queries/` (reading it back), each a mini-domain with its own `index.ts`.

`init/` (#425) has five handlers. `inwards init` is `cli.ts`; the other four
live in three mini-domains, each with its own `cli.ts` and `index.ts`:
`brief/` (`context`), `diagram/` (`diagram` and `import-diagram`) and
`import-linter/` (`import-config`). `init/index.ts` re-exports all five for
`main.ts`. A private module reaches a mini-domain through its `index.ts`
(`./brief/index.ts`), and a mini-domain reaches the slice's private modules
with `../_x.ts`. `adapters/picker.ts` still loads `@clack/prompts` with a
dynamic `import()`, so the prompt library stays in its own chunk.

`check/` (#427) replaced `project/` and took `inwards check`, `inwards baseline`,
`check-runs`, `CheckRunner` (from `session/contracts.ts`) and the
`baseline-files` and `extraction-*` adapters. Two things differ from the
issue text, both to keep `check:cycles` green:

- `cli.ts` takes `CheckDeps` from the slice's own `contracts.ts`, not
  `AppDeps`, and the run log comes in as `CheckRunNotes`, a structural
  stand-in for `RunLog`. `runlog/commands/_record.ts` imports `check/index.ts`
  (fingerprints, config discovery), so a `check/` that imported `runlog/` or
  `commands/deps.ts` (which reaches `runlog/` through `HookDeps`) would close a
  cycle. `AppDeps` satisfies `CheckDeps` as it is.
- `inwards baseline` lives in `cli.ts` next to `inwards check`, and the
  baseline file's reader and writer are the `baseline/` mini-domain with its own
  `index.ts` (no `cli.ts`). `_check.ts` reads the file through
  `baseline/index.ts`; a `baseline/cli.ts` that imported `_check.ts` would have
  made `baseline/index.ts` and `_check.ts` a cycle.

`hook/` (#428) took `claude-code/`, `session/`, `commands/hook.ts` and
`adapters/state-files.ts`; `claude-code/protocol.ts` became `contracts.ts`, which the eval
and `commands/deps.ts` import directly. The move script's command is in the PR description
(`move-slice.ts` with one `OLD=NEW` per module), so a rebase reruns it. Differences from the
issue text:

- `session/contracts.ts` is not a file of its own: its shapes (`Start`,
  `SessionStart`, `Check`) live in `hook/contracts.ts`, because both mini-domains use them
  and a shared type file inside `session/` would make `claude-code/` import its private module.
- `session/` splits by direction, not by the old file names. `commands/` holds what writes
  or derives the start (record, start record, copies, start identity); `queries/` holds
  what asks about it and imports `commands/index.ts`, never the other way, so
  `check:cycles` stays green (`lookups` needs the copies and the identity; the copies need
  the identity, so identity sits with `commands/`).
- `cli.ts` takes `HookDeps` plus a `DaemonLink` from `daemon/contracts.ts`, not `AppDeps`
  from `commands/deps.ts`, which already imports `hook/contracts.ts`: through `AppDeps` the
  slice and `commands/` would close a cycle. `AppDeps` satisfies the parameter as it is.

`hook/daemon/` (#429) took `daemon/`, `commands/daemon.ts` and the `daemon-*` adapters
(`hook/adapters/`). The wire format (`inwards-daemon/1`) and the file names don't change.
The move script's command is in the PR description. Differences from the issue text:

- `daemon/cli.ts` (`inwards daemon`) is not re-exported by `daemon/index.ts`. It calls
  `hookClaudeCode` from `hook/cli.ts`, and `hook/cli.ts` reads `daemon/index.ts`
  (`viaDaemon`): re-exporting `cli.ts` there would close the cycle `hook/index.ts`,
  `hook/cli.ts`, `daemon/index.ts`, `daemon/cli.ts`, `hook/cli.ts`. `hook/index.ts` re-exports
  `daemonCommand` instead, so `main.ts` still imports one face.
- `daemon/cli.ts` keeps taking `AppDeps` and `DaemonDeps` from `commands/deps.ts` until
  step 14 (`deps.ts` reads `hook/daemon/contracts.ts`, which imports no handler, so no cycle).
- No new fallow zone: the old `cli-daemon` zone is gone and `hook/daemon/**` and
  `hook/adapters/daemon-*` fall into `cli-hook` and `cli-hook-adapters`. `cli-test` may import
  `cli-hook-adapters` (the adapter tests drive the real socket and lock).

The worker thread entry (`adapters/extraction-worker.ts`, `serveExtractions`)
is still started by `main.ts`, which is the same program a worker runs, so the
compiled binary's entry and the build script don't change.

## State lifetimes

The CLI runs one command per process, but tests and future callers may run
several invocations in one process. Mutable state is made per invocation:

- `createStartLookups` for start identity and start content caches (shared by
  the suppression and old-error checks of one hook run);
- `createRunLog` for what the handlers noted.

The hook daemon (ADR-039) is the one long-lived exception, and it is still
an object, not a global: `nodeDaemon` in `adapters/compose.ts` makes its
caches (`daemonExtractionCache` and `commitKeyedGit` from `hook/daemon/_memory.ts`, through `daemon/index.ts`)
once per invocation, so they live as long as the daemon, and every request
it serves gets its own runtime, clock, streams and run log, as a one-shot
hook would.

The language server (`inwards server`, ADR-041) is the other one: its
`Session` (`lsp/_session.ts`) holds the folders, the open documents and the
last pass for as long as the editor keeps it, and `nodeLsp` in
`adapters/compose.ts` makes its extraction cache once. Every check still reads
the config, the baseline and the listing again; don't keep any of them.

The MCP server (`inwards mcp`, ADR-042) works the same way: `nodeMcp` makes
the same warm I/O as the language server (`warmIo`), once per invocation,
and `createTools` (`mcp/_tools.ts`) keeps only the queue that runs calls one
at a time. The texts an agent passes live for one call (`overlayTexts`).

A module-level `Map` or array that grows at run time is a bug.

## Where new code goes

- **A new rule.** Rules live in the engine (`src/core`). The CLI only needs
  a change when the rule needs new project input: add it to `ProjectIo`
  (`check/contracts.ts`), implement it in an adapter, and wire it in
  `adapters/compose.ts`.
- **A new hook event.** Add a `_handler.ts` in `hook/claude-code/`, route to it
  in `_dispatch.ts`, take `HookDeps`, and add E2E fixtures in
  `test/support/fixtures/claude-code` with a case in
  `test/integration/e2e.test.ts`.
- **A new CLI command.** Add a module to `commands/` that takes `AppDeps` (or, in a slice, a `cli.ts` that takes the slice's own deps),
  route to it in `main.ts`, and add its usage line to `USAGE`.
- **Something an editor shows.** The policy goes in `lsp/` (which check runs
  when, what a document shows), the protocol in `lsp/adapters/connection.ts`.
  Test it over stdio with `test/support/lsp-client.ts`, which drives the
  compiled binary in CI. The VS Code extension starts this server and has
  none of its own (ADR-043).
- **A new MCP tool.** The policy goes in `mcp/` (a module per tool, plus
  its arguments in `mcp/contracts.ts` and its entry in `mcp/_tools.ts`), the
  Zod schema and registration in `mcp/adapters/connection.ts`. Test it with
  `test/support/mcp-client.ts`: in process through the SDK's client, and over
  stdio against `run.ts`'s `CMD`, which is the compiled binary in CI.
- **A new rule's page.** `rules/adapters/pages.ts` imports every page in
  `docs/chapters/rules/` as text for `explain_rule`; add the new page's
  import there, or `test/mcp/rule-pages.test.ts` fails.
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

- **Identity paths vs display paths** (#165, #171, #175). `hook/session/commands/_start-identity.ts`
  decides which file a path named at session start. A file has an identity
  only when its path as written equals its physical path and it isn't a
  symlink. Display helpers (`paths/display.ts`) respell paths for people;
  never feed their output into an identity check, or symlink aliases can
  borrow another file's suppressions and excuses again.
- **Start content comes from git without running anything the agent set up.**
  Only `cat-file blob` and `ls-tree`, both with `--no-lazy-fetch`, never
  `--filters` or `--textconv`, and `adapters/git.ts` turns off fsmonitor and
  hooks. SessionStart's copies of dirty files (`hook/session/commands/_start-copies.ts`) are
  trusted only when their SHA-256 matches the start manifest.
- **Escalation ordering is policy.** PostToolUse computes escalation before
  recording the edit, old and context findings don't count, and Stop counts
  fresh and continuing turns differently. Don't hide it in a wrapper.
- **Fail closed.** No start record, a changed `[tool.inwards]`, a config
  that appeared mid-session, or missing hooks all block at Stop. A filesystem
  observation that fails answers "not there", which means "no start
  identity", never "unchanged".
- **`inwards server`'s and `inwards mcp`'s stdout is the protocol.**
  Anything else written there breaks the client's connection. `warmIo` in
  `compose.ts` gives their checks streams whose `out` writes to stderr; never
  write through `processStreams` from `lsp/` or `mcp/`.
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
