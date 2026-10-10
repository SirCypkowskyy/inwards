# GitHub Copilot

!!! info "Verified 2026-10-10"
    On macOS (arm64), with the compiled binary on `examples/broken-app`: `inwards init --agent agents-md`, and `inwards mcp` started the way the `.mcp.json` entry below starts it, answering `tools/list` and `check_files`. The setup workflow parses as YAML. No Copilot session was run, in VS Code or on GitHub, and the workflow hasn't run on GitHub. The Copilot settings, file names and limits on this page come from the VS Code and GitHub docs of that date.

Copilot has no hook that Inwards can plug into the way the [Claude Code hooks](claude-code.md) do. It meets Inwards in four places instead:

| Where | What Copilot gets | VS Code | Cloud agent |
|---|---|---|---|
| `AGENTS.md` | an instruction to run `inwards check` before it finishes | yes | yes |
| The VS Code extension | every violation in the **Problems** panel, as you type | yes | no |
| `inwards mcp` | tools to ask where code belongs and to check code before writing it | yes | yes, set up per repository |
| CI | a failing check on the pull request | yes | yes |

An instruction or a tool works only when the agent follows it, so CI stays the gate for both.

## Copilot in VS Code { #vs-code }

1. [Install Inwards](install.md) and add `[tool.inwards]` to `pyproject.toml`.
2. Install the [VS Code extension](install.md#vs-code). It runs `inwards server` and puts every violation in the **Problems** panel.
3. Add the instruction to `AGENTS.md`, and commit it:

    <!-- e2e -->

    ```sh
    inwards init --agent agents-md
    ```

    Copilot in VS Code reads `AGENTS.md` at the root of the workspace (the `chat.useAgentsMdFile` setting, on by default), in the Copilot harness and in Local sessions. The [AGENTS.md guide](agents-md.md) shows the section it adds; with Inwards as a uv dev dependency, add `--launcher "uv run"` so the section says `uv run inwards check`.

4. Register the MCP server in `.mcp.json` at the root of the project:

    ```json title=".mcp.json"
    {
      "mcpServers": {
        "inwards": { "type": "stdio", "command": "inwards", "args": ["mcp"] }
      }
    }
    ```

    VS Code starts the server in the workspace folder, so its tools see the project. This is the portable format: VS Code reads it for every session type, and Claude Code and the Copilot CLI read the same file. With uv, use `"command": "uv", "args": ["run", "inwards", "mcp"]`. In a trusted workspace the server starts without asking; in Restricted Mode it doesn't start. The [MCP guide](mcp.md) describes the three tools.

5. Tell the agent to read the **Problems** panel. VS Code's `#read/problems` tool gives it the diagnostics there, Inwards' included, but the agent decides when to call it. Name it in a prompt (*"fix #read/problems"*), or add a line to `.github/copilot-instructions.md`:

    ```markdown title=".github/copilot-instructions.md"
    After editing Python files, read #read/problems and fix every Inwards diagnostic (codes INW and FAPI) before you finish.
    ```

Check it works:

- Run **MCP: List Servers** from the command palette. `inwards` is listed as running, and **Configure Tools** in the chat input lists `check_files`, `explain_rule` and `where_should_this_go`.
- Ask the agent: *"Add `import shop.infrastructure.db` at the top of shop/domain/order.py."* The extension marks the import with INW001, and the agent, told to read the Problems panel or to run the check, removes it or introduces a port.

### Hooks { #hooks }

VS Code has agent hooks in preview, but Inwards doesn't support them yet. Its hook (`inwards hook claude-code`) reads Claude Code's payloads and tool names. VS Code's Local harness can read hooks from Claude Code's settings files (`chat.useClaudeHooks`, off by default), but it ignores their matchers and names its tools differently, and the Copilot harness uses Copilot's own hook format. Don't point either at `inwards hook claude-code`: the config guard and the Stop gate would see tool calls they don't recognise.

## Copilot cloud agent { #cloud-agent }

The cloud agent (earlier called the coding agent) works on an issue in a GitHub Actions environment and opens a pull request. It reads `AGENTS.md`, `.github/copilot-instructions.md` and `.github/instructions/*.instructions.md` from the repository.

1. Add the `AGENTS.md` section, as in step 3 above.
2. Install Inwards in the agent's environment with `.github/workflows/copilot-setup-steps.yml`. Copilot runs only a job named `copilot-setup-steps`, and only once the file is on the default branch. This one assumes Inwards is a uv dev dependency, so `AGENTS.md` should say `uv run inwards check` (`inwards init --agent agents-md --launcher "uv run"`):

    ```yaml title=".github/workflows/copilot-setup-steps.yml"
    name: Copilot setup steps

    on:
      workflow_dispatch:
      push:
        paths: [.github/workflows/copilot-setup-steps.yml]
      pull_request:
        paths: [.github/workflows/copilot-setup-steps.yml]

    jobs:
      copilot-setup-steps:
        runs-on: ubuntu-latest
        permissions:
          contents: read
        steps:
          - uses: actions/checkout@v7
          - uses: astral-sh/setup-uv@v10
          - name: Install the project, Inwards included
            run: uv sync --locked
          - run: uv run inwards --version
    ```

    The `push` and `pull_request` triggers run the job as a normal workflow when the file changes, so a broken step shows up in the pull request that adds it. If a step fails during an agent session, Copilot skips the rest and starts anyway, without Inwards. Without uv, download the release binary as in the [GitHub Actions guide](ci.md#the-workflow) and install it into a directory on the default `PATH`, such as `/usr/local/bin` (with `sudo install`).

3. Optionally, give the agent the MCP tools. In the repository's **Settings**, open **Copilot**, then **MCP servers**, and save:

    ```json
    {
      "mcpServers": {
        "inwards": {
          "type": "local",
          "command": "uv",
          "args": ["run", "inwards", "mcp"],
          "tools": ["check_files", "explain_rule", "where_should_this_go"]
        }
      }
    }
    ```

    `tools` is required and lists what the agent may call without asking; all three tools only read. The server uses the Inwards that the setup steps installed. The next session's log shows them under the **Start MCP Servers** step. GitHub doesn't document which directory the agent starts a server in; if `check_files` doesn't find the project's files, ask the agent to pass absolute paths.

4. Add the [GitHub Actions workflow](ci.md) so a violation fails the pull request. By default, workflows don't run on a pull request Copilot pushes to until someone with write access clicks **Approve and run workflows**; a repository admin can turn that approval off in the cloud agent's settings. When the check fails, mention `@copilot` in a pull request comment and ask it to fix the Inwards violations; the job log and the annotations name the rule and the fix steps.

The cloud agent also runs hooks from `.github/hooks/*.json`, in Copilot's own format. As in VS Code, Inwards has no adapter for them yet.

## Limits

- **No Stop gate.** Nothing stops a Copilot turn while a violation is open. The agent runs the check because `AGENTS.md` asks it to, and CI fails the pull request if it didn't.
- **No config guard.** Copilot can edit `[tool.inwards]` to make a finding go away. The `AGENTS.md` section tells it not to; a `CODEOWNERS` entry for `pyproject.toml` makes a person review such a change.
- **The Problems panel is read on request.** The extension shows a violation at once, but the agent sees it only when it calls `#read/problems` or runs the check.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The agent never runs the check | `AGENTS.md` is an instruction. Check that it is at the root and that `chat.useAgentsMdFile` is on, name the check in your prompt, and rely on CI for the rest. |
| `inwards` isn't listed under **MCP: List Servers** | The workspace isn't trusted, or `.mcp.json` isn't at the root of the workspace folder. Run **MCP: List Servers**, pick `inwards` and open its output for the error. |
| The cloud agent says `inwards: command not found` | The setup steps didn't install it, or `AGENTS.md` names `inwards` where the project uses `uv run inwards`. Run the setup workflow from the **Actions** tab and check its log. |
| No checks run on Copilot's pull request | The workflows wait for **Approve and run workflows** in the pull request's merge box. |
