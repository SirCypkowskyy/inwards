# Neovim, Zed and Helix

!!! info "Verified 2026-10-10"
    Neovim 0.12.5 on macOS (arm64), headless, with the compiled binary on `examples/broken-app`: both Neovim configs below started `inwards server` with the project as root, and `shop/domain/order.py` showed its INW001 diagnostic. The Zed extension compiles (`cargo check`) against `zed_extension_api` 0.7.0, but it hasn't been loaded in Zed. The Helix config follows the docs and source of Helix 25.07.1 and hasn't been run. Linux and Windows haven't been tried by hand.

`inwards server` is a language server over stdio, in the binary from Inwards 0.5.0 on. An editor with an LSP client starts it and shows, for every file in the workspace, what `inwards check` reports there: the file you type in is checked on every change, and the whole workspace again on every save. [VS Code](install.md#vs-code) has an extension; this page sets up the editors that take a language server from their config.

The server only reports diagnostics. It has no completion, hover or code actions, so it runs next to your Python language server (ty, basedpyright, Ruff), not instead of it.

## Before you start

- [Install Inwards](install.md) 0.5.0 or newer, and add `[tool.inwards]` to `pyproject.toml`. `inwards --help` lists `inwards server` when the binary has it.
- Each editor below starts the server in the project root, the directory that holds `pyproject.toml`. There it checks what `inwards check` run in that directory would check, with that directory's config ([ADR-041](../05-ADR.md#adr-041-inwards-server-runs-inwards-checks-own-code-the-extensions-node-server-stays-until-it-switches)).
- With Inwards as a uv dev dependency, start `uv run inwards server` instead of `inwards server`, so each project runs the version it pins. Each section shows where the command goes.

## Neovim

Neovim 0.11 added `vim.lsp.config` and `vim.lsp.enable`, so no plugin is needed. Add to `init.lua`:

```lua title="init.lua"
vim.lsp.config("inwards", {
  cmd = { "inwards", "server" },
  filetypes = { "python" },
  root_markers = { "pyproject.toml" },
})
vim.lsp.enable("inwards")
```

Neovim searches upwards from the Python file for `pyproject.toml` and uses that directory as the root. To keep the config in its own file instead, put the table in `lsp/inwards.lua` on your runtimepath (`~/.config/nvim/lsp/inwards.lua`) and keep only `vim.lsp.enable("inwards")` in `init.lua`:

```lua title="~/.config/nvim/lsp/inwards.lua"
return {
  cmd = { "inwards", "server" },
  filetypes = { "python" },
  root_markers = { "pyproject.toml" },
}
```

With uv, start the server in the project root. Neovim starts `cmd` in its own working directory, which isn't always the project, and `uv run` finds the project from the directory it runs in:

```lua title="init.lua"
vim.lsp.config("inwards", {
  cmd = function(dispatchers, config)
    return vim.lsp.rpc.start({ "uv", "run", "inwards", "server" }, dispatchers, { cwd = config.root_dir })
  end,
  filetypes = { "python" },
  root_markers = { "pyproject.toml" },
})
vim.lsp.enable("inwards")
```

[nvim-lspconfig](https://github.com/neovim/nvim-lspconfig) has no config for Inwards, and none is needed: the snippets work with it installed. Its old `require("lspconfig")` setup is deprecated, so don't register Inwards through `lspconfig.configs`.

Check it works:

- Open a Python file in the project and run `:checkhealth vim.lsp`. `inwards` is listed among the active clients, with the project as its root.
- A layer violation shows as a diagnostic with source `inwards` and its rule code. `:lua vim.diagnostic.setqflist()` lists them all in the quickfix window.
- After changing the config, `:lsp restart inwards` (Neovim 0.12) restarts the server.

## Zed

Zed starts only language servers that Zed itself or an extension registers; settings can't add a new one ([zed#52653](https://github.com/zed-industries/zed/issues/52653)). Inwards has no extension in Zed's registry yet, so install this one as a dev extension. It is three files; Zed compiles the Rust to WebAssembly when it installs it, which needs [Rust installed through rustup](https://www.rust-lang.org/tools/install).

```toml title="inwards-zed/extension.toml"
id = "inwards-local"
name = "Inwards (local)"
version = "0.1.0"
schema_version = 1
authors = ["You <you@example.com>"]
description = "Starts inwards server for Python files."
repository = "https://github.com/SirCypkowskyy/inwards"

[language_servers.inwards]
name = "Inwards"
languages = ["Python"]
```

```toml title="inwards-zed/Cargo.toml"
[package]
name = "inwards_zed"
version = "0.1.0"
edition = "2021"

[lib]
path = "src/lib.rs"
crate-type = ["cdylib"]

[dependencies]
zed_extension_api = "0.7.0"
```

```rust title="inwards-zed/src/lib.rs"
use zed_extension_api::{self as zed, settings::LspSettings, LanguageServerId, Result};

struct Inwards;

impl zed::Extension for Inwards {
    fn new() -> Self {
        Inwards
    }

    fn language_server_command(
        &mut self,
        server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let binary = LspSettings::for_worktree(server_id.as_ref(), worktree)
            .ok()
            .and_then(|settings| settings.binary);
        let args = binary
            .as_ref()
            .and_then(|b| b.arguments.clone())
            .unwrap_or_else(|| vec!["server".into()]);
        let command = binary
            .and_then(|b| b.path)
            .or_else(|| worktree.which("inwards"))
            .ok_or("inwards isn't on PATH; install it or set lsp.inwards.binary.path")?;
        Ok(zed::Command {
            command,
            args,
            env: worktree.shell_env(),
        })
    }
}

zed::register_extension!(Inwards);
```

Then, in Zed, run **zed: install dev extension** from the command palette and pick the `inwards-zed` directory. The extension looks for `inwards` on the `PATH` of the project's shell and starts `inwards server` in the worktree's root.

Zed's default for Python ends with `"..."`, which takes in every registered server, so `inwards` runs next to basedpyright and Ruff with no more settings. If you set `languages.Python.language_servers` yourself, keep `"..."` in the list or name `"inwards"`.

With uv, point the extension at `uv` in your settings. The `lsp.inwards.binary` entry replaces the command and its arguments:

```json title="~/.config/zed/settings.json"
{
  "lsp": {
    "inwards": {
      "binary": { "path": "uv", "arguments": ["run", "inwards", "server"] }
    }
  }
}
```

Check it works:

- The lightning-bolt icon in the status bar lists `inwards` among the running servers for a Python file. **dev: open language server logs** shows what it wrote to stderr.
- A layer violation shows in the editor and in the project diagnostics panel with its rule code.
- If the server doesn't start, **zed: open log** has the reason, such as the `PATH` message from the extension.

## Helix

Add the server and the Python language list to `languages.toml`, in `~/.config/helix/` for every project or in the project's `.helix/` for one:

```toml title="~/.config/helix/languages.toml"
[language-server.inwards]
command = "inwards"
args = ["server"]

[[language]]
name = "python"
language-servers = ["ty", "ruff", "jedi", "pylsp", "inwards"]
```

`language-servers` replaces Helix's default list instead of adding to it. The list above is Helix 25.07.1's default (`ty`, `ruff`, `jedi`, `pylsp`) with `inwards` added; drop the servers you don't use. Helix collects diagnostics from every server in the list, so the order doesn't matter for Inwards.

Helix starts the server in the project root, the nearest directory above the file with one of Python's root markers (`pyproject.toml`, `setup.py`, `poetry.lock`, `pyrightconfig.json`). With uv, that's where `uv run` finds the project:

```toml title="~/.config/helix/languages.toml"
[language-server.inwards]
command = "uv"
args = ["run", "inwards", "server"]
```

Check it works:

- `hx --health python` lists `inwards` among the language servers and says whether it found the binary.
- A layer violation shows in the gutter and in the diagnostics picker (`Space` `d`) with its rule code.
- `:lsp-restart` restarts the servers after a config change; `:log-open` shows why one didn't start.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| No diagnostics, and the server isn't running | The editor didn't find `inwards`. Run `inwards --version` in the shell the editor starts from, or give the command as an absolute path. |
| The server exits at once, and the editor's log shows Inwards' usage text | The binary is older than 0.5.0 and has no `server` command. Install a newer release. |
| A config error on `pyproject.toml` and nothing in the Python files | `[tool.inwards]` doesn't parse. The message names the key; the files are checked again once the fixed config is saved. |
| Findings from other files (an import cycle, say) lag behind your typing | A keystroke checks the file you type in; findings that need the whole project update on the next save. |
| With uv: "Failed to spawn: `inwards`" | The server started outside the project, or Inwards isn't in the project's dev dependencies. Check the root the editor reports, and run `uv add --dev inwards`. |
