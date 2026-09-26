# Recorded Claude Code hook payloads

Recorded from Claude Code 2.1.282 on 2026-09-25: real stdin of `SessionStart`,
`PreToolUse`, `PostToolUse` and `Stop` hooks during a headless Haiku session.
Absolute paths are replaced with `{{ROOT}}`; the transcript path is scrubbed.

To re-record after a Claude Code release (needs `claude` logged in or
`ANTHROPIC_API_KEY`; one Haiku session, capped at $0.25):

1. Run `bun run scripts/claude-payload-drift.ts "$(mktemp -d)"`. It runs a
   headless `claude -p` session whose hooks save every payload to
   `<dir>/payloads`, then reports any field added, removed or retyped against
   these fixtures. Values are not compared.
2. Copy the payloads you need over these files, keeping the names used here
   (`hook_event_name`, `tool_name` and `tool_input.file_path` tell which is
   which), replace the scratch directory path with `{{ROOT}}`, and scrub
   `transcript_path`.
3. Run `bun test src/cli --update-snapshots` and review the snapshot diff:
   a change there is a change in what agents see.

`.github/workflows/nightly-e2e.yml` runs step 1 every night and opens an issue
(or comments on the open one) when the shape drifts. It needs the repository
secret `ANTHROPIC_API_KEY`; without it the job skips with a notice.
