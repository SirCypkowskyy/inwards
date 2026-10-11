# MCP server

!!! info "Verified 2026-10-10"
    On macOS (arm64), with the compiled binary on `examples/broken-app`: Claude Code 2.1.296 (`--mcp-config`) and Codex CLI 0.162.0 (`-c mcp_servers.inwards...`) started `inwards mcp` and called `check_files`, `explain_rule` and `where_should_this_go`. On Linux, CI drives the compiled binary over stdio with the MCP SDK's own client on every PR, in both protocol eras. Windows hasn't been tried by hand.

`inwards mcp` is a [Model Context Protocol](https://modelcontextprotocol.io/) server over stdio. An agent with an MCP client can ask Inwards where new code belongs and check code before it writes it, instead of finding out from a hook afterwards. It complements the hooks ([Claude Code](claude-code.md), [OpenCode](opencode.md)) and the [architecture brief](agents-md.md#the-architecture-brief-opt-in); it doesn't replace them, because an agent calls a tool only when it decides to.

It has three tools:

| Tool | What the agent gets |
|---|---|
| `check_files` | `inwards check` on files, directories, the whole project, or Python source not written yet, as the `inwards/diagnostics@1` report |
| `explain_rule` | a rule's docs page: what it reports, why, an example, and how to fix it |
| `where_should_this_go` | the layer and module new code belongs in, and which of its imports each layer would refuse |

## Set it up

1. [Install Inwards](install.md) and add `[tool.inwards]` to `pyproject.toml`.
2. Register the server with your MCP client. The client starts `inwards mcp` in the project directory and stops it when the session ends.

=== "Claude Code"

    For yourself, in this project:

    ```sh
    claude mcp add inwards -- inwards mcp
    ```

    For everyone who opens the project, in a committed `.mcp.json`; with uv, each project gets its own version of Inwards:

    ```sh
    claude mcp add --scope project inwards -- uv run inwards mcp
    ```

    `inwards init --agent claude --shared --launcher "uv run"` writes the same entry into `.mcp.json`, together with the hooks in `.claude/settings.json` ([Claude Code guide](claude-code.md#share-it-with-the-team)).

    Claude Code asks each user to approve a project's servers the first time. `claude mcp list` then shows `inwards` as connected, and `/mcp` inside a session lists its three tools.

=== "Codex CLI"

    ```sh
    codex mcp add inwards -- inwards mcp
    ```

    Or by hand, in `~/.codex/config.toml`:

    ```toml title="~/.codex/config.toml"
    [mcp_servers.inwards]
    command = "inwards"
    args = ["mcp"]
    ```

    Codex starts the server in the session's directory, so the tools see the project you run `codex` in.

=== "Other clients"

    Most clients (Cursor, VS Code, Windsurf, Zed) take a JSON entry with a command and its arguments; check the client's docs for the file and the top-level key:

    ```json title=".cursor/mcp.json"
    {
      "mcpServers": {
        "inwards": { "command": "inwards", "args": ["mcp"] }
      }
    }
    ```

    The tools resolve relative paths against the directory the client starts the server in. If your client starts it elsewhere, pass absolute paths, or the project's directory as `where_should_this_go`'s `path`.

When it connects, the server tells the client when to use each tool: `where_should_this_go` before writing a new module, `check_files` before saving Python code, `explain_rule` for a rule code in a finding, and never to edit `[tool.inwards]` to make a finding go away.

## `check_files`

Runs `inwards check` from the project directory and returns the [`inwards/diagnostics@1` report](../04-AI-Integration.md#formats), the same JSON as `inwards check --format json`.

| Argument | Type | Meaning |
|---|---|---|
| `paths` | list of strings | Files or directories, relative to the project directory or absolute |
| `contents` | object, path to text | Python source to check instead of what is on disk, by `.py` or `.pyi` path. The file need not exist yet |
| `maxDiagnostics` | positive integer | At most this many diagnostics, errors first; the summary still counts all of them |

Without `paths` and `contents` it checks the whole project, including the whole-project rules such as import cycles (INW004). With them, it checks those files the way `inwards check PATHS` does. Each path goes to the nearest `[tool.inwards]` above it, and a uv workspace's members use their own configs.

`contents` is how an agent checks code before writing it. A file that doesn't exist yet, even in a package that doesn't exist yet, is checked as if it were saved: it gets its module name and joins the module index, so other files in the same call may import it. Nothing is written to disk. Asked to check this new `shop/domain/pricing.py`:

```json
{ "contents": { "shop/domain/pricing.py": "import sqlalchemy\n" } }
```

the tool answers with the finding the hook would report after the edit (shortened):

```json
{
  "schema": "inwards/diagnostics@1",
  "summary": { "filesChecked": 1, "violations": 1, "warnings": 0, "durationMs": 2.3 },
  "diagnostics": [
    {
      "code": "INW005",
      "file": "shop/domain/pricing.py",
      "line": 1,
      "message": "Layer \"domain\" imports \"sqlalchemy\" from library \"sqlalchemy\", which \"domain\" may not use.",
      "fix": { "summary": "Use \"sqlalchemy\" in an outer layer, behind a port owned by \"domain\".", "steps": ["..."] },
      "docs": "https://sircypkowskyy.github.io/inwards/rules/INW005/"
    }
  ]
}
```

The baseline applies as in `inwards check`. A broken config, or a `contents` path that isn't Python, comes back as a tool error with the reason.

## `explain_rule`

| Argument | Type | Meaning |
|---|---|---|
| `rule` | string, required | A rule code (`INW001`, `fapi003`) or its name (`layer-dependency`), in any case |
| `full` | boolean | Also return Configuration, Fix safety, Known limitations and, where a page has one, How it works |

It returns the rule's [docs page](../rules/index.md) as Markdown: the code, name, severity, whether it is on by default, and the sections What it does, Why is this bad, Example and How to fix. The pages are built into the binary, so the answer is the page of the version you run, and it works offline. Links point at the published site. The structured content holds the same fields: `code`, `name`, `summary`, `description`, `severity`, `default`, `status`, `suppressible`, `autofix`, `docs` and `sections`.

## `where_should_this_go`

| Argument | Type | Meaning |
|---|---|---|
| `description` | string | What the code does, in a few words: "SQL repository for orders" |
| `imports` | list of strings | What the code will import: modules (`shop.domain.order`), classes in them (`shop.domain.order.Order`) and libraries (`sqlalchemy`) |
| `module` | string | The dotted module you plan to put it in, to have it judged |
| `path` | string | A directory or file in the project, which picks its `pyproject.toml`; the project directory by default |

The tool doesn't read the layers a second way. It writes a probe module that holds only the given imports, and checks it with Inwards' own check, in memory: once at `module`, if given, and once at a new module in each layer (the layer's first module prefix plus a name taken from `module` or the description). So the layer order, sibling layers, bounded contexts, library rules per layer and the module index all have their say: an import is refused with INW001, INW002, INW003, INW005 or INW010, as a real file there would be. A name whose last part starts with a capital (`Order`) is imported as a name from its module; anything else as a module, so a module that doesn't exist is reported.

The suggestion is, in this order:

1. the named `module`, when all its imports pass there;
2. with `imports`: among the layers where they all pass, the one the description points to, else the innermost;
3. without `imports`: the layer the description points to.

A description points to a layer when it names it or the last part of its module prefix ("an infrastructure adapter"), or by a short list of role words: an entity, value object, port or protocol is inner code, a use case or service sits between, and a SQL, HTTP, CLI or framework adapter, a route or a repository is outer code. The words are a hint for when the imports allow several layers; the check decides what may be imported where.

With the three layers of the [rule pages' example](../rules/INW001.md#example), this call:

```json
{ "description": "SQL repository for orders", "imports": ["sqlalchemy", "shop.domain.order.Order"] }
```

answers:

```text
Suggested: `shop.infrastructure.sql_repository_orders` (shop/infrastructure/sql_repository_orders.py), in layer "infrastructure", based on the description.

Layers that refuse some import:
- domain: `sqlalchemy` (INW005)

Layers, innermost first:
- domain (shop.domain): may import domain
- application (shop.application): may import domain, application
- infrastructure (shop.infrastructure): may import domain, application, infrastructure
```

The structured content has `config`, `layers` (each with `name`, `modules` and `mayImport`), `contexts` (`name`, `modules`, `public`, `dependsOn`), `module` when one was named (its `layer`, `context`, `file` and refused imports), `candidates` (one per layer, each with `layer`, `module`, `file` and `blocked`, the refused imports with their rule code and message) and `suggestion` (`layer`, `module`, `file` and `basis`: `module`, `imports` or `description`).

## How it runs

- **One process per client session**, started by the client and ended when the client closes stdin. It shares the CLI's warm engine with `inwards server` and `inwards daemon` and doesn't talk to either ([ADR-039](../05-ADR.md#adr-039-a-hook-daemon-per-project-separate-from-the-language-server), [ADR-042](../05-ADR.md#adr-042-inwards-mcp-answers-with-inwards-checks-own-check-on-texts-laid-over-the-disk)).
- **Every call reads the config, the baseline and the file listing again**, so an edit to `[tool.inwards]` counts from the next call. Between calls it keeps only what it extracted from each file's text, in memory.
- **Read-only.** No tool writes a file, and the calls aren't noted in the [run log](../08-Run-Log.md). Calls run one at a time.
- **Stdout carries only MCP.** Clients that open with `initialize` (the 2025 revisions) and clients that open with the 2026-07-28 revision are both served.

## Limits

- An agent calls a tool when it decides to. The hooks and the Stop gate still catch what it didn't ask about, and CI catches the rest.
- `where_should_this_go` names one new module per layer, under the layer's first literal prefix. A layer declared only with selectors (`shop.*.domain`) gets no candidate; pass `module` to judge a module in one slice.
- The role words are English and few. A description in other words gets no hint, and the suggestion falls back to the innermost layer the imports pass in.
- `contents` takes Python files only. An unsaved `pyproject.toml` or baseline isn't checked; the ones on disk are.
