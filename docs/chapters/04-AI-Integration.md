# :material-robot-happy-outline: AI integration

Inwards' main user is an AI coding agent. This chapter explains how it reaches agents, what it tells them, and how it handles an agent that would rather silence the check than fix the code.

## Where Inwards sits in the agent loop

An agent works in a loop: read, plan, edit, check, repeat. Architecture rules usually enter that loop only at the very end, when a human reviews the pull request. Inwards moves them into the "check" step and runs them on every edit.

```mermaid
sequenceDiagram
    autonumber
    actor U as Developer
    participant A as Agent (e.g. Claude Code)
    participant H as Hook
    participant S as inwards
    participant FS as Repo

    U->>A: "Add a discount to orders"
    A->>FS: Edit shop/domain/order.py
    A->>H: PostToolUse(Edit, file_path)
    H->>S: inwards check shop/domain/order.py --format json
    S->>FS: read file + [tool.inwards]
    S-->>H: exit 1, INW001 + fix steps (~25 ms)
    H-->>A: exit 2, diagnostics on stderr
    Note over A: The model reads the steps:<br/>Protocol in shop.domain.ports,<br/>inject the implementation
    A->>FS: Edit order.py, add ports.py, wire in api/
    A->>H: PostToolUse(Edit, ...)
    H->>S: inwards check ...
    S-->>H: exit 0
    A->>H: Stop
    H->>S: inwards check (whole repo)
    S-->>H: exit 0
    A-->>U: Done, layers intact
```

Two hooks do the work. A **per-edit hook** gives fast feedback on the file that just changed. A **stop hook** runs the full check before the agent is allowed to report success. The per-edit hook alone misses cross-file effects, and the stop hook alone gives feedback too late for cheap fixes, so we use both.

## Integrations by agent

=== ":simple-anthropic: Claude Code"

    Claude Code runs [hooks](https://code.claude.com/docs/en/hooks) around tool calls. For `PostToolUse`, exit code 2 doesn't undo the edit (it already happened), but Claude sees the hook's stderr and reacts to it. For `Stop`, exit code 2 keeps Claude working instead of ending the turn. The hook input includes `stop_hook_active`, and Claude Code ends the turn anyway after several consecutive blocks, so a broken stop hook can't trap the session.

    ```json title=".claude/settings.json"
    {
      "hooks": {
        "PostToolUse": [
          {
            "matcher": "Edit|Write|MultiEdit",
            "hooks": [
              {
                "type": "command",
                "command": "inwards hook claude-code"
              }
            ]
          }
        ],
        "Stop": [
          {
            "hooks": [
              { "type": "command", "command": "inwards check --format json >&2 || exit 2" }
            ]
          }
        ]
      }
    }
    ```

    `inwards hook claude-code` reads the hook JSON from stdin, so it needs no `jq` and no POSIX shell and runs the same on Windows. After a `PostToolUse`, it checks the one Python file the agent just wrote:

    - **Violation:** compact JSON diagnostics on stderr, exit code 2.
    - **Clean file, non-Python file, or any other hook event:** exit 0, no output.
    - **Broken `[tool.inwards]`:** the message goes to stderr with exit code 2, so an agent that broke the config hears about it. With no `[tool.inwards]` at all the hook stays silent, because it may be installed for every project; the planned config guard stops an agent from deleting the table.
    - **Unreadable payload or an internal error:** exit 1. Claude Code shows that to the user, not the model.
    - **File outside the project** (`CLAUDE_PROJECT_DIR`, or the directory Claude Code runs the hook in; never the payload's own `cwd`): skipped, even when the path reaches it through `..` or a symlink. The payload comes from the agent, so Inwards doesn't trust it to pick what gets checked.
    - **Monorepos:** the nearest `pyproject.toml` with `[tool.inwards]` above the edited file applies, as long as it lies inside the project. A config above `CLAUDE_PROJECT_DIR` is ignored, so open the session at the directory that holds the config.
    - **Symlinks:** a file reached through a symlinked alias is checked under every name Python could import it by, so an alias can't move it out of its layer.

    <figure markdown="span">
      ![Claude Code hook returning exit code 2 with INW001](assets/screens/claude-code-hook.svg){ loading=lazy }
      <figcaption>Exit code 2 tells Claude Code to show the hook's stderr to the model. <code>seen-by-claude.json</code> is exactly what Claude reads.</figcaption>
    </figure>

    The `Stop` entry above is still a plain `inwards check`, and it needs a POSIX shell. A session-scoped stop gate that only blocks on violations the session introduced, together with the run log and escalation described below, is planned for v0.1.

=== ":material-console: Aider"

    Aider lints the files it edits and, when the linter fails, shows the output to the model and asks it to fix the problems. Inwards plugs in as the Python lint command:

    ```sh
    aider --lint-cmd "python: inwards check" --auto-lint
    ```

    Aider passes the edited file names to the command. Text output is enough here, because Aider forwards it to the model as is.

=== ":material-microsoft-visual-studio-code: Copilot (VS Code)"

    In agent mode, Copilot can read the workspace diagnostics that extensions publish. With the Inwards extension installed, a layer violation shows up in the Problems panel like any other error, and the agent sees it without a hook.

    For the Copilot coding agent that works on GitHub pull requests, enforcement happens in CI. Add `inwards check --format sarif` to the workflow and install the binary in `.github/workflows/copilot-setup-steps.yml` so the agent can run it before pushing.

=== ":material-file-document-edit-outline: Codex, Cursor and others"

    Every agent that reads `AGENTS.md` can be told to run the check:

    ```markdown title="AGENTS.md"
    ## Architecture
    This repo enforces layers with Inwards. After editing any .py file, run
    `inwards check <file> --format json` and fix every diagnostic before continuing.
    Never edit [tool.inwards] in pyproject.toml. Ask the user instead.
    ```

    An instruction is weaker than a hook, because the agent can skip it. Where the agent has a hook system, `inwards init --agent <name>` (planned) will install a real hook as well.

## What Inwards says, and why it's shaped that way

### Formats

| Format | For | Shape |
|---|---|---|
| `text` | Humans, Aider | `file:line:col: CODE message`, then numbered fix steps |
| `json` | Agents, scripts | `inwards/diagnostics@1`: `summary` + `diagnostics[]`, each with `fix.summary` and `fix.steps[]` |
| `sarif` | GitHub code scanning, IDE viewers | SARIF 2.1.0. Fix steps go in `message.text` and `properties.fix` |
| `concise` :material-progress-clock: | Agents on a token budget | One line per violation, like Biome's agent reporter |

<figure markdown="span">
  ![JSON output with summary and fix steps](assets/screens/json-for-agents.svg){ loading=lazy }
  <figcaption>The JSON an agent receives: a versioned summary and ordered fix steps. Piped output is compact; <code>jq</code> only pretty-prints it here.</figcaption>
</figure>

### Writing diagnostics for a model

Every diagnostic follows the same five rules. They're design assumptions about what makes an agent fix the problem rather than hide it, and the "fixed within one retry" metric in [chapter 2](02-Business-Context.md#business-hypothesis) is how we'll find out whether they hold.

1. The fix names real things: `shop.domain.ports` and `SqlOrderRepository`, never "the appropriate layer". A concrete target leaves the agent less room to improvise.
2. It gives steps in order: delete the import, declare a Protocol, type against it, wire it in the composition root. When an agent gets only a principle, the easiest move is whatever makes the error disappear.
3. It closes the escape hatches up front. Step 1 of INW001 says *don't move the import into a function or behind `TYPE_CHECKING`; Inwards checks those too*, because moving the import is the cheapest way to quiet a naive import checker.
4. The output is stable. The same input gives the same diagnostics in the same order, and JSON fields are only ever added, so agents and scripts can rely on it.
5. The output is short. One INW001 diagnostic is about 1,100 characters of JSON, roughly 280 tokens at the usual 4 characters per token. When stdout isn't a terminal, the CLI prints compact JSON, because indentation is wasted tokens for a model. A planned `--max-diagnostics` cap with a summary line will stop a legacy repo from flooding the agent's context with hundreds of findings.

### Exit codes

`0` clean · `1` violations · `2` usage or config error. The hook turns `1` into the host's "please fix" signal (exit 2 for Claude Code). A config error is also surfaced, because an agent that broke the config needs to hear about it.

### When the agent can't fix it

Sometimes the right fix needs a decision the agent shouldn't make alone, such as a new port that changes a public API. Without a limit, the stop hook keeps blocking until the host gives up on its own. The planned `inwards hook` command reads the run log, and when the same violation (same code, file and target) survives three attempts, it switches its message: *stop editing, summarise the violation, and ask the user how to proceed*. It then exits 0 so the turn can end cleanly with a question instead of a loop.

## Stopping the agent from gaming the check

A model under pressure to finish will try the cheapest thing that turns the check green. Inwards treats that as part of the threat model.

| Evasion | Example | Inwards' answer | Status |
|---|---|---|---|
| Hide the import in a function | `def save(): from shop.infrastructure import db` | Imports are found anywhere in the tree | :white_check_mark: |
| Hide it behind `TYPE_CHECKING` | `if TYPE_CHECKING: from shop.infrastructure...` | Checked too. If a domain signature mentions an infrastructure type, the domain can't be understood or reused without it, whether or not the import runs | :white_check_mark: |
| Import the package, not the module | `from shop import infrastructure` | Resolved to `shop.infrastructure` | :white_check_mark: |
| Use a relative import | `from ..infrastructure import db` | Resolved against the file's package | :white_check_mark: |
| Put new code outside every layer | Create `shop/persistence/` and import it from the domain | INW006 flags first-party packages that belong to no layer | :material-progress-clock: |
| Import dynamically | `importlib.import_module("shop.infrastructure.db")` | INW011 flags dynamic imports in inner layers | :material-progress-clock: |
| Suppress it | `# inwards: ignore` | Suppressions will need a code and a reason, show up in the summary, and can be rejected in hooks | :material-progress-clock: |
| Loosen the config | Move `shop.infrastructure` into the domain layer | A `PreToolUse` guard denies agent edits to `[tool.inwards]`; CODEOWNERS covers humans | :material-progress-clock: |
| Copy the code over | Paste the SQL class into `shop/domain/` | Out of scope. Duplication is for review and other tools | :x: |

The config guard matters most. An agent that can edit the rules isn't constrained by them. Until the guard ships, put `pyproject.toml` under CODEOWNERS and deny edits to it in the agent's permission settings.

## Catching hallucinated modules

Agents invent plausible modules: `from shop.domain.pricing import DiscountPolicy`, where `pricing` doesn't exist. Today that surfaces as an `ImportError` at test time, if a test covers the file. Inwards already knows every first-party module, because it walks the tree to name them. So it can flag an import of a first-party module that doesn't exist (INW010, planned) within the same 25 ms hook run, before any test is written. The fix steps will list the closest real modules by name.

## Briefing the agent before it writes (planned)

Fixing a violation costs a retry. Avoiding it costs nothing. Two planned features move Inwards earlier in the loop:

- **`inwards context`** prints a compact map of the layers, what each one may import, and where ports live. It's meant to be pasted or generated into `CLAUDE.md` / `AGENTS.md`.
- **`inwards mcp`** exposes Inwards as an MCP server with tools such as `check_files`, `explain_rule` and `where_should_this_go`. That last one takes a description ("SQL repository for orders") and answers with a layer and module path from the config.

```mermaid
flowchart LR
    brief["🧭 Brief<br/><small>inwards context / MCP</small>"] --> write["✍️ Agent writes code"]
    write --> check["⚡ Per-edit check<br/><small>PostToolUse hook</small>"]
    check -- "violation + steps" --> write
    check -- "clean" --> gate["🚦 Stop gate<br/><small>full check</small>"]
    gate -- "violation" --> write
    gate -- "clean" --> pr["📬 Pull request<br/><small>CI + SARIF</small>"]
```

Each stage catches what the stage before it missed, and each one costs more than the one before.
