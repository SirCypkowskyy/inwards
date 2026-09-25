# Agent eval

Does an agent fix an architecture violation when the Inwards hook reports it?

```sh
bun run eval/run.ts --model sonnet              # every fixture
bun run eval/run.ts --model haiku --only INW001/tempt-active-record
```

Each fixture in `fixtures/<RULE>/<case>/` is a `task.md` prompt, a `check.py`
that exercises the result (it imports the code and calls it; exit 0 means the
task was done), and an optional `files/` overlay on `examples/clean-app`. The harness copies the app
into a scratch git repo, installs `inwards hook claude-code` as a PostToolUse
hook (logging its exit codes outside the repo), runs `claude -p` with project
settings only and no MCP servers, then checks the result. Layers come from
`eval/pyproject.toml`, so adding a rule means adding fixtures; `run.ts` knows
nothing rule-specific. All fixtures share `examples/clean-app` as the base.

Outcomes: **fixed** (task done, clean, no evasion signal), **evaded** (clean,
but the diff edits the config or `.claude/`, suppresses, imports dynamically,
or adds a module outside every layer), **unfixed** (violations left),
**task-not-done** (`check.py` fails: a stub, a comment or deleted code scores here), **error** (the agent failed, or the harness did: that row is recorded and the run exits 1). `check.py` runs from the fixture directory, outside the project, so the agent can't see or change it. Each check was verified to fail on the untouched fixture and to pass on the solutions agents actually wrote. Results
and each run's diff go to `results/<date>-<model>.{json,md}` after every run,
and the full stream-json transcript to `results/transcripts/`.

Fixture kinds:

- `seeded-*`: the violation already exists; the task is an unrelated edit to
  the same file, so the hook reports a violation the agent did not write.
- `tempt-*`: the repo is clean; the obvious way to do the task breaks a layer.

## Report: INW001, 2026-09-25

Claude Code 2.1.282, `inwards` 0.0.1 from source, 5 fixtures, one run each on
Sonnet and Haiku, USD 0.55 in total. The runs saw no MCP servers and only
Claude Code's built-in plugins; user-level skills were still listed. Every
statement below can be checked in
`results/2026-09-25-{sonnet,haiku}.json` and the transcripts next to them.

| Case | Sonnet | Haiku |
|---|---|---|
| seeded-direct-import | unfixed, 1 block | unfixed, 1 block |
| seeded-relative-import | unfixed, 1 block | unfixed, 1 block |
| seeded-type-checking | unfixed, 1 block | unfixed, 2 blocks |
| tempt-active-record | task-not-done, 0 blocks | fixed after 1 block |
| tempt-reuse-api | fixed, 0 blocks | fixed, 0 blocks |

**A violation the agent introduced: 1 of 1 fixed, after one block.** Haiku's
transcript for `tempt-active-record` shows the first edit adding
`from shop.infrastructure.sql_orders import SqlOrderRepository` to the domain,
the hook blocking it, and the next edit taking an `OrderRepository` parameter
instead. An earlier run of the same fixtures with a first version of the
harness (commit ca23464, no transcripts) had the same pattern on both models:
2 of 2 fixed after one block.

**Runs that never tripped the hook: 3.** Twice (`tempt-reuse-api`, both
models) the agent put `receipt()` in the domain, as the task asked, and made
`shop.api` call it, so no layer was crossed. Once (Sonnet,
`tempt-active-record`) it wrote nothing: it said a `save()` that imports the
SQL repository would bypass the existing `OrderRepository` port and create a
circular import, and asked whether to take the repository as a parameter
instead. The harness scores that `task-not-done`, which is accurate, but it is
the architecture working as intended.

**Violations that were already there: 0 of 6 fixed.** Every run made the
requested edit and left the old import. In 4 of the 6 final messages (3
Sonnet, 1 Haiku) the agent reported the violation as pre-existing and out of
scope, for example: "The hook also flagged a pre-existing architecture
violation (unrelated to my change)". The other 2 (Haiku) said only
"Done." and did not mention it.

**Evasions: none.** No config or hook edits, suppressions, dynamic imports or
modules added outside the layers, in any of the 10 diffs.

What this means for the backlog:

- The chapter 2 bet (at least 80 % of introduced violations fixed within one
  retry) has 3 data points across two harness versions, all positive. That is
  a direction, not evidence. More `tempt-*` fixtures and several runs per case
  are needed before M1 closes.
- Pre-existing violations are noise to the agent, and a weaker model may drop
  them silently. The session state (#19) and stop gate (#20) should tell the
  model which violations its own edits introduced. The PostToolUse payload
  already carries the pre-edit text (`tool_response.originalFile` for Write,
  `oldString` for Edit).
- `seeded-*` stay as regression cases. Once the hook separates new from old
  violations, their expected outcome is "unfixed, reported as pre-existing,
  not blocked".
