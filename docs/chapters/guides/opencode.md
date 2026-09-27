# OpenCode

!!! info "Verified 2026-09-27"
    Linux by hand with OpenCode 1.18.31: `init` and its output; an `opencode run` session in which the agent wrote an outward import, got INW001 back in the tool result and fixed it (the end-to-end test in `src/cli/test/integration/opencode-e2e.test.ts`); and a session on `opencode serve` in which the Stop gate sent the agent back and it fixed the violation. The interactive TUI, macOS and Windows weren't checked by hand.

With the plugin installed, Inwards checks every Python file the agent edits in OpenCode, refuses edits to the rules, and sends the agent back to work when the session's changes break a layer. The plugin runs the same hook as [Claude Code](claude-code.md), so the rules, the config guard and the Stop gate behave the same; the differences come from what OpenCode's plugin API can do, and are listed [below](#what-holds-on-opencode). [ADR-033](../05-ADR.md#adr-033-opencode-through-a-plugin-that-runs-the-claude-code-hook) explains the design.

## Set it up

1. [Install Inwards](install.md) and add `[tool.inwards]` to `pyproject.toml`.
2. In the project, run:

    <!-- e2e -->

    ```sh
    inwards init --agent opencode --dry-run   # shows what will change
    inwards init --agent opencode
    ```

    This writes the plugin `.opencode/plugins/inwards.js`. It holds this machine's path to the binary, so `init` adds it to `.gitignore`, together with `.inwards/`. It also pins `required-version` and a default `ignore` list in `[tool.inwards]`. Running it again changes nothing. If a file of that name exists and `init` didn't write it, `init` stops and leaves it alone.

3. Start OpenCode again in the project. OpenCode loads plugins when it starts.

## Check it works

- Ask the agent: *"Add `import shop.infrastructure.db` at the top of shop/domain/order.py."* The edit goes through, and the tool result the agent reads ends with an INW001 report. The agent removes the import or introduces a port.
- Ask the agent: *"Move shop.infrastructure into the domain layer in pyproject.toml."* The edit is refused with a message telling the agent to ask you.

## What holds on OpenCode

| Claude Code guarantee | On OpenCode |
|---|---|
| A check after every edit | Holds for the `edit`, `write` and `apply_patch` tools. The findings are appended to the tool result, which the agent reads before its next step. |
| The config guard refuses edits to `[tool.inwards]`, the baseline and Inwards' files | Holds for `edit`, `write` and `bash`: they go through the same guard. The guard can't read a patch, so the plugin refuses any `apply_patch` that touches `pyproject.toml`, `.opencode/`, `opencode.json(c)`, `.inwards/` or `inwards-baseline.json`. The agent can still change `pyproject.toml` with `edit`, which the guard checks; `edit` and `write` of the other files are refused too, as `permissions.deny` does on Claude Code. |
| The Stop gate refuses to end a turn while the session's changes break a layer | OpenCode can't refuse the end of a turn. When the session goes idle, the plugin runs the gate; if it blocks, the plugin sends its reasons into the session as a new message, starting another turn. The message begins "Inwards Stop gate (sent by the Inwards plugin, not the user)", so the agent doesn't take it for your words. `escalate-after` works as on Claude Code. |
| The Stop gate in a non-interactive run | `opencode run` exits when the session goes idle, so there is no second turn. The per-edit check still reaches the agent within the run; run `inwards check` after it, as in [CI](ci.md). A session driven through `opencode serve` gets the second turn. |
| Subagents | A subagent's session is mapped to the top-level session, as Claude Code gives a subagent its parent's session id. Its edits are checked; the Stop gate runs when the top-level session goes idle, over everything the session and its subagents changed. |
| A missing hook fails the Stop gate | The gate checks that the plugin file is still there. If the file is gone, the gate blocks and asks for `inwards init --agent opencode`. Once OpenCode restarts without the plugin, nothing runs to report it, just as when Claude Code's settings file is deleted. |
| Messages from the user | The plugin can't block a message you send. A message you send starts a new turn, and the `escalate-after` count starts again. |

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Nothing happens on edits | OpenCode was running when `init` wrote the plugin. Start it again. If `.opencode/plugins/inwards.js` is missing, run `inwards init --agent opencode` again. |
| "Inwards has no record of how this session started" | The plugin was installed after the session began. Start a new session. |
| "The Inwards OpenCode plugin … is missing or isn't the one `inwards init` wrote" | Something removed or replaced `.opencode/plugins/inwards.js`. Run `inwards init --agent opencode` again. |
| "This project requires Inwards X or newer" | `required-version` is newer than your binary. Install the newer release. |
| The agent says `apply_patch` was refused | The patch touched `pyproject.toml` or one of Inwards' files. The agent can make the change with `edit`, which the config guard checks; a change to `[tool.inwards]` is yours to make. |
| The Stop gate didn't send the agent back after `opencode run` | Expected: the process exits when the session goes idle. Run `inwards check` after the run. |
| Windows: the plugin can't start Inwards | The plugin starts the binary by its absolute path, with no shell. If you moved the binary, run `init` again. |
