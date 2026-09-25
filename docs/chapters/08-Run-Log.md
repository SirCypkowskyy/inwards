# Run log

The run log lets design partners measure the [business hypothesis](02-Business-Context.md#business-hypothesis) on their own sessions. It is local, off by default, and Inwards never sends it anywhere.

## Turning it on

Either of these turns it on:

- `run-log = true` in the root `[tool.inwards]`;
- `INWARDS_RUN_LOG=1` in the environment the hooks run in.

`inwards check --log` logs that one run even when the log is off, which is how Aider's `lint-cmd` runs get recorded.

Lines go to `.inwards/runs.jsonl`, which `inwards init` already keeps out of git. At 5 MB the file moves to `.inwards/runs.1.jsonl`, replacing the previous one, and a new file starts.

## Line schema `inwards/run@1`

Each line is one JSON object:

| Field | Type | Meaning |
|---|---|---|
| `v` | number | Schema version, `1`. A field is only ever added; a change in meaning bumps `v` |
| `at` | string | ISO 8601 time the run ended |
| `session_id` | string or null | Claude Code session id; null for `inwards check` |
| `event` | string | `SessionStart`, `PreToolUse`, `PostToolUse`, `Stop` or `check` |
| `tool` | string or null | The tool of a tool event, e.g. `Edit` |
| `files` | string[] | Project-relative files the run checked |
| `lines` | object[] | Per edited file: `{ "file", "added", "removed" }`, counted from the tool call. A `Write` replaces the file, so only `added` is known |
| `fingerprints` | string[] | One per violation reported (rule, module and message, hashed), the same as in the session state |
| `exit` | number | The exit code Inwards returned |
| `durationMs` | number | Wall time of the run, to 0.1 ms |

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

Hook adoption, the share of installs with an agent hook, isn't in the log: one project can't see the others. Partners report it.
