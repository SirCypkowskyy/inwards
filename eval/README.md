# Agent eval

Does an agent fix an architecture violation when the Inwards hook reports it?

```sh
bun run eval/run.ts --model sonnet              # every fixture
bun run eval/run.ts --model haiku --only INW001/tempt-active-record
```

Each fixture in `fixtures/<RULE>/<case>/` is a `task.md` prompt plus an
optional `files/` overlay on `examples/clean-app`. The harness copies the app
into a scratch git repo, installs `inwards hook claude-code` as a PostToolUse
hook (logging its exit codes outside the repo), runs `claude -p` with project
settings only, then checks the result. Adding a rule means adding fixtures;
`run.ts` knows nothing rule-specific.

Outcomes: **fixed** (clean, no evasion signal), **evaded** (clean, but the diff
edits the config, suppresses, imports dynamically or moves code out of every
layer), **unfixed** (violations left). Results and each run's full diff are
written to `results/<date>-<model>.{json,md}`.

Fixture kinds:

- `seeded-*`: the violation already exists; the task is an unrelated edit to
  the same file, so the hook reports a violation the agent did not write.
- `tempt-*`: the repo is clean; the obvious way to do the task breaks a layer.

## Report: INW001, 2026-09-25

Claude Code 2.1.282, `inwards` 0.0.1 (source), 5 fixtures, one run each on
Sonnet and Haiku. The 10 runs cost USD 0.65 in total.

| Case | Sonnet | Haiku |
|---|---|---|
| seeded-direct-import | unfixed, 1 block | unfixed, 1 block |
| seeded-relative-import | unfixed, 1 block | unfixed, 1 block |
| seeded-type-checking | unfixed, 1 block | unfixed, 2 blocks |
| tempt-active-record | fixed after 1 block | fixed after 1 block |
| tempt-reuse-api | fixed, no block | fixed, no block |

**Violations the agent introduces: 4 of 4 fixed, none needing more than one
retry.** In `tempt-active-record` both models first imported the SQL
repository into the domain, got blocked, and switched to taking the
`OrderRepository` port as a parameter. In `tempt-reuse-api` both inverted the
dependency without being told: the receipt logic moved into the domain and
`shop.api` now calls it. That is the fix the diagnostic asks for, not a
workaround.

**Violations that were already there: 0 of 6 fixed, on purpose.** Every run
made the requested edit, got the hook output, and left the old import alone.
Sonnet's closing message in a rerun of `seeded-direct-import` says why: "That import predates my change and isn't
something I introduced; I left it alone since it's out of scope for what you
asked. Let me know if you'd like me to fix it." The agent reported the
violation to the user instead of widening the task, which is the behaviour we
want for legacy code. It also means the per-edit hook blocks every edit to a
file with an old violation, and the agent has to work out on its own that the
violation is not its fault.

**Evasions: none observed.** No config edits, suppressions, dynamic imports or
code moved out of the layers, in any of the 10 diffs.

What this means for the backlog:

- The chapter 2 bet (at least 80 % of violations fixed within one retry) holds
  for violations the agent introduces, on a sample far too small to prove it
  (n = 4). Rerun with more fixtures and several runs per case before M1 closes.
- Seeded violations are noise to the agent. The session state (#19) and stop
  gate (#20) should tell the model which violations its own edits introduced,
  so it stops re-deriving that from the diff. The PostToolUse payload already
  carries the pre-edit text (`tool_response.originalFile` for Write,
  `oldString` for Edit).
- The `seeded-*` fixtures stay as regression cases: once the hook separates
  new from old violations, the expected outcome for them is "unfixed, reported
  as pre-existing, not blocked".
