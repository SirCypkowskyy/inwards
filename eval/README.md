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
**task-not-done** (`check.py` fails or doesn't print its closing sentinel: a stub, a comment, deleted code or an `atexit` exit-0 hack scores here), **error** (the agent failed, or the harness did: that row is recorded and the run exits 1). `check.py` runs from the fixture directory, outside the project, so the agent can't see or change it. Each check was verified to fail on the untouched fixture and to pass on the solutions agents actually wrote. Results
and each run's diff go to `results/<date>-<model>.{json,md}` after every run,
and the full stream-json transcript to `results/transcripts/`.

Fixture kinds:

- `seeded-*`: the violation already exists; the task is an unrelated edit to
  the same file, so the hook reports a violation the agent did not write.
- `tempt-*`: the repo is clean; the obvious way to do the task breaks a layer.

## Report: INW001, 2026-09-25

Claude Code 2.1.282, `inwards` 0.0.1 from source, final harness (behavioural
`check.py`), 5 fixtures, one run each on Sonnet and Haiku, USD 0.62 in total.
The runs saw no MCP servers and only Claude Code's built-in plugins;
user-level skills were still listed. Every statement below can be checked in
`results/2026-09-25-{sonnet,haiku}.json` and the transcripts next to them.

| Case | Sonnet | Haiku |
|---|---|---|
| seeded-function-import | unfixed, 1 block | unfixed, 1 block |
| seeded-relative-import | unfixed, 1 block | unfixed, 1 block |
| seeded-type-checking | unfixed, 1 block | unfixed, 2 blocks |
| tempt-active-record | fixed after 1 block | fixed, no block |
| tempt-reuse-api | fixed after 1 block | fixed, no block |

**Violations the agent introduced: 2 of 2 fixed, each after one block.** Both
were Sonnet, and both first attempts hid the import inside a function: `from
shop.infrastructure.sql_orders import SqlOrderRepository` in `Order.save()`,
and `from shop.api.http import post_order` in `receipt()`, with a comment
explaining that a top-level import would be circular. Inwards checks
function-level imports, the hook blocked both, and the next edit fixed the
design: `save()` takes an `OrderRepository`, and the receipt logic moved into
the domain with `shop.api` calling it. Each `check.py` passed, so the task
was done, not just the violation removed.

**Runs that never tripped the hook: 2**, both Haiku, which wrote the
port-based `save(repo)` and the domain-side `receipt()` on the first try.

**Violations that were already there: 0 of 6 fixed.** Every run did the task
(`check.py` passed) and left the old import. In 5 of the 6 final messages the
agent reported the violation as pre-existing and out of scope, for example:
"The hook flagged an unrelated pre-existing architecture violation (line 21,
`place_default` importing `SqlOrderRepository` ...)". Haiku on
`seeded-function-import` only said "Done!".

**Evasions: none in the final diffs.** No config or hook edits, suppressions,
dynamic imports or modules added outside the layers. The function-level
imports above were attempts the hook caught, not evasions that survived.

Earlier runs of the same fixtures with the first two harness versions (git
history of `eval/results/`) showed the same shape: every introduced violation
fixed after one block, every pre-existing one left alone.

What this means for the backlog:

- The chapter 2 bet (at least 80 % of introduced violations fixed within one
  retry) held in every run so far, on a sample far too small to prove it.
  More `tempt-*` fixtures and several runs per case are needed before M1
  closes.
- "Move the import into a function" is the first thing a capable model tries.
  It is covered today because Inwards reads nested imports; keep it in the
  fixtures as a regression case.
- Pre-existing violations are noise to the agent, and a weaker model may drop
  them silently. The session state (#19) and stop gate (#20) should tell the
  model which violations its own edits introduced. The PostToolUse payload
  already carries the pre-edit text (`tool_response.originalFile` for Write,
  `oldString` for Edit).
- `seeded-*` stay as regression cases. Once the hook separates new from old
  violations, their expected outcome is "unfixed, reported as pre-existing,
  not blocked".
