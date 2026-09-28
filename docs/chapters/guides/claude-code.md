# Claude Code

!!! info "Verified 2026-09-25"
    Linux by hand: `init` and its output, and a headless `claude -p` session in Claude Code 2.1.282, where the config edit was refused, the violation was reported, and the Stop gate escalated to the user. The interactive `/hooks` step wasn't run. On macOS (arm64) and Windows, CI runs `init` and the hook with the compiled binary before each release; a by-hand check there is still open.

With the hooks installed, Inwards checks every Python file Claude writes. It won't let the turn end while the session's changes break a layer, and it refuses edits to the rules themselves. [Chapter 4](../04-AI-Integration.md) explains the design.

## Set it up

1. [Install Inwards](install.md) and add `[tool.inwards]` to `pyproject.toml`.
2. In the project, run:

    <!-- e2e -->

    ```sh
    inwards init --agent claude --dry-run   # shows what will change
    inwards init --agent claude
    ```

    This writes four hooks (SessionStart, PreToolUse, PostToolUse, Stop) and two `permissions.deny` rules into `.claude/settings.local.json`. That file holds this machine's path to the binary, so `init` adds it to `.gitignore`, together with `.inwards/`. It also pins `required-version` and a default `ignore` list in `[tool.inwards]`. Running it again changes nothing.

    If Inwards is a uv dev dependency, record the launcher instead of a path:

    ```sh
    uv run inwards init --agent claude --launcher "uv run"
    ```

    Each hook then runs `cd "$CLAUDE_PROJECT_DIR" && uv run inwards hook claude-code` in the shell, from the project root, so it uses the project's own environment in every worktree and on every machine. `--launcher` takes plain words only (letters, digits and `_ . : @ = + / -`), because it goes into a shell command unquoted.

3. Start a new Claude Code session in the project (or run `/clear`). Hooks installed mid-session still work, but the Stop gate needs the session start it records.

## Check it works

- In Claude Code, run `/hooks`. `inwards` is listed under SessionStart, PreToolUse, PostToolUse and Stop.
- Ask Claude: *"Add `import shop.infrastructure.db` at the top of shop/domain/order.py."* The edit goes through, then Claude gets an INW001 report and removes the import or introduces a port.
- Ask Claude: *"Move shop.infrastructure into the domain layer in pyproject.toml."* The edit is refused with a message telling Claude to ask you.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Nothing happens on edits | Run `/hooks`. If `inwards` is missing, run `inwards init --agent claude` again. If hooks are off, look for `disableAllHooks` in your settings files (the value from the highest-precedence file wins) or a `--settings` flag that sets it. |
| "Inwards has no record of how this session started" | The hooks were installed after the session began. Start a new session or run `/clear`. |
| "The Inwards … hook is missing from every Claude Code settings file" | A settings edit removed a hook, or it was set up before this version added one (the PreToolUse guard). Run `inwards init --agent claude` again. |
| "This project requires Inwards X or newer" | `required-version` is newer than your binary. Install the newer release. |
| `config error: Unknown key tool.inwards.…` | A typo in `[tool.inwards]`. The message names the key and lists the known ones. |
| Claude says an edit to `pyproject.toml` was refused | The edit touched `[tool.inwards]`. That's the config guard. Change the layers yourself if you mean to. |
| "an inline suppression that wasn't in the file when the session started" | The hooks ignore a suppression added during the session, or one in a file that wasn't committed when the session started and was edited since ([ADR-028](../05-ADR.md#adr-028-inline-suppressions-need-a-reason-and-an-agent-cant-add-one-by-default)). If you added it, commit it and start a new session; to let Claude add them, set `agent-suppressions = "allow"` in `[tool.inwards]`. |
| The turn ends with "unresolved architecture problems" | The same violation survived `escalate-after` attempts (default 3). Claude should ask you how to proceed. The list is also handed to the next session. |
| `init` warns that the path "is in uv's cache" (or bunx's) | You ran it with `uvx` or `bunx`, so the path it would record disappears on `uv cache clean` or the next version. Add Inwards to the project and run `uv run inwards init --agent claude --launcher "uv run"`, or install the release binary and run `init` with it. |
| Windows: the hook doesn't start | `init` writes the hook in exec form with the absolute path of the binary, so no shell or `PATH` is involved. If you moved the binary, run `init` again. With `--launcher`, the hook runs in Claude Code's shell, Git Bash on Windows. |

To share the setup with the team through the committed `.claude/settings.json`, see the shell-form example in [chapter 4](../04-AI-Integration.md). It needs `inwards` on every developer's `PATH`.
