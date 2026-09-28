# Design partners

Design partners run Inwards on real projects with their AI agents and tell us whether it works: whether agents fix what it reports, whether it catches real violations, and whether it stays out of the way. This page is the whole path, from install to sharing numbers. Nothing leaves your machine unless you send it yourself.

## What we ask, and what you get

- **We ask for** a few weeks of normal agent work with the hooks on and the run log enabled, then either the output of `inwards stats` or a redacted log, and a short feedback issue.
- **You get** an architecture check your agents can't argue with, a say in which rules come next, and a direct line to the maintainer.

## Onboarding checklist

1. **Install** Inwards as a dev dependency ([install guide](install.md)) and write `[tool.inwards]` with your layers.
2. **Accept what is there today:** `inwards baseline`, then commit `inwards-baseline.json`. Existing violations stop failing; new ones still do ([install guide](install.md#on-an-existing-codebase)).
3. **Wire in your agent:** `inwards init --agent claude` ([Claude Code](claude-code.md)), `inwards init --agent opencode` ([OpenCode](opencode.md)), or [Aider](aider.md), or [AGENTS.md](agents-md.md) for other agents. Leave out `--brief` unless we agreed to test the [architecture brief](agents-md.md#the-architecture-brief-opt-in); if you add it later, tell us the date, so we compare the runs before and after it separately.
4. **Turn the run log on:** `run-log = true` in the root `[tool.inwards]`, or `INWARDS_RUN_LOG=1` in the environment your agent runs in ([run log](../08-Run-Log.md#turning-it-on)).
5. **Before each agent session's first change**, run `inwards check --format json --log`. It records the violations that were already there, so they don't count as the agent's.
6. **Work as usual.** Don't change how you prompt the agent for our sake.
7. **Once a week**, run `inwards stats`. It prints the three numbers we measure, each next to its target ([what it counts](../08-Run-Log.md#reading-it)).

## What the run log holds

One JSON line per hook run or logged check, in `.inwards/runs.jsonl` (the full schema is in [chapter 8](../08-Run-Log.md#line-schema-inwardsrun1)):

| Holds | Never holds |
|---|---|
| Time, session id, event, tool name | Source code, diffs or file contents |
| Project-relative paths of the files checked | Prompts, agent messages or model output |
| Lines added and removed per edit (counts only) | Import targets or diagnostic messages |
| A hash per violation, its rule code and severity | Your name, machine or git remote |
| Exit code and duration | |

Two fields say something about your code base: the paths, and the fingerprints. A fingerprint is a plain hash of the rule, module and message, so anyone who guesses likely module names can reverse it. `--redact` (below) replaces both with hashes keyed by a secret that stays on your machine. A `check` given a path outside the project logs it as written (`../…`); redaction hashes that too.

## Sharing

Pick one; either is enough.

- **The numbers only:** `inwards stats --format json > inwards-stats.json`. It holds counts, rates and latencies, with no paths or hashes.
- **The redacted log**, for deeper analysis: `inwards stats --export inwards-log.jsonl --redact`. It writes every log line of the project in time order, with each path and each fingerprint replaced by a keyed hash, and only the fields listed above. The key is created once per project in `.inwards/export-key` and never leaves your machine, so we can tell files apart without being able to guess their names. Read the file before you send it.

Send the file to the maintainer by the channel you agreed on. Delete `.inwards/` (at the project root, and next to each package's `pyproject.toml` in a monorepo) and any exported file any time to start over; nothing else keeps a copy.

## Consent

Sharing is opt-in, per file, and you can stop at any time. We use what you send only to test the hypothesis in [chapter 2](../02-Business-Context.md#the-hypothesis) and to improve Inwards. We publish only aggregates across partners, never a partner's numbers on their own without asking. Tell us if you want a shared file deleted, and we will.

## Feedback

Open a **Design partner feedback** issue (the form asks what you tried, what the agent did, and what got in the way). One more number we can't measure from the log: whether your team kept the agent hooks on, and if not, why.
