# Install Inwards

!!! info "Verified 2026-10-11"
    With 0.5.0 on macOS (arm64): `uvx inwards@0.5.0 --version`; `uv add --dev inwards`, then `uv run inwards init --style layered` and `uv run inwards check`; `uvx inwards init --style hexagonal --scaffold` in a new `uv init --package` project; and the `curl` download with its checksum and `gh attestation verify`. The from-source build by hand on Linux x64 on 2026-09-25. On Windows, CI runs `init`, `check` and the hook with the compiled binary before each release; a by-hand check there is still open. The VS Code extension on 2026-10-10: a platform VSIX installed in VS Code 1.141 on macOS (arm64) showed INW007, checked with `src/vscode-extension/scripts/try-in-vscode.ts`; Linux and Windows are still open.

Inwards is one executable with no runtime to install. Every release goes to [PyPI](https://pypi.org/project/inwards/) as platform wheels and to [GitHub Releases](https://github.com/SirCypkowskyy/inwards/releases) as binaries; the [changelog](https://github.com/SirCypkowskyy/inwards/blob/main/CHANGELOG.md) lists what each one changed. In a Python project, uv is the shortest way in. You can also build from source.

## As a uv dev dependency

Each release has one wheel per platform on PyPI with the binary inside, the way Ruff ships (glibc Linux, macOS and Windows; on Alpine use the [binary](#from-a-release)). uv picks the wheel for each platform, and `inwards` lands in the project's virtual environment:

```sh
uv add --dev inwards
uv run inwards init --style layered   # write the layers: see "Configure the layers" below
uv run inwards check
```

`uv add` writes a lower bound such as `inwards>=0.5.0` to `pyproject.toml` and the exact version to `uv.lock`, so everyone on the project runs the same release until someone runs `uv lock --upgrade-package inwards`. `pip install inwards` works too.

To try Inwards without adding it to a project, or to set up a new one, run it with `uvx`. It keeps a copy in uv's cache and adds nothing to the project:

```sh
uvx inwards --version
uvx inwards init --style hexagonal --scaffold
uvx inwards@0.5.0 check   # one exact release
```

To wire an agent in such a project, pass `--launcher "uv run"` to `init` (`uv run inwards init --agent claude --launcher "uv run"`): the hooks and the `AGENTS.md` section then say `uv run inwards` and hold no path. Without it, `init` records the path of the binary it runs as, which in a project is inside `.venv` and differs per worktree, and under `uvx` is in uv's cache, which `init` warns about.

`uv add --dev inwards` takes the newest full release and skips pre-releases. To try a pre-release that is on PyPI, ask for it: `uv add --dev --prerelease allow inwards`. `inwards --version` prints the release it was built from without the pre-release suffix (`0.2.0` for `0.2.0rc1`).

Releases reach PyPI through [trusted publishing](../03-Architecture-C4.md#publishing-to-pypi).

## From a release

Each release on [GitHub Releases](https://github.com/SirCypkowskyy/inwards/releases) has one binary per platform, the platform wheels, the VS Code extension (a `.vsix` per platform, [below](#vs-code)) and `SHA256SUMS`.

| Platform | File |
|---|---|
| Linux x64 | `inwards-linux-x64` (glibc) or `inwards-linux-x64-musl` (Alpine: `apk add libstdc++ libgcc` first) |
| Linux arm64 | `inwards-linux-arm64` |
| macOS Apple silicon | `inwards-darwin-arm64` |
| macOS Intel | `inwards-darwin-x64` |
| Windows x64 | `inwards-windows-x64.exe` |

The `latest/download` URLs below always point at the newest release; to pin one, use `releases/download/v0.5.0` instead.

=== "Linux / macOS"

    ```sh
    FILE=inwards-linux-x64   # pick your file from the table
    BASE=https://github.com/SirCypkowskyy/inwards/releases/latest/download
    curl -fLO "$BASE/$FILE"
    curl -fLO "$BASE/SHA256SUMS"
    sha256sum --check --ignore-missing SHA256SUMS   # macOS: shasum -a 256 --check --ignore-missing SHA256SUMS
    mkdir -p ~/.local/bin && install -m 755 "$FILE" ~/.local/bin/inwards
    inwards --version
    ```

    If `inwards` isn't found, add `~/.local/bin` to `PATH` in your shell profile (`export PATH="$HOME/.local/bin:$PATH"`).

=== "Windows (PowerShell)"

    ```powershell
    $File = "inwards-windows-x64.exe"
    $Base = "https://github.com/SirCypkowskyy/inwards/releases/latest/download"
    Invoke-WebRequest "$Base/$File" -OutFile inwards.exe
    Invoke-WebRequest "$Base/SHA256SUMS" -OutFile SHA256SUMS
    (Get-FileHash inwards.exe -Algorithm SHA256).Hash.ToLower()   # compare with the line for $File in SHA256SUMS
    .\inwards.exe --version
    ```

    Put `inwards.exe` in a folder on your `PATH`.

Each binary also has a build provenance attestation: `gh attestation verify <file> --repo SirCypkowskyy/inwards` checks that it was built by this repository's release workflow.

## From source

You need [Bun](https://bun.sh) 1.4.2 (the version in `.bun-version`).

```sh
git clone https://github.com/SirCypkowskyy/inwards && cd inwards
bun install
bun run build:cli bun-linux-x64          # or bun-darwin-arm64, bun-windows-x64, ...
mkdir -p ~/.local/bin && install -m 755 dist/inwards-linux-x64 ~/.local/bin/inwards
inwards --version
```

## In your editor

`inwards server` is a language server over stdio. An editor with an LSP client starts it and shows, for every file in the workspace, what `inwards check` reports there: the document you type in is checked on every change, and the whole workspace again on every save and whenever files are created or deleted. Each workspace folder uses its own `[tool.inwards]`, as `inwards check` run in that folder would ([ADR-041](../05-ADR.md#adr-041-inwards-server-runs-inwards-checks-own-code-the-extensions-node-server-stays-until-it-switches)). VS Code has an extension (below); [Neovim, Zed and Helix](editors.md) start the binary from their own config.

### VS Code

The extension is a thin client: it starts `inwards server` and shows what it reports ([ADR-043](../05-ADR.md#adr-043-the-vs-code-extension-bundles-the-binary-one-vsix-per-platform)). Each platform's package carries that platform's `inwards` binary, so nothing else needs installing.

| Platform | VS Code target | File on a release |
|---|---|---|
| Linux x64 | `linux-x64` | `inwards-vscode-linux-x64-<tag>.vsix` |
| Linux arm64 | `linux-arm64` | `inwards-vscode-linux-arm64-<tag>.vsix` |
| Alpine x64 | `alpine-x64` | `inwards-vscode-alpine-x64-<tag>.vsix` |
| macOS Apple silicon | `darwin-arm64` | `inwards-vscode-darwin-arm64-<tag>.vsix` |
| macOS Intel | `darwin-x64` | `inwards-vscode-darwin-x64-<tag>.vsix` |
| Windows x64 | `win32-x64` | `inwards-vscode-win32-x64-<tag>.vsix` |
| anything else | | `inwards-vscode-universal-<tag>.vsix`, no binary: put `inwards` on `PATH` or set `inwards.path` |

`.github/workflows/vscode-publish.yml` uploads these files to the Visual Studio Marketplace and Open VSX (for VSCodium, Cursor and other editors that use it) when the owner publishes a full release; the extension is on neither registry yet. Until then, install the file for your platform from a release:

```sh
code --install-extension inwards-vscode-darwin-arm64-vX.Y.Z.vsix
```

Settings:

| Setting | Default | What it does |
|---|---|---|
| `inwards.enable` | `true` | Run the checks. Off stops the language server. |
| `inwards.path` | `""` | The `inwards` executable to start. Empty: the bundled binary, else `inwards` on `PATH`. A bare name is looked up on `PATH`, a relative path resolves against the first workspace folder, and `~` and `${workspaceFolder}` are expanded. On Windows it must be an `.exe`. |

A change to either setting restarts the server, and so does **Inwards: Restart Server** in the command palette. To run the version a project pins with `uv add --dev inwards`, set `inwards.path` in the workspace settings to `${workspaceFolder}/.venv/bin/inwards` (`${workspaceFolder}\.venv\Scripts\inwards.exe` on Windows). In an untrusted workspace, VS Code ignores the workspace's value of `inwards.path`, so a cloned repository can't choose the program the extension starts; trust the folder or set the path in your user settings.

When no binary is found (a set `inwards.path` that points at nothing, or the universal package with nothing on `PATH`), the extension says so, with buttons to the setting and to this page, and starts nothing. The **Inwards** channel in the Output panel shows what the server writes to stderr.

## Configure the layers

### A new project: start from a preset

`inwards init --style` writes `[tool.inwards]` for a known architecture, and `--scaffold` adds a small example package that passes the check. uv creates the project; Inwards only adds the layers:

```sh
uv init --package app && cd app
uvx inwards init --style hexagonal --scaffold
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

Seven presets exist, each listed innermost first. `inwards init --list-styles` prints them with their packages.

| Style | Layers | What it can't forbid |
|---|---|---|
| `layered` | domain, persistence, services, presentation, bootstrap | presentation calling persistence directly (open layers) |
| `clean` | domain, application, infrastructure, presentation, bootstrap | presentation calling a port instead of a use case |
| `hexagonal` | domain, application, outbound (`adapters.outbound`) and inbound (`adapters.inbound`) as [siblings](configuration.md#sibling-layers), bootstrap | an inbound adapter calling a port instead of a use case |
| `vertical-slices` | shared, features, bootstrap; each slice under `features` is a context whose public module is `api` | code only one slice uses moving into `shared` |
| `bounded-contexts` | `app.*` with the `context` template: domain, application, infrastructure, api inside each context; bootstrap | a context's `api` re-exporting its domain entities |
| `django` | `app.*` with the `django-app` template: models, services, views, urls inside each app; the package itself (settings, the root URLconf) | a view using the models instead of the services |
| `fastapi` | the package itself as the kernel; `app.*` with the `fastapi-domain` template: constants, exceptions and config, then models and schemas, utils, service, dependencies, router inside each domain; `app.main` | a router using the models directly instead of going through the service |

Each layer may import itself and the layers before it, so a layer-only config can't express the gaps in the last column; the table's comment names the gap. `bootstrap.py` is the composition root, the one module that sees every layer. In `hexagonal`, the inbound and outbound adapters share one place in the order, so neither may import the other.

`clean` and `hexagonal` also turn on [INW014](../rules/INW014.md) with `extend-select`, as a warning through a `[tool.inwards.rules.severity]` line: a module in `application/ports/` may hold only ABCs and Protocols, and a method there only a docstring, `...`, `pass` or `raise NotImplementedError`. The rule's default scope, every module with a `ports` segment, already covers that package, so the preset sets no options for it. The scaffold's `OrderRepository` is a Protocol and passes. A concrete class or a method that does work in `application/ports/orders.py` gets a warning whose fix names the adapter layer, `infrastructure` in `clean` and `outbound` in `hexagonal`.

Both presets turn on [INW015](../rules/INW015.md) too, also as a warning: only `bootstrap.py` may import and build the driven adapters. Its `[tool.inwards.rules.construct-only-in]` table sets `role` to the adapter layer's package (`app.infrastructure` in `clean`, `app.adapters.outbound` in `hexagonal`) and `allowed-in` to `app.bootstrap`. The scaffold builds `InMemoryOrderRepository` in `bootstrap.py` only, so it passes. In `clean`, a presentation module that imports the repository gets a warning, which closes the gap this preset used to name. In `hexagonal`, inbound and outbound adapters are siblings, so INW001 already reports that import as an error and INW015 doesn't repeat it; INW015 still reports an adapter built through a re-export, such as one from the package's `__init__.py`.

The last four presets keep packages apart with [contexts](configuration.md#contexts), and describe the packages with a [template](configuration.md#templates):

- **`vertical-slices`** puts one package per feature under `app.features`, on a shared kernel `app.shared`. Each slice is a context: it imports another slice only when its `depends-on` names it ([INW002](../rules/INW002.md)), and then only that slice's `api` module ([INW003](../rules/INW003.md)), as does code outside every slice, such as `bootstrap.py`.
- **`bounded-contexts`** layers every package directly below `app` the same way, `app.*.domain` < `app.*.application` < `app.*.infrastructure` < `app.*.api`, through one template entry. Contexts cross only through `app.<ctx>.api`, and since `api` is the outermost role, a context reaches another from its own `api`.
- **`django`** layers every app below `app` as `models` < `services` < `views` < `urls`. The package itself is the outermost layer, for the settings, the root URLconf and app modules outside the roles, such as `admin.py` and `apps.py`. Apps are independent except through `services`: the preset turns INW002 off, so an app may use another's services without declaring it, and INW003 reports an import of any other module of another app. The innermost role gets `deny-libraries = []`, since models import `django.db`.
- **`fastapi`** is the [fastapi-best-practices](https://github.com/zhanymkanov/fastapi-best-practices) layout. Every package below `app` is a domain, layered by the `fastapi-domain` template as `constants | exceptions | config` < `models | schemas` < `utils` < `service` < `dependencies` < `router` (`|` marks [siblings](configuration.md#sibling-layers)). The package itself is the kernel, the innermost layer, for the shared modules (`config.py`, `models.py` with the base model, `exceptions.py`, `database.py`), with `deny-libraries = []` since they import pydantic and the database client. `app.main` builds the app and is the outermost layer. Other domains and `main.py` may import a domain's `router`, `service`, `schemas`, `dependencies`, `constants` and `exceptions`, never its `models`, `config` or `utils` (INW003); like `django`, it turns INW002 off. It also turns on every shipped [FastAPI rule](../rules/index.md#fastapi), FAPI001 to FAPI003 and FAPI005 to FAPI009, with `extend-select`, as warnings through a `[tool.inwards.rules.severity]` table with one line per rule (delete a line to report that rule at its own severity), and sets FAPI002's `report-direct-raises = false` so it doesn't repeat Ruff's `FAST004`. It turns on [INW012](../rules/INW012.md) the same way, with `delegate-to = ["domain.service"]`: an endpoint that calls nothing in its domain's `service` module, or does the work itself, gets a warning whose fix names the service module of its own domain, such as `app.posts.service` for an endpoint in `app/posts/router.py`. The scaffold's `posts/router.py` passes: each endpoint calls `posts.service`, and `remove_post` gets the post through the `valid_post_id` dependency first. [INW013](../rules/INW013.md) is on as a warning too, in every module: an `async def` endpoint or dependency that calls a sync SQLAlchemy `Session`, redis-py, boto3 or a DB-API driver blocks the event loop. The scaffold keeps its posts in memory, so nothing in it blocks; with a database, await an `AsyncSession` in the `async def` endpoints, or make them plain `def`, which FastAPI runs in a threadpool. The template's `rules` table turns on [INW016](../rules/INW016.md) for every domain's `models` as a warning (`models = { orm-naming = "warning" }`): fastapi-best-practices' [naming conventions](https://github.com/zhanymkanov/fastapi-best-practices#set-db-naming-conventions), singular lower_case_snake table names, `_at` for datetime columns and `_date` for date columns, and, once the project has SQLAlchemy tables, a `MetaData(naming_convention=...)` (put it in the kernel's `database.py`). The scaffold's `Post` is a dataclass, so INW016 has nothing to check until you add tables. A [`deny`](configuration.md#rules) entry in `[tool.inwards.rules.pure-domain]` keeps `fastapi` and `starlette` out of every domain's `models`, `schemas`, `utils` and `service` (INW005, an error): the service raises the domain's exceptions, and only `dependencies` and `router` deal in HTTP, so `from fastapi import HTTPException` in `posts/service.py` is one INW005 finding. INW005 is on by default, and a template's `rules` table takes only opt-in rules, so the deny is a top-level entry with one selector per role (`app.*.service`). After the check, init prints the Ruff config that goes with it (`ASYNC`, `FAST`, `TID251`, with `pydantic.BaseModel` and `pydantic_settings.BaseSettings` banned outside the base module and `config.py` files); it never writes it. To get the layout exactly, with `src` as the package, run `inwards init --style fastapi --scaffold --package src` in a project without a `src/` directory.

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
