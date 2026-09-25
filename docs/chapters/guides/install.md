# Install Inwards

!!! info "Verified 2026-09-25"
    The from-source build and every command after it, by hand on Linux x64. On macOS (arm64) and Windows, CI runs `init`, `check` and the hook with the compiled binary on every push; a by-hand check there is still open. The release download steps can't be tried until v0.1.0 is published.

Inwards is one executable with no runtime to install. The first public release will be v0.1.0. Until it's out, build from source.

## From a release

Each release on [GitHub Releases](https://github.com/SirCypkowskyy/inwards/releases) has one binary per platform and `SHA256SUMS`. Build attestations are added once the repository is public.

| Platform | File |
|---|---|
| Linux x64 | `inwards-linux-x64` (glibc) or `inwards-linux-x64-musl` (Alpine: `apk add libstdc++ libgcc` first) |
| Linux arm64 | `inwards-linux-arm64` |
| macOS Apple silicon | `inwards-darwin-arm64` |
| macOS Intel | `inwards-darwin-x64` |
| Windows x64 | `inwards-windows-x64.exe` |

=== "Linux / macOS"

    ```sh
    VERSION=v0.1.0; FILE=inwards-linux-x64   # pick your file from the table
    curl -LO "https://github.com/SirCypkowskyy/inwards/releases/download/$VERSION/$FILE"
    curl -LO "https://github.com/SirCypkowskyy/inwards/releases/download/$VERSION/SHA256SUMS"
    sha256sum --check --ignore-missing SHA256SUMS   # macOS: shasum -a 256 --check --ignore-missing SHA256SUMS
    mkdir -p ~/.local/bin && install -m 755 "$FILE" ~/.local/bin/inwards
    inwards --version
    ```

    If `inwards` isn't found, add `~/.local/bin` to `PATH` in your shell profile (`export PATH="$HOME/.local/bin:$PATH"`).

=== "Windows (PowerShell)"

    ```powershell
    $Version = "v0.1.0"; $File = "inwards-windows-x64.exe"
    Invoke-WebRequest "https://github.com/SirCypkowskyy/inwards/releases/download/$Version/$File" -OutFile inwards.exe
    Invoke-WebRequest "https://github.com/SirCypkowskyy/inwards/releases/download/$Version/SHA256SUMS" -OutFile SHA256SUMS
    (Get-FileHash inwards.exe -Algorithm SHA256).Hash.ToLower()   # compare with the line for $File in SHA256SUMS
    .\inwards.exe --version
    ```

    Put `inwards.exe` in a folder on your `PATH`.

Once attestations are published, `gh attestation verify <file> --repo SirCypkowskyy/inwards` checks that a binary was built by this repository's release workflow.

## From source

You need [Bun](https://bun.sh) 1.4.2 (the version in `.bun-version`) and access to the repository.

```sh
git clone https://github.com/SirCypkowskyy/inwards && cd inwards
bun install
bun run build:cli bun-linux-x64          # or bun-darwin-arm64, bun-windows-x64, ...
mkdir -p ~/.local/bin && install -m 755 dist/inwards-linux-x64 ~/.local/bin/inwards
inwards --version
```

## Configure the layers

Add `[tool.inwards]` to the `pyproject.toml` of the project you want to check, innermost layer first:

```toml title="pyproject.toml"
[tool.inwards]
layers = [
  { name = "domain",         modules = ["shop.domain"] },
  { name = "application",    modules = ["shop.application"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]
```

Then check the whole project:

```sh
inwards check
```

`All clear` with exit code 0 means every import points inward. Exit code 1 lists each violation with numbered fix steps, and exit code 2 is a usage or config error. Next, wire Inwards into your agent: [Claude Code](claude-code.md), [Aider](aider.md), or any agent that reads [AGENTS.md](agents-md.md).
