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

    Each hook then runs `cd "$CLAUDE_PROJECT_DIR" && uv run inwards hook claude-code` in the shell, from the project root, so it uses the project's own environment in every worktree and on every machine. `--launcher` takes a tool runner (`uv`, `uvx`, `poetry`, `pdm`, `hatch`, `pipx`, `rye`, `pixi`, `bunx`, `npx` or `python`) with its subcommand and options, in plain words only (letters, digits and `_ . : @ = + / -`), because it goes into a shell command unquoted. The Stop gate counts only such hooks as Inwards' own, so `echo inwards hook claude-code` can't stand in for one.

3. Start a new Claude Code session in the project (or run `/clear`). Hooks installed mid-session still work, but the Stop gate needs the session start it records.

## Check it works

- In Claude Code, run `/hooks`. `inwards` is listed under SessionStart, PreToolUse, PostToolUse and Stop.
- Ask Claude: *"Add `import shop.infrastructure.db` at the top of shop/domain/order.py."* The edit goes through, then Claude gets an INW001 report and removes the import or introduces a port.
- Ask Claude: *"Move shop.infrastructure into the domain layer in pyproject.toml."* The edit is refused with a message telling Claude to ask you.

## The hook daemon

PostToolUse, the hook that checks each file Claude writes, runs more often than the others. To keep it fast, a PostToolUse in a project with an Inwards session starts `inwards daemon` in the background: one process per project that keeps the parser and the files it has read in memory and answers the next PostToolUse hooks through a local socket (a named pipe on Windows). On an arm64 laptop running macOS, PostToolUse on a 13-line file took 38 ms p50 without it and 15 ms with it ([chapter 6](../06-Constraints-and-Quality.md#the-hook-daemon)).

- It changes speed, never results. It runs the same hook code, and it reads the config, the baseline and the session record again for every edit. When it isn't running, comes from another Inwards build or doesn't answer, the hook runs in its own process as before, then starts a new one.
- SessionStart, PreToolUse and the Stop gate never use it. The Stop gate checks everything the session changed in its own process.
- It exits after 10 minutes without an edit, so there is nothing to set up or clean up.
- It only starts in a project that has Inwards session state (`.inwards/state`). A hook installed for every project leaves no process behind in the others.

```sh
inwards daemon status   # is one running for this project, and how many hook runs it served
inwards daemon stop     # stop it; the next edit starts a new one
inwards daemon          # run it in the foreground (--idle SECONDS sets the idle limit)
```

`INWARDS_DAEMON=0` in the environment Claude Code runs in turns it off, and every hook runs in its own process. It is off when `CI` is set, unless `INWARDS_DAEMON=1`. Its record is in `$XDG_STATE_HOME/inwards/daemons/` (`~/.local/state/inwards/daemons/` by default) and its socket in `$XDG_RUNTIME_DIR/inwards/`, else `$TMPDIR/inwards-<uid>/`, both readable only by you. When no socket directory is usable, the daemon exits at once; hooks then start no other one for 5 minutes, and `inwards daemon status` says why the last start failed. Inside the daemon, the git calls of one PostToolUse share a 5-second limit, so a git that hangs costs that hook its session-start comparison instead of blocking every later edit; the Stop gate runs git without a limit. [ADR-039](../05-ADR.md#adr-039-a-hook-daemon-per-project-separate-from-the-language-server) has the design.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Nothing happens on edits | Run `/hooks`. If `inwards` is missing, run `inwards init --agent claude` again. If hooks are off, look for `disableAllHooks` in your settings files (the value from the highest-precedence file wins) or a `--settings` flag that sets it. |
| "Inwards has no record of how this session started" | The hooks were installed after the session began. Start a new session or run `/clear`. |
| "The Inwards … hook is missing from every Claude Code settings file" | A settings edit removed a hook, or it was set up before this version added one (the PreToolUse guard). Run `inwards init --agent claude` again. |
| "The Inwards Stop hook is missing …" when a session starts | The Stop hook was removed from the settings while the other Inwards hooks stayed, which is what an agent editing `settings.local.json` through Bash leaves behind. Claude Code reloads hooks at once, so the Stop gate didn't run for the rest of that session. Run `inwards init --agent claude` again and review what that session changed. |
| "A SessionStart for this session arrived after it had started", or "start record … is missing from" / "was rewritten in .inwards/state" | The session record in `.inwards/state` was deleted or rewritten, or a SessionStart was piped into `inwards hook` by hand, as an agent's Bash can do to reset the Stop gate's baseline. Inwards checked against the copy of the start record it keeps under `$XDG_STATE_HOME/inwards/sessions/` (`~/.local/state/inwards/sessions/` by default). Review the session's changes; the next session starts clean. |
| "Inwards couldn't keep a copy of this session's start outside the project" when a session starts | The state directory (`$XDG_STATE_HOME`, else `~/.local/state`) can't be written, as in a read-only home. The session runs normally, but the Stop gate then trusts `.inwards/state` only while `[tool.inwards]` is the committed one. Point `XDG_STATE_HOME` at a writable directory. |
| "Inwards has no copy of this session's start record outside the project" | The session started with an older Inwards, the copy was deleted or couldn't be written, and `[tool.inwards]` at session start wasn't the committed one. If you changed it yourself, commit it and start a new session (the check compares with the commit the session started from); if the copy couldn't be written, also make `XDG_STATE_HOME` writable. |
| "... this git (older than 2.44) can't read the committed [tool.inwards] here ..." | As above, but git before 2.44 could fetch while reading the committed config in a partial clone (or Inwards couldn't read the git config to rule that out), so Inwards doesn't read it. Upgrade git to 2.44 or newer, or make `XDG_STATE_HOME` writable so sessions keep their copy. |
| "This project requires Inwards X or newer" | `required-version` is newer than your binary. Install the newer release. |
| `config error: Unknown key tool.inwards.…` | A typo in `[tool.inwards]`. The message names the key and lists the known ones. |
| Claude says an edit to `pyproject.toml` was refused | The edit touched `[tool.inwards]`. That's the config guard. Change the layers yourself if you mean to. |
| Claude says a new `.py` file "was not created" | The package's `[[tool.inwards.shape]]` or `[[tool.inwards.names]]` doesn't allow that name, so the shape guard denied the `Write` ([INW007](../rules/INW007.md)). The reason names where the code belongs. If the package needs the member, change the shape yourself. |
| "an inline suppression that wasn't in the file when the session started" | The hooks ignore a suppression added during the session, or one in a file that wasn't committed when the session started, was too large for the hooks to keep a copy of (over 512 KiB, or past 4 MiB of such files), and was edited since ([ADR-028](../05-ADR.md#adr-028-inline-suppressions-need-a-reason-and-an-agent-cant-add-one-by-default)). If you added it, commit it and start a new session; to let Claude add them, set `agent-suppressions = "allow"` in `[tool.inwards]`. |
| The turn ends with "unresolved architecture problems" | The same violation survived `escalate-after` attempts (default 3). Claude should ask you how to proceed. The list is also handed to the next session. |
| `init` warns that the path "is in uv's cache" (or bunx's) | You ran it with `uvx` or `bunx`, so the path it would record disappears on `uv cache clean` or the next version. Add Inwards to the project and run `uv run inwards init --agent claude --launcher "uv run"`, or install the release binary and run `init` with it. |
| An `inwards daemon` process keeps running | That's the [hook daemon](#the-hook-daemon). It exits after 10 minutes without an edit; `inwards daemon stop` ends it now, and `INWARDS_DAEMON=0` keeps the hooks from starting it. |
| Windows: the hook doesn't start | `init` writes the hook in exec form with the absolute path of the binary, so no shell or `PATH` is involved. If you moved the binary, run `init` again. With `--launcher`, the hook runs in Claude Code's shell, Git Bash on Windows. |

To share the setup with the team through the committed `.claude/settings.json`, see the shell-form example in [chapter 4](../04-AI-Integration.md). It needs `inwards` on every developer's `PATH`.
