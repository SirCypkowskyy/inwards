# AGENTS.md (Codex, Cursor, and others)

!!! info "Verified 2026-09-25"
    Linux by hand: `init`, the section it writes, and `inwards check --format json`. No agent was run. On macOS (arm64) and Windows, CI runs `init` with the compiled binary before each release; a by-hand check there is still open.

Many coding agents read [`AGENTS.md`](https://agents.md) at the root of the repository for project instructions, including OpenAI Codex, Cursor, and Jules. Inwards adds a short section there that tells the agent to run the check before finishing, and how to read the result.

## Set it up

1. [Install Inwards](install.md) so that `inwards` is on `PATH` for everyone who runs the agent, and add `[tool.inwards]` to `pyproject.toml`.
2. In the project, run:

    <!-- e2e -->

    ```sh
    inwards init --agent agents-md
    ```

    It pins `required-version` and a default `ignore` list in `[tool.inwards]`, adds `.inwards/` to `.gitignore`, and adds this section to `AGENTS.md` (creating the file if needed):

    ```markdown
    <!-- inwards:begin -->
    ## Architecture check (Inwards)

    The layers in `[tool.inwards]` (pyproject.toml) are enforced. Before you finish a task, run:

        inwards check --format json

    Exit code 1 means an import breaks a layer: follow the numbered `fix.steps` in the output.
    Don't edit `[tool.inwards]` to make the check pass; ask the user instead.
    <!-- inwards:end -->
    ```

    If the project runs Inwards through uv (a dev dependency, no activated virtualenv), add `--launcher "uv run"`, and the section says `uv run inwards check --format json`:

    ```sh
    uv run inwards init --agent agents-md --launcher "uv run"
    ```

    The section names one command for the project. With several `[tool.inwards]` tables (a uv workspace, for example), add a line per config by hand outside the markers, with `--config <member>/pyproject.toml`.

3. Commit `AGENTS.md`. Running `init` again replaces only the text between the markers.

## Check it works

- Run `inwards check --format json` yourself. A `violations` count of 0 in the summary means the project is clean.
- Ask the agent to make a change in the domain layer. At the end it should run `inwards check --format json` and report the result.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The agent never runs the check | This is an instruction, not a hook, so the agent may skip it. Use an agent with hooks (such as [Claude Code](claude-code.md)) or run `inwards check` in CI. |
| `init` stops with "unmatched markers" | `AGENTS.md` doesn't have exactly one `inwards:begin` and one `inwards:end` marker. Fix or remove them by hand, then run `init` again. |
| `inwards: command not found` in the agent's shell | The agent's environment doesn't see the binary. Put it on `PATH` there, or, when Inwards is a uv dev dependency, run `init` again with `--launcher "uv run"`. (Editing the command inside the markers works until the next `init`, which puts the section back.) |

For a hard stop, run `inwards check` in CI: exit code 1 fails the job. The [GitHub Actions guide](ci.md) has a workflow that also annotates the pull request and uploads SARIF to code scanning.
