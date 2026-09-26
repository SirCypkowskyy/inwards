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
| `codes` | string[] | The rule code of each fingerprint, in the same order (e.g. `INW001`). Lines written before this field existed lack it |
| `severities` | string[] | `error` or `warning` for each fingerprint, in the same order. Lines written before this field existed lack it and are read as errors |
| `exit` | number | The exit code Inwards returned |
| `durationMs` | number | Time since the process started, process startup included, to 0.1 ms |

```json title=".inwards/runs.jsonl (one line, wrapped)"
{"v":1,"at":"2026-09-25T20:14:03.512Z","session_id":"7a425a88-...","event":"PostToolUse",
 "tool":"Edit","files":["shop/domain/order.py"],
 "lines":[{"file":"shop/domain/order.py","added":2,"removed":1}],
 "fingerprints":["4c1f0e9a2b7d3e10"],"codes":["INW001"],"severities":["error"],
 "exit":2,"durationMs":24.8}
```

## Reading it

`inwards stats [DIR]` reads every `.inwards/runs.1.jsonl` and `.inwards/runs.jsonl` in the project: the one at the root, where the hooks write, and the one next to each config, where `inwards check --log` writes. It merges them in time order and prints the three numbers, each next to its [chapter 2 threshold](02-Business-Context.md#business-hypothesis). The project is DIR, else `CLAUDE_PROJECT_DIR`, else the git work tree you are in, else the outermost folder above you that has a run log. `--config` doesn't apply: `stats` always reads the whole project. `--format json` prints the same numbers as `inwards/stats@1`, with a `met` verdict for each. Nothing leaves the machine.

```text title="inwards stats"
Run log: 2 sessions, 6 hook runs, 1 unreadable line skipped.

Fixed within one retry: 1 of 2 (50%). Target: at least 80%. Not met.
    INW001  1 of 1 (100%)
    INW011  0 of 1 (0%)
    unknown  0 of 0, 1 without a retry
    1 more had no later run for their file and weren't reported at Stop.
Violations per 1,000 agent-written lines: 60 (3 in 50 lines). Target: at least 1. Met.
Hook latency: p50 40 ms, p95 200 ms over 6 runs. Target: p50 under 100 ms. Met.
```

What it counts:

- **Fixed within one retry:** a violation counts once per session and file, at the first `PostToolUse` line that reports it, and only if it is an error: warnings don't block the agent. It is fixed when the next `PostToolUse` line for that file no longer has its fingerprint, so every copy of it has to be gone. With no later run for the file, a later `Stop` line of the same session that still reports it counts as not fixed, so an agent that gives up doesn't drop out of the rate. Anything else is listed as without a retry. The per-rule split uses `codes`; a fingerprint never logged with a code counts under `unknown`.
- **Violations per 1,000 agent-written lines:** error fingerprints first reported in a session's `PostToolUse` lines, once per session and file as in the retry rate, over the sum of `added` in those lines.
- **Hook latency:** p50 and p95 of `durationMs` over `PostToolUse` lines that checked a file, by the nearest-rank method. Edits to other files (Markdown, files outside the project) run the hook too, but check nothing, so they're left out.
- **Verdicts** compare the exact ratios with the thresholds, not the rounded percentages.

A hook checks the whole file, so its fingerprints include violations that were there before the agent touched it. Two kinds are left out of both rates:

- violations a `check` line reported before the session's first edit. Run `inwards check --format json --log` before you ask the agent for its first change; without it, violations already in a file count as the agent's the first time it edits that file;
- violations the file's last hook run in another session had, so a violation left over from yesterday's session, from before `/clear`, or from another agent working on the same file at the same time isn't counted as this session's.

Hook adoption, the share of installs with an agent hook, isn't in the log: one project can't see the others. Partners report it.
