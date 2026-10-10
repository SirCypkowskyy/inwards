# Inwards for VS Code

Shows [Inwards](https://sircypkowskyy.github.io/inwards/) architecture violations in Python files as
you type: a domain module importing infrastructure, a module no layer owns, a package missing its
`service.py`. The extension starts `inwards server`, which runs the same code as `inwards check`, so
the editor and CI report the same findings.

## Requirements

A `[tool.inwards]` table in your `pyproject.toml`. `inwards init --style <preset>` writes one; the
[install guide](https://sircypkowskyy.github.io/inwards/guides/install/) covers the layers.

The extension bundles the `inwards` binary for Linux (x64, arm64, Alpine x64), macOS (Apple silicon,
Intel) and Windows x64. On any other platform, install `inwards` and put it on `PATH`, or set
`inwards.path`.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `inwards.enable` | `true` | Run the checks. Off stops the language server. |
| `inwards.path` | `""` | The `inwards` executable to start. Empty: the bundled binary, else `inwards` on `PATH`. A relative path resolves against the first workspace folder; `~` and `${workspaceFolder}` are expanded. |

To use the version a project pins with `uv add --dev inwards`, set `inwards.path` to
`${workspaceFolder}/.venv/bin/inwards` (`${workspaceFolder}\.venv\Scripts\inwards.exe` on Windows).
In an untrusted workspace, VS Code ignores the workspace's value of `inwards.path`.

**Inwards: Restart Server** restarts the language server.
