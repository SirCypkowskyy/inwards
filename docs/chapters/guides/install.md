# Install Inwards

!!! info "Verified 2026-09-25"
    The from-source build and every command after it, by hand on Linux x64. On macOS (arm64) and Windows, CI runs `init`, `check` and the hook with the compiled binary on every push; a by-hand check there is still open. The release download steps can't be tried until v0.1.0 is published.

Inwards is one executable with no runtime to install. The latest release is the pre-release v0.1.0-rc.1; the first full release comes with a later milestone. You can also build from source.

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
    VERSION=v0.1.0-rc.1; FILE=inwards-linux-x64   # pick your file from the table
    curl -LO "https://github.com/SirCypkowskyy/inwards/releases/download/$VERSION/$FILE"
    curl -LO "https://github.com/SirCypkowskyy/inwards/releases/download/$VERSION/SHA256SUMS"
    sha256sum --check --ignore-missing SHA256SUMS   # macOS: shasum -a 256 --check --ignore-missing SHA256SUMS
    mkdir -p ~/.local/bin && install -m 755 "$FILE" ~/.local/bin/inwards
    inwards --version
    ```

    If `inwards` isn't found, add `~/.local/bin` to `PATH` in your shell profile (`export PATH="$HOME/.local/bin:$PATH"`).

=== "Windows (PowerShell)"

    ```powershell
    $Version = "v0.1.0-rc.1"; $File = "inwards-windows-x64.exe"
    Invoke-WebRequest "https://github.com/SirCypkowskyy/inwards/releases/download/$Version/$File" -OutFile inwards.exe
    Invoke-WebRequest "https://github.com/SirCypkowskyy/inwards/releases/download/$Version/SHA256SUMS" -OutFile SHA256SUMS
    (Get-FileHash inwards.exe -Algorithm SHA256).Hash.ToLower()   # compare with the line for $File in SHA256SUMS
    .\inwards.exe --version
    ```

    Put `inwards.exe` in a folder on your `PATH`.

Once attestations are published, `gh attestation verify <file> --repo SirCypkowskyy/inwards` checks that a binary was built by this repository's release workflow.

## As a uv dev dependency

Each release also has one wheel per platform with the binary inside, the way Ruff ships (glibc Linux, macOS and Windows; on Alpine use the binary). uv installs it like any other package, and `inwards` lands in the project's virtual environment:

```sh
TAG=v0.1.0-rc.1; VER=0.1.0rc1   # the release, and its Python version
uv add --dev "inwards @ https://github.com/SirCypkowskyy/inwards/releases/download/$TAG/inwards-$VER-py3-none-manylinux_2_17_x86_64.whl"
uv run inwards check
uvx --from "https://github.com/SirCypkowskyy/inwards/releases/download/$TAG/inwards-$VER-py3-none-manylinux_2_17_x86_64.whl" inwards --version   # one-off, no project
```

Pick the wheel for your platform: `manylinux_2_17_x86_64`, `manylinux_2_17_aarch64`, `macosx_13_0_arm64`, `macosx_13_0_x86_64` or `win_amd64`. For a team on several platforms, give uv one source per platform in `pyproject.toml`. List all five: on a platform no marker matches, uv falls back to PyPI, which holds only a placeholder until the first PyPI release.

```toml title="pyproject.toml"
[dependency-groups]
dev = ["inwards"]

[tool.uv.sources]
inwards = [
  { url = "https://github.com/SirCypkowskyy/inwards/releases/download/v0.1.0-rc.1/inwards-0.1.0rc1-py3-none-manylinux_2_17_x86_64.whl", marker = "sys_platform == 'linux' and platform_machine == 'x86_64'" },
  { url = "https://github.com/SirCypkowskyy/inwards/releases/download/v0.1.0-rc.1/inwards-0.1.0rc1-py3-none-manylinux_2_17_aarch64.whl", marker = "sys_platform == 'linux' and platform_machine == 'aarch64'" },
  { url = "https://github.com/SirCypkowskyy/inwards/releases/download/v0.1.0-rc.1/inwards-0.1.0rc1-py3-none-macosx_13_0_arm64.whl", marker = "sys_platform == 'darwin' and platform_machine == 'arm64'" },
  { url = "https://github.com/SirCypkowskyy/inwards/releases/download/v0.1.0-rc.1/inwards-0.1.0rc1-py3-none-macosx_13_0_x86_64.whl", marker = "sys_platform == 'darwin' and platform_machine == 'x86_64'" },
  { url = "https://github.com/SirCypkowskyy/inwards/releases/download/v0.1.0-rc.1/inwards-0.1.0rc1-py3-none-win_amd64.whl", marker = "sys_platform == 'win32'" },
]
```

No marker tells glibc from musl, so on Alpine `uv sync` stops with "incompatible platform"; use the binary there.

!!! warning "While the repository is private"
    GitHub serves a private repository's release files only through its API, which uv can't call, so these URLs return 404 even with a token. Download the wheels with the GitHub CLI and tell uv to look in that folder. uv then picks the wheel for each platform:

    ```sh
    gh release download v0.1.0-rc.1 --repo SirCypkowskyy/inwards --pattern '*.whl' --dir wheels
    ```

    ```toml title="pyproject.toml"
    [tool.uv]
    find-links = ["wheels"]
    prerelease = "allow"
    ```

    ```sh
    uv add --dev inwards
    uv run inwards --version
    ```

`inwards --version` prints the release it was built from without the pre-release suffix (`0.1.0` for `0.1.0rc1`).

Once Inwards is on PyPI ([#32](https://github.com/SirCypkowskyy/inwards/issues/32)), this becomes `uv add --dev inwards`.

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

`All clear` with exit code 0 means every import points inward. Exit code 1 lists each violation with numbered fix steps, and exit code 2 is a usage or config error.

### On an existing codebase

A codebase that already breaks its layers fails the first check. To adopt Inwards anyway, accept what is there today and block only new violations:

```sh
inwards baseline
git add inwards-baseline.json
```

`inwards baseline` checks the whole project and writes every violation to `inwards-baseline.json` next to `pyproject.toml`. Commit it: `inwards check`, the agent hooks and CI all read it. An accepted import can move to another line and still pass, because entries match by rule, module and message. A second copy of it in the same module fails. When a whole-project check finds that accepted violations are gone, it says so. Run `inwards baseline` again to drop them. With `--format json`, the summary counts both: `baselined` on every run, `resolved` on a whole-project one. Agents can't edit the file or run the command: the Claude Code hooks deny both, and the Stop gate fails a session that changed it.

Next, wire Inwards into your agent: [Claude Code](claude-code.md), [Aider](aider.md), or any agent that reads [AGENTS.md](agents-md.md).
