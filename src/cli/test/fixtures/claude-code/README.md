# Recorded Claude Code hook payloads

Recorded from Claude Code 2.1.282 on 2026-09-25: real stdin of `SessionStart`,
`PreToolUse`, `PostToolUse` and `Stop` hooks during a headless Haiku session.
Absolute paths are replaced with `{{ROOT}}`; the transcript path is scrubbed.

To re-record after a Claude Code release, in an empty scratch directory:

1. Add a `pyproject.toml` with `[tool.inwards]` and a `.claude/settings.json`
   whose hooks for those four events run
   `cat > "$CLAUDE_PROJECT_DIR/.rec/$(date +%s%N)-<Event>.json"`.
2. Run `claude -p "Create shop/domain/order.py containing: import shop.infrastructure.db . Then append X = 1 to it. Then write README.md with the word hi." --model haiku --setting-sources project --permission-mode acceptEdits`.
3. Replace the scratch directory path with `{{ROOT}}`, keep the file names used
   here, and run `bun test src/cli --update-snapshots`. Review the snapshot diff:
   a change there is a change in what agents see.
