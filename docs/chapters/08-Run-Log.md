# Run log

The run log lets design partners measure the [business hypothesis](02-Business-Context.md#business-hypothesis) on their own sessions. It is local, off by default, and Inwards never sends it anywhere.

## Turning it on

Either of these turns it on:

- `run-log = true` in the root `[tool.inwards]`;
- `INWARDS_RUN_LOG=1` in the environment the hooks run in.

`INWARDS_RUN_LOG=0` turns it off even when the config says `run-log = true`. Either way, nothing is written in a project that doesn't use Inwards (no `[tool.inwards]` at its root and no session state), so a user-wide setting leaves other projects alone. `inwards check --log` logs that one run even when the log is off, which is how Aider's `lint-cmd` runs get recorded (add `--log` to the command `init` prints).

Lines go to `.inwards/runs.jsonl`, which `inwards init` keeps out of git for every agent. The file is readable by you only. `inwards check` logs next to the config it uses, so in a monorepo, a check run inside a package writes to that package's `.inwards/`. At 5 MiB the file moves to `.inwards/runs.1.jsonl`, replacing the previous one, and a new file starts. Two runs rotating at the same moment can lose that older file; the chance is small, and nothing else is lost.

## Line schema `inwards/run@1`

Each line is one JSON object:

| Field | Type | Meaning |
|---|---|---|
| `v` | number | Schema version, `1`. A field is only ever added; a change in meaning bumps `v` |
| `at` | string | ISO 8601 time the run ended |
| `session_id` | string or null | Claude Code session id; null for `inwards check` |
| `event` | string | `SessionStart`, `PreToolUse`, `PostToolUse`, `Stop` or `check` |
| `tool` | string or null | The tool of a tool event, e.g. `Edit` |
| `files` | string[] | Project-relative files the run checked. For `check`, its path arguments, or `"."` for the whole project |
| `lines` | object[] | `PostToolUse` only, for the file the hook checked: `{ "file", "added", "removed" }`, counted from the tool call without the lines the edit repeats unchanged around its change. A `Write` counts every line as added; `replace_all` counts one occurrence |
| `fingerprints` | string[] | One per violation reported (rule code, module and message, hashed), the same as in the session state. Two identical imports in one file give the same fingerprint twice |
| `exit` | number | The exit code Inwards returned |
| `durationMs` | number | Time since the process started, process startup included, to 0.1 ms |

```json title=".inwards/runs.jsonl (one line, wrapped)"
{"v":1,"at":"2026-09-25T20:14:03.512Z","session_id":"7a425a88-...","event":"PostToolUse",
 "tool":"Edit","files":["shop/domain/order.py"],
 "lines":[{"file":"shop/domain/order.py","added":2,"removed":1}],
 "fingerprints":["4c1f0e9a2b7d3e10"],"exit":2,"durationMs":24.8}
```

## Reading it

- **Fixed within one retry:** for each `PostToolUse` line with fingerprints, look at the next `PostToolUse` line for the same file in the same session. A fingerprint that is gone there was fixed in one retry.
- **Violations per 1,000 agent-written lines:** sum `added` over `PostToolUse` lines, and count the distinct fingerprints first reported in them.
- **Hook latency:** `durationMs` of `PostToolUse` lines.

A hook checks the whole file, so its fingerprints include violations that were there before the session. The log doesn't mark them. To count only the agent's, run `inwards check --format json --log` when the session starts, and leave out the fingerprints that run reported. The first two recipes also treat a fingerprint as fixed only when every copy of it is gone.

Hook adoption, the share of installs with an agent hook, isn't in the log: one project can't see the others. Partners report it.
