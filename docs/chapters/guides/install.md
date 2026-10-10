# Install Inwards

!!! info "Verified 2026-09-25"
    The from-source build and every command after it, by hand on Linux x64. On macOS (arm64) and Windows, CI runs `init`, `check` and the hook with the compiled binary before each release; a by-hand check there is still open. The `curl` and `Invoke-WebRequest` steps can't be tried while the repository is private; `gh release download` works.

Inwards is one executable with no runtime to install. The latest release is the pre-release v0.1.0-rc.1; the first full release comes with a later milestone. You can also build from source.

## From a release

Each release on [GitHub Releases](https://github.com/SirCypkowskyy/inwards/releases) has one binary per platform, the platform wheels, the VS Code extension (`.vsix`) and `SHA256SUMS`. Build attestations are added once the repository is public.

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

    While the repository is private, GitHub answers these URLs with 404. Download with the GitHub CLI instead, then continue from the `sha256sum` line:

    ```sh
    gh release download "$VERSION" --repo SirCypkowskyy/inwards --pattern "$FILE" --pattern SHA256SUMS
    ```

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

Each release also has one wheel per platform with the binary inside, the way Ruff ships (glibc Linux, macOS and Windows; on Alpine use the binary). uv installs it like any other package, and `inwards` lands in the project's virtual environment.

### From PyPI (from the first PyPI release)

No release is on PyPI yet. Once one is, installing takes one line, and uv picks the wheel for each platform:

```sh
uv add --dev inwards
uv run inwards check
uvx inwards --version   # one-off, no project
```

Until then, `inwards` on PyPI is a 0.0.0 name placeholder: `--version` says the linter isn't released yet and every other command exits 2. Use the wheels from a GitHub release below. Releases reach PyPI through [trusted publishing](../03-Architecture-C4.md#publishing-to-pypi); the first one comes with a later milestone, not with v0.1.0-rc.1.

To wire an agent in such a project, pass `--launcher "uv run"` to `init` (`uv run inwards init --agent claude --launcher "uv run"`): the hooks and the `AGENTS.md` section then say `uv run inwards` and hold no path. Without it, `init` records the path of the binary it runs as, which in a project is inside `.venv` and differs per worktree, and under `uvx` is in uv's cache, which `init` warns about.

`uv add --dev inwards` takes the newest full release and skips pre-releases. To try a pre-release that is on PyPI, ask for it: `uv add --dev "inwards>=0.2.0rc1"`.

### From a GitHub release

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

### A new project: start from a preset

`inwards init --style` writes `[tool.inwards]` for a known architecture, and `--scaffold` adds a small example package that passes the check. uv creates the project; Inwards only adds the layers:

```sh
uv init --package app && cd app
inwards init --style hexagonal --scaffold
```

```text
inwards init: wrote the hexagonal preset to pyproject.toml and 14 example files.

src/app/  (hexagonal)
├── adapters/
│   ├── inbound/   inbound: may import domain, application; not its sibling outbound
│   └── outbound/  outbound: may import domain, application; not its sibling inbound
├── application/   application: may import domain
├── bootstrap.py   bootstrap: may import every other layer
└── domain/        domain: imports no other layer

inwards check: 0 violations, 0 warnings.

Try the example: uv run python -m app.bootstrap book 2
Wire an agent: inwards init --agent claude|opencode|aider|agents-md
```

Once Inwards is on PyPI ([#32](https://github.com/SirCypkowskyy/inwards/issues/32)), the second line becomes `uvx inwards init --style hexagonal --scaffold`, with nothing to install first.

Seven presets exist, each listed innermost first. `inwards init --list-styles` prints them with their packages.

| Style | Layers | What it can't forbid |
|---|---|---|
| `layered` | domain, persistence, services, presentation, bootstrap | presentation calling persistence directly (open layers) |
| `clean` | domain, application, infrastructure, presentation, bootstrap | presentation importing infrastructure |
| `hexagonal` | domain, application, outbound (`adapters.outbound`) and inbound (`adapters.inbound`) as [siblings](configuration.md#sibling-layers), bootstrap | an inbound adapter calling a port instead of a use case |
| `vertical-slices` | shared, features, bootstrap; each slice under `features` is a context whose public module is `api` | code only one slice uses moving into `shared` |
| `bounded-contexts` | `app.*` with the `context` template: domain, application, infrastructure, api inside each context; bootstrap | a context's `api` re-exporting its domain entities |
| `django` | `app.*` with the `django-app` template: models, services, views, urls inside each app; the package itself (settings, the root URLconf) | a view using the models instead of the services |
| `fastapi` | the package itself as the kernel; `app.*` with the `fastapi-domain` template: constants, exceptions and config, then models and schemas, utils, service, dependencies, router inside each domain; `app.main` | a router using the models directly instead of going through the service |

Each layer may import itself and the layers before it, so a layer-only config can't express the gaps in the last column; the table's comment names the gap. `bootstrap.py` is the composition root, the one module that sees every layer. In `hexagonal`, the inbound and outbound adapters share one place in the order, so neither may import the other.

The last four presets keep packages apart with [contexts](configuration.md#contexts), and describe the packages with a [template](configuration.md#templates):

- **`vertical-slices`** puts one package per feature under `app.features`, on a shared kernel `app.shared`. Each slice is a context: it imports another slice only when its `depends-on` names it ([INW002](../rules/INW002.md)), and then only that slice's `api` module ([INW003](../rules/INW003.md)), as does code outside every slice, such as `bootstrap.py`.
- **`bounded-contexts`** layers every package directly below `app` the same way, `app.*.domain` < `app.*.application` < `app.*.infrastructure` < `app.*.api`, through one template entry. Contexts cross only through `app.<ctx>.api`, and since `api` is the outermost role, a context reaches another from its own `api`.
- **`django`** layers every app below `app` as `models` < `services` < `views` < `urls`. The package itself is the outermost layer, for the settings, the root URLconf and app modules outside the roles, such as `admin.py` and `apps.py`. Apps are independent except through `services`: the preset turns INW002 off, so an app may use another's services without declaring it, and INW003 reports an import of any other module of another app. The innermost role gets `deny-libraries = []`, since models import `django.db`.
- **`fastapi`** is the [fastapi-best-practices](https://github.com/zhanymkanov/fastapi-best-practices) layout. Every package below `app` is a domain, layered by the `fastapi-domain` template as `constants | exceptions | config` < `models | schemas` < `utils` < `service` < `dependencies` < `router` (`|` marks [siblings](configuration.md#sibling-layers)). The package itself is the kernel, the innermost layer, for the shared modules (`config.py`, `models.py` with the base model, `exceptions.py`, `database.py`), with `deny-libraries = []` since they import pydantic and the database client. `app.main` builds the app and is the outermost layer. Other domains and `main.py` may import a domain's `router`, `service`, `schemas`, `dependencies`, `constants` and `exceptions`, never its `models`, `config` or `utils` (INW003); like `django`, it turns INW002 off. It also turns on every shipped [FastAPI rule](../rules/index.md#fastapi), FAPI001 to FAPI003 and FAPI005 to FAPI009, with `extend-select`, as warnings through a `[tool.inwards.rules.severity]` table with one line per rule (delete a line to report that rule at its own severity), and sets FAPI002's `report-direct-raises = false` so it doesn't repeat Ruff's `FAST004`. It turns on [INW012](../rules/INW012.md) the same way, with `delegate-to = ["domain.service"]`: an endpoint that calls nothing in its domain's `service` module, or does the work itself, gets a warning whose fix names `app.*.service`. The scaffold's `posts/router.py` passes: each endpoint calls `posts.service`, and `remove_post` gets the post through the `valid_post_id` dependency first. After the check, init prints the Ruff config that goes with it (`ASYNC`, `FAST`, `TID251`, with `pydantic.BaseModel` and `pydantic_settings.BaseSettings` banned outside the base module and `config.py` files); it never writes it. To get the layout exactly, with `src` as the package, run `inwards init --style fastapi --scaffold --package src` in a project without a `src/` directory.

The contexts table names each package, because a context's `modules` are literal prefixes. With `--scaffold`, init writes the entry for the scaffold's `orders` package (`posts` in `fastapi`); without it, the same entry is written commented out, as the example to copy for each package the project has. A package without an entry is not kept apart.

What `--style` writes and when it stops:

- **The table:** the layers, `root` (`src` for a src layout, else `.`), `required-version`, the default `ignore` list and a comment naming the preset and the Inwards version. The package comes from `[project].name`, normalised the way uv does it (`my-app` becomes `my_app`), or from `--package`; a Python keyword can't be one. Run below the project, init uses the nearest `pyproject.toml` above and says which. Before the package exists, `root` is `src` when the build backend is uv_build or `src/` already holds Python code.
- **It never rewrites layers.** If `[tool.inwards]` already exists, init exits 2 and writes nothing. Without a `pyproject.toml` it exits 2 and suggests `uv init --package`.
- **`--scaffold`** writes an entity, a port (`typing.Protocol`), a use case, an adapter that implements the port, a command-line driving adapter, the composition root and one test in `tests/`. In `vertical-slices` and `bounded-contexts` they sit in an `orders` package, behind an `api.py` that re-exports what the composition root needs. `django` writes an `orders` app (models, services, views, urls), `settings.py` and the root `urls.py` instead, with no test. `fastapi` writes a `posts` domain with a module for every role, the kernel's `config.py`, `models.py` and `exceptions.py`, and `main.py`, which includes the router and answers the kernel's `NotFound` with 404; every endpoint declares its summary, status code, response model and error responses, so the FastAPI rules find nothing. It has no test either; `uv add fastapi uvicorn pydantic-settings` makes it run. It never replaces anything: if a file or symlink is in the way, or a directory leads outside the project through a symlink, init exits 2, lists the paths and writes nothing. An existing `__init__.py`, such as the one uv creates, is left as it is. The files go first and `pyproject.toml` last; if a write fails, init removes what it created, so the same command can run again.
- **Package shapes come with `--scaffold`.** The table then also gets `[[tool.inwards.shape]]` entries ([Package shape](package-shape.md)) for the scaffold's packages, so the members are constrained too, not only the imports. The package itself may hold only its layer packages, `bootstrap.py`, `__main__.py` and `_version.py` (which hatch-vcs and setuptools-scm write), and in `hexagonal` `adapters/` holds only `inbound/` and `outbound/`: a module beside them would belong to no layer, so it is an INW007 error, and the shape guard ([INW007](../rules/INW007.md)) denies the Write that would create it. In `clean` and `hexagonal`, `application/` must hold `ports/` and `use_cases/`, and anything else there is only a warning. In `vertical-slices`, `features/` holds only slice packages and each slice must have `api`; in `bounded-contexts`, each context must have its four roles; in `django`, the package must hold `settings.py` and `urls.py`, and each app its four roles, with what `startapp` writes allowed beside them; in `fastapi`, the package must hold `main.py` and may hold only domains and the kernel's usual modules, and each domain must hold `__init__`, `router` and `service` and nothing outside the template's roles, an error since such a module would fall to the kernel layer. The layer packages themselves have no shape, so a new entity, adapter or use case never trips one. A required member that goes missing is an INW008 error. Without `--scaffold` no shapes are written, since they describe the scaffold's layout rather than the code a project already has. `inwards init --list-styles` shows each preset's shapes.
- **`--dry-run`** prints every change as a diff and writes nothing. **`--agent`** combines with `--style`: `inwards init --style clean --agent claude` writes the layers and the Claude Code hooks in one run. **`--brief`** also writes the [architecture brief](agents-md.md#the-architecture-brief-opt-in) into `AGENTS.md`, naming the preset and where its ports go.
- After writing, init runs the check in process and prints the tree above. Without `--scaffold`, each layer package is marked `(missing)` and fails the check until it has a module.

On a terminal, `inwards init` with neither `--style` nor `--agent` asks instead: the style (the highlighted one shows its layers), whether to scaffold, and which agent to wire. It ends by printing the same command with flags. Without a terminal (stdin or stdout isn't a TTY, or `CI` is set), it never waits for input: it exits 2 at once and lists the flags and the styles. Agents run init this way.

### Any project: write the table by hand

Add `[tool.inwards]` to the `pyproject.toml` of the project you want to check, innermost layer first:

<!-- e2e -->

```toml title="pyproject.toml"
[tool.inwards]
layers = [
  { name = "domain",         modules = ["shop.domain"] },
  { name = "application",    modules = ["shop.application"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]
```

Then check the whole project:

<!-- e2e -->

```sh
inwards check
```

`All clear` with exit code 0 means every import points inward. Exit code 1 lists each violation with numbered fix steps, and exit code 2 is a usage or config error.

### Coming from import-linter

`inwards import-config` converts the contracts in `.importlinter`, `setup.cfg` or `[tool.importlinter]` into `[tool.inwards]`, and `--write` appends the table to `pyproject.toml`. It reports each contract it couldn't carry over, with the reason. [Migrating from import-linter](import-linter.md) has the mapping.

### On an existing codebase

A codebase that already breaks its layers fails the first check. To adopt Inwards anyway, accept what is there today and block only new violations:

<!-- e2e -->

```sh
inwards baseline
git add inwards-baseline.json
```

`inwards baseline` checks the whole project under one config and writes every violation to `inwards-baseline.json` next to its `pyproject.toml`. Commit it: `inwards check`, the agent hooks and CI all read it. In a monorepo, run it once per package that has its own `[tool.inwards]` (`inwards baseline --config packages/api/pyproject.toml`), since each file is checked against the baseline next to its own config. An accepted import can move to another line and still pass, because entries match by rule, module and message, without the message's "Allowed direction" sentence, so adding a layer doesn't bring them back. A second copy of it in the same module fails. When a whole-project check finds that accepted violations are gone, it says so. Run `inwards baseline` again to drop them. With `--format json` and a baseline present, the summary counts both: `baselined` on every run, `resolved` on a whole-project one. Agents can't edit the file or run the command: the Claude Code hooks deny both, and the Stop gate fails a session that changed it and checks that session's files with no baseline at all.

Run it before you turn on the agent hooks, too. The Claude Code hooks already treat a violation that a file had at session start as context, not a block ([chapter 4](../04-AI-Integration.md)), but a file with uncommitted changes that is too large for the hooks to keep a copy of (over 512 KiB, or past 4 MiB of such files) has no known start content, so all of its violations block, and an agent pushed to fix them may rewrite code its task didn't need. The baseline also keeps `inwards check` and CI green.

Once a project has a baseline, `stop-gate = "project"` in `[tool.inwards]` makes the Claude Code Stop gate check the whole project against it instead of only the files the session changed, so a violation anywhere blocks the turn ([chapter 4](../04-AI-Integration.md)). A check skips the confirming parse where the baseline accepts everything the prescan found, so a fully baselined check costs about as much as a clean one.

Next, wire Inwards into your agent: [Claude Code](claude-code.md), [OpenCode](opencode.md), [Aider](aider.md), or any agent that reads [AGENTS.md](agents-md.md). To fail pull requests that break a layer, add the [GitHub Actions](ci.md) workflow.
