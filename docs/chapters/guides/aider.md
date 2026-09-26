# Aider

!!! info "Verified 2026-09-25"
    Linux by hand: `init`, and the `lint-cmd` run the way Aider runs it (from the git root, once per edited file). Aider itself wasn't run. On macOS (arm64) and Windows, CI runs `init` and `check` with the compiled binary before each release; a by-hand check there is still open.

Aider runs a lint command after each edit and asks the model to fix what it reports. Inwards plugs in as that command for Python files.

## Set it up

1. [Install Inwards](install.md) and add `[tool.inwards]` to `pyproject.toml`.
2. In the project, run:

    <!-- e2e -->

    ```sh
    inwards init --agent aider
    ```

    It pins `required-version` and a default `ignore` list in `[tool.inwards]`, adds `.inwards/` to `.gitignore`, and prints the line to add to Aider's config. The line has the absolute path of your binary:

    ```yaml title=".aider.conf.yml"
    lint-cmd: "python: '/home/you/.local/bin/inwards' check --format text"
    ```

3. Add that line to `.aider.conf.yml` in the project (or in your home directory for every project). Keep Aider's `auto-lint` on, which is the default.

Aider runs the command from the git root, once per edited file, with that file's path appended, so Inwards checks only what changed. The `text` format carries the same numbered fix steps an agent gets in JSON. A `python:` lint command replaces Aider's built-in Python linter, so syntax errors are no longer reported by Aider; keep a compile step in your tests or CI.

## Check it works

- Run `inwards check` yourself. It should print `All clear`, or the violations already in the project.
- Ask Aider: *"Add `import shop.infrastructure.db` to shop/domain/order.py."* After the edit, Aider shows the INW001 report and offers to fix it.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| No lint output after edits | Check that `auto-lint` isn't turned off and that the `lint-cmd` line starts with `python:`, so it applies to Python files. |
| `No pyproject.toml with [tool.inwards] found` | Aider runs the command from the git root. If `pyproject.toml` sits in a subdirectory, add `--config <path>/pyproject.toml` to the command. |
| Violations in files Aider didn't touch | Aider passes only edited files. A violation elsewhere comes from a full `inwards check` run, not from Aider. |
| You want the runs recorded | Add `--log` to the command (`... check --format text --log`). See [Run log](../08-Run-Log.md). |

Aider has no equivalent of Claude Code's Stop hook or config guard. To keep the model from changing `[tool.inwards]`, don't add `pyproject.toml` to the chat (or add it with `/read-only`), and use CODEOWNERS so a changed config needs review before it merges.
