# :material-sitemap-outline: Architecture (C4)

This chapter describes Inwards with the [C4 model](https://c4model.com): system context (C1), containers (C2) and components (C3). The diagrams use Mermaid flowcharts in C4 notation, because Mermaid's native C4 syntax is still experimental and renders poorly.

!!! tip "Legend used in every diagram"
    :material-account: rounded nodes are people · cylinders are stored data · dashed boxes are planned.

## C1: System context

Who uses Inwards, and what does it talk to?

```mermaid
flowchart TB
    architect(["👷 Architect<br/><small>declares layers</small>"])
    dev(["🧑‍💻 Developer<br/><small>writes and reviews code</small>"])
    agent(["🤖 AI coding agent<br/><small>Claude Code, Aider, Copilot, Codex</small>"])

    inwards["<b>Inwards</b><br/><small>Checks imports in a Python codebase<br/>against declared architecture layers</small>"]

    repo[("Python codebase<br/><small>*.py + pyproject.toml</small>")]
    editor["VS Code<br/><small>shows diagnostics</small>"]
    ci["CI runner<br/><small>GitHub Actions</small>"]
    scanning["GitHub code scanning<br/><small>ingests SARIF</small>"]

    architect -- "writes [tool.inwards]" --> repo
    agent -- "edits files; its hooks run inwards" --> inwards
    dev -- "types in" --> editor
    editor -- "LSP" --> inwards
    ci -- "runs inwards check --format sarif" --> inwards
    inwards -- "reads" --> repo
    ci -- "uploads SARIF" --> scanning
    inwards -. "JSON diagnostics with fix steps" .-> agent

```

A few things this picture commits us to:

- Inwards only **reads** the codebase. It never edits code. Autofix is left to the agent, which has the context to do it well.
- It needs no network, no Python interpreter and no import of user code. That rules out the `find_spec` approach pytest-archon uses and keeps runs deterministic.
- The agent is a first-class user, on par with the developer. The output format is designed for it first (see [chapter 4](04-AI-Integration.md)).

## C2: Containers

What gets deployed or installed, and where does each piece run?

```mermaid
flowchart TB
    agent(["🤖 AI agent"])
    dev(["🧑‍💻 Developer"])

    subgraph dist["Inwards"]
        cli["<b>inwards CLI</b><br/><small>TypeScript, compiled with bun build --compile<br/>single binary per OS/arch</small>"]
        lsp["<b>Language server</b><br/><small>TypeScript on Node, bundled in the extension</small>"]
        ext["<b>VS Code extension</b><br/><small>LSP client, starts the server</small>"]
        core["<b>Engine</b> @inwards/core<br/><small>TypeScript library + tree-sitter WASM<br/>no I/O</small>"]
        hooks["<b>Agent kit</b><br/><small>inwards init --agent: hooks,<br/>AGENTS.md section, aider lint-cmd</small>"]
        state[("Session state + run log<br/><small>.inwards/state, runs.jsonl</small>")]
        cache[("Cache<br/><small>.inwards/cache</small>")]
    end

    config[("pyproject.toml<br/><small>[tool.inwards]</small>")]
    src[("Python sources")]
    vscode["VS Code"]

    agent -- "hook runs" --> cli
    hooks -. "installs hooks for" .-> agent
    dev --> vscode --> ext -- "stdio / IPC" --> lsp
    cli -- "embeds" --> core
    lsp -- "bundles" --> core
    cli -- "reads" --> config
    cli -- "reads" --> src
    lsp -- "reads" --> config
    cli -- "reads/writes (hook)" --> state
    cli -. "reads/writes" .-> cache

    classDef planned stroke-dasharray:5 5
    class cache planned
```

| Container | Tech | Lives in | Status |
|---|---|---|---|
| **Engine** | TypeScript, `web-tree-sitter` 0.27 + `tree-sitter-python` 0.25 (WASM) | `src/core` | :white_check_mark: INW000, INW001, INW002, INW003, INW004, INW005, INW006, INW007, INW008, INW010, INW011 |
| **CLI** | Bun 1.4 single-file executable, 6 targets, also wrapped in 5 platform wheels | `src/cli` | :white_check_mark: `check` (text/concise/json/sarif), `init` (agents, style presets, scaffold), `hook claude-code` |
| **Language server** | `vscode-languageserver` 10 on Node | `src/vscode-extension/src/server/server.ts` | :white_check_mark: every per-file rule, on each change to an open file and when a file or directory that could be a module is created or deleted; with a fresh engine when `pyproject.toml` changes; INW007 and INW008 for the whole workspace from a directory listing |
| **VS Code extension** | `vscode-languageclient` 10 | `src/vscode-extension/src/client/extension.ts` | :white_check_mark: `.vsix` on each release, :material-progress-clock: Marketplace ([#64](https://github.com/SirCypkowskyy/inwards/issues/64)) |
| **Agent kit** | Generated hook config and markdown | `src/cli/src/init/` | :white_check_mark: `init --agent` for `claude`, `aider` and `agents-md` |
| **Session state and run log** | JSON and JSON Lines files, local only | `.inwards/state/`, `.inwards/runs.jsonl` | :white_check_mark: (run log opt-in, [chapter 8](08-Run-Log.md)) |
| **Cache** | Content-hash keyed import lists | `.inwards/cache` | :material-progress-clock: [#56](https://github.com/SirCypkowskyy/inwards/issues/56) |

The engine is the only place rules live. The CLI and the language server are adapters: they find files, read them, load the grammars and pick an output format. That split is why an editor squiggle and a CI failure can't disagree. They run the same function on the same text.

!!! warning "One engine, two runtimes"
    The CLI runs the engine on Bun. The language server runs it on Node inside the VS Code extension host. A single call to a Bun-only API inside `src/core/src` would pass every test (tests run on Bun) and then break the extension at runtime. The rule is enforced by lint, not by memory: `biome.jsonc` turns on `noRestrictedGlobals` for `src/core/src/**` and rejects `Bun` and `Deno` with a message pointing at the `GrammarBinaries` port. CI also bundles the extension for the `node` target on every push.

## C3: Components of the engine

The engine is a hexagon in miniature. It gets bytes and text in and returns plain data, and it never touches the disk. The grammars come in as a port (`GrammarBinaries`), so the Bun binary can hand over embedded blobs while the VS Code server reads them from its install folder.

```mermaid
flowchart LR
    subgraph driving["Driving side (adapters call in)"]
        files["SourceFile[]<br/><small>path, module, text</small>"]
        pfiles["ProjectFiles<br/><small>probe, listing, reader</small>"]
        cfgtext["pyproject.toml text"]
        wasm["GrammarBinaries<br/><small>runtime + python .wasm</small>"]
    end

    subgraph enginebox["Engine: @inwards/core"]
        config["<b>Config parser</b><br/><small>config/parse.ts<br/>smol-toml, validation</small>"]
        pre["<b>Import skeleton prescan</b><br/><small>python/prescan.ts<br/>blanks non-import lines</small>"]
        parser["<b>Parser adapter</b><br/><small>python/parser.ts<br/>web-tree-sitter</small>"]
        extract["<b>Import extractor + resolver</b><br/><small>python/parser.ts<br/>relative → absolute</small>"]
        rules["<b>Rules</b><br/><small>meta/registry.ts: registry<br/>rules/: one per rule<br/>layer-dependency: INW001<br/>context-independence: INW002<br/>public-api-only: INW003<br/>import-cycles: INW004<br/>pure-domain: INW005<br/>unassigned-module: INW006<br/>package-shape: INW007 + INW008<br/>suppression-comment: INW009<br/>unknown-first-party: INW010<br/>dynamic-import: INW011<br/>unsupported-encoding: INW000</small>"]
        fix["<b>Fix composer</b><br/><small>per-violation steps</small>"]
        report["<b>Reporters</b><br/><small>report/render.ts<br/>text · concise · json · sarif</small>"]
        engine["<b>Engine facade</b><br/><small>engine/engine.ts<br/>checkFile / checkFiles / check / index</small>"]
        modgraph["<b>Module index</b><br/><small>lookup/project-index.ts: first-party modules,<br/>importers on demand</small>"]
    end

    cfgtext --> config --> engine
    wasm --> parser
    files --> engine
    engine --> pre --> parser --> extract --> rules
    rules --> fix
    rules --> engine
    engine -. "confirm with full parse" .-> parser
    pfiles --> modgraph
    engine --> modgraph
    modgraph -. "imports of candidate files" .-> extract
    engine --> report
```

| Component | Responsibility | Notes |
|---|---|---|
| Config parser | Reads `[tool.inwards]`, validates it, and names the exact key that's wrong | Throws `ConfigError`. The CLI maps that to exit code 2. A [JSON Schema](guides/configuration.md#editor-completion) describes the same keys for editors, and tests keep the two equal |
| Import skeleton prescan | Keeps only import lines, dedents them, blanks the rest so line numbers stay put | Refuses the file when `import` shows up somewhere it can't account for, which forces a full parse. See [ADR-004](05-ADR.md#adr-004-parse-the-import-skeleton-confirm-with-a-full-parse) |
| Parser adapter | Initialises web-tree-sitter from bytes and parses | Frees every tree explicitly, because WASM memory isn't garbage collected |
| Import extractor | Finds `import` / `from ... import` nodes anywhere in the tree, resolves relative imports | `from shop import infrastructure` is recorded as `shop.infrastructure`, so it can't slip past |
| Rules | Pure functions from `(file, imports, config)` to `Diagnostic[]`. Code, name, default severity, summary and docs link of every rule live in one registry (`meta/registry.ts`); SARIF `rules[]` is built from it | INW001, INW005 for the libraries a layer may import, INW006 for code outside every layer, INW010 for first-party modules that don't exist, INW007/INW008 for package shape, INW011 for dynamic imports (literal targets, and unverifiable ones in inner layers), and INW000 for files whose encoding could hide imports. Planned rules are listed below |
| Fix composer | Builds numbered repair steps from the actual import and layer names | The steps name real modules, not placeholders |
| Reporters | Text for humans, `inwards/diagnostics@1` JSON for agents, SARIF 2.1.0 for GitHub | JSON fields may be added but never removed or renamed |
| Engine facade | Orchestrates prescan, rules and the confirming full parse | The only thing the adapters call. The package shape (INW007) is checked first, from the path alone. A file outside every layer isn't parsed (it gets at most an INW006 warning). A layered file whose text names a module loader skips the prescan (see below) |
| Module index | `Engine.index(files)` wraps the adapter's `ProjectFiles` port: `ownerOf` finds the first-party module an import lands in, probing one path at a time, each once; `modules` lists every first-party module; `importersOf` answers "who imports module X", parsing only files whose text mentions X's last name segment | The engine's project input ([#44](https://github.com/SirCypkowskyy/inwards/issues/44)): every adapter builds one and passes it to `checkFile` and `checkFiles`. Building it touches nothing; each question does only its own I/O, so the hook pays nothing for questions no rule asks. INW006 asks `ownerOf`; INW010 asks `ownerOf` whether a module exists and `listDir` what the package it would live in holds (compiled extensions, the closest names); cycle detection will use `importersOf`. A long-lived adapter rebuilds it when a file or directory is created, deleted or renamed |

### How one check flows

```mermaid
sequenceDiagram
    autonumber
    participant A as Adapter (CLI / LSP)
    participant E as Engine
    participant P as Prescan
    participant T as tree-sitter (WASM)
    participant R as Rules

    A->>E: checkFile({path, module, text}, index)
    alt file outside every layer and every context
        E-->>A: INW006 warning for its package, or [] (no parse)
    else declared encoding Inwards can't read
        E-->>A: INW000
    else file names a loader (importlib, runpy, builtins, __import__, exec, eval, compile)
        E->>T: parse(full text)
        E->>R: INW001 + INW002 + INW003 + INW005 + INW006 + INW010 + INW011
        R-->>E: diagnostics
        E-->>A: diagnostics
    else everything else
        E->>P: importSkeleton(text)
        alt skeleton accepted
            P-->>E: skeleton (imports only)
            E->>T: parse(skeleton)
            T-->>E: tiny tree
            E->>R: INW001 + INW002 + INW003 + INW005 + INW006 + INW010 (imports)
            alt no violations (the common case)
                R-->>E: []
                E-->>A: []
            else violations found
                E->>T: parse(full text)
                T-->>E: full tree
                E->>R: INW001 + INW002 + INW003 + INW005 + INW006 + INW010 (imports from full tree)
                R-->>E: confirmed diagnostics
                E-->>A: diagnostics
            end
        else skeleton refused (odd import placement)
            P-->>E: null
            E->>T: parse(full text)
            E->>R: INW001 + INW002 + INW003 + INW005 + INW006 + INW010
            R-->>E: diagnostics
            E-->>A: diagnostics
        end
    end
```

The prescan may report false positives, such as an import-shaped line inside a docstring, but it can never hide a real import, because it refuses any file it can't fully account for. The full parse is the source of truth, and it only runs when a violation needs confirming.

The skeleton keeps import statements only, so a file whose only outward dependency is `importlib.import_module("shop.infrastructure.db")` would pass it. Before the prescan runs, a text check looks for the names every loading call has to spell (`importlib`, `runpy`, `builtins`, `__import__`, or a bare `exec`, `eval` or `compile`, after NFKC). A file in a layer that matches goes straight to the full parse, which also looks for dynamic imports. `re.compile` does not match. On the CPython 3.14 standard library, 209 of 1,921 files match. See [ADR-015](05-ADR.md#adr-015-check-literal-dynamic-imports-as-inw011).

The cost model has one bad case: a legacy codebase where most files already violate. Without a baseline, nearly every file pays for the skeleton parse and then the full parse, which is slower than parsing everything once. With one, the CLI hands the baseline's keys and counts (rule, module, message without the "Allowed direction" sentence) to the engine as data. The engine scans every file first. A module skips the confirming parse when every one of its files went through the skeleton, every skeleton finding is an error, and for each key the findings across the module's files (`order.py` and `order.pyi` are one module) are no more than the accepted copies. The skeleton never misses an import, and a finding depends only on the import's target, which both parses read alike. So the real findings are no more than the skeleton's, and the baseline would hide all of them after a full parse as well. The errors a check reports are the same with or without the skip; a test compares both on every pair of spellings (real import, docstring or string copy) in a `.py` and its `.pyi`. The counts can differ: a skipped module's false positives (an import-shaped line in a docstring) are hidden along with its real findings, so `baselined` can be higher and `resolved` lower than after a full parse, for example when a fixed violation's import still sits in a string. On the synthetic repo in legacy mode (`bench/generate.py --legacy`: 2,101 files, each of the 2,000 modules with one violation, all baselined), a cold `inwards check` took a median of 3.05 s before this change and 0.55 s after. A bare full parse of every file took 2.0 to 3.1 s, and the clean repo 0.47 s (one core).

## C3: Components of the CLI

```mermaid
flowchart LR
    argv["argv"] --> args["Arg parser<br/><small>node:util parseArgs</small>"]
    args --> find["Config discovery<br/><small>walks up to pyproject.toml<br/>with [tool.inwards]</small>"]
    find --> walk["File collector<br/><small>skips hidden dirs, venvs,<br/>node_modules (not inside layers)</small>"]
    walk --> mod["Module namer<br/><small>path → dotted name</small>"]
    gram["Grammar loader<br/><small>embedded .wasm via<br/>import ... with type: file</small>"] --> eng
    mod --> eng["Engine"]
    eng --> out["Reporter → stdout<br/>exit 0 / 1 / 2"]
    pool["Worker pool"]:::planned -.-> eng
    cache["Content-hash cache"]:::planned -.-> eng

    classDef planned stroke-dasharray:5 5
```

Exit codes follow Ruff: `0` clean (warnings allowed), `1` errors found, `2` usage or config error. Agents and CI scripts can branch on that without parsing output. In the JSON report, `summary.violations` counts errors and `summary.warnings` counts warnings. A whole-project run (no path arguments) also checks every layer prefix and shape selector against the modules it found (INW006, INW007) and the required members of every shaped package (INW008).

The other commands reuse the same pieces:

- `inwards hook claude-code` reads a Claude Code hook payload from stdin and dispatches on the event: SessionStart records the session state, PreToolUse runs the shape guard and the config guard, PostToolUse checks the edited file, and Stop runs the Stop gate over what the session changed. [Chapter 4](04-AI-Integration.md) describes each one.
- `inwards init --agent claude|opencode|aider|agents-md` computes every file change first, so `--dry-run` can print it as a diff and a second run changes nothing.
- `inwards init --style layered|clean|hexagonal [--scaffold]` writes a preset's `[tool.inwards]` (and an example package with the package shapes that fit it) only where nothing exists yet, then runs the check in process and prints the package as an annotated tree. On a terminal with no flags, a picker built on `@clack/prompts` asks instead; it is loaded with a dynamic import that the build puts in its own chunk ([ADR-020](05-ADR.md#adr-020-the-init-picker-uses-clackprompts-loaded-from-a-split-chunk)).

## Deployment and distribution

```mermaid
flowchart LR
    pr["Release PR merged<br/><small>release-please tags vX.Y.Z</small>"] --> cd["cd.yml on ubuntu-26.04<br/><small>bun build --compile × 6 targets,<br/>5 platform wheels, .vsix</small>"]
    rc["Hand-pushed rc tag<br/><small>v0.2.0-rc.1</small>"] --> cd
    cd --> verify["verify matrix<br/><small>linux x64/arm64/musl · macOS arm64/x64 · Windows x64<br/>each binary checks the example app,<br/>each wheel installs with uvx</small>"]
    verify --> art[("Draft GitHub Release<br/><small>binaries + wheels + .vsix + SHA256SUMS<br/>+ provenance attestations once the repo is public</small>")]
    art --> manual["Manual download<br/><small>CI images, pre-commit</small>"]
    art --> uvurl["uv add --dev with the wheel URL"]
    art -.->|"owner publishes it:<br/>pypi.yml"| testpypi["TestPyPI: inwards"]
    testpypi -.->|full releases| pypi["PyPI: inwards"]
    pypi -.-> dev["uv add --dev inwards"]
    art -.-> market["VS Code Marketplace"]

    classDef planned stroke-dasharray:5 5
    class testpypi,pypi,dev,market planned
```

Releases follow [ADR-016](05-ADR.md#adr-016-versions-and-releases-come-from-commit-types-via-a-release-pr): release-please keeps a release PR open, merging it tags the version and starts `cd.yml`, and the owner publishes the draft by hand. Publishing the draft starts `pypi.yml` once it is switched on (below). The Marketplace is [#64](https://github.com/SirCypkowskyy/inwards/issues/64).

Cross-compiling from one Linux runner is possible because the grammars are WASM, with no native addon to build per platform (see [ADR-002](05-ADR.md#adr-002-web-tree-sitter-wasm-not-native-bindings)). The verify matrix then runs each binary on its real OS, since cross-compiled output that was never executed hasn't been tested.

### Publishing to PyPI

`.github/workflows/pypi.yml` uploads a published release's wheels with trusted publishing ([ADR-021](05-ADR.md#adr-021-publish-the-release-wheels-to-pypi-from-their-own-workflow-with-trusted-publishing)). It builds nothing: it downloads the five wheels that `cd.yml` built, ran on every platform and attached to the release, checks them against the release's `SHA256SUMS` (and their build provenance, once the repository is public), and uploads them. PyPI trusts that one workflow file in one GitHub environment per index, so no token is stored anywhere, and only the two upload jobs can mint an OIDC token.

| Started by | TestPyPI | PyPI |
|---|---|---|
| Publishing a pre-release (its checkbox, or a tag with a suffix such as `-rc.1`), with `PYPI_PUBLISH` set | yes | no |
| Publishing a full release, with `PYPI_PUBLISH` set | yes | yes, after it |
| Manual run, `index: testpypi` | yes | no |
| Manual run from the release tag (`--ref vX.Y.Z`, which the `pypi` environment requires), `index: pypi`, with `PYPI_PUBLISH` set | yes | yes, after it |

A draft never starts it, a manual run refuses a draft, and pull requests never start it. Nothing is on either index yet.

**What actually stops an upload.** Every agent works under the owner's GitHub account, so anything on the GitHub side is within an agent's reach: the `PYPI_PUBLISH` variable, the environments, tags (no ruleset protects them) and manual runs. PyPI checks the repository, workflow file and environment of a run, not its ref or commit. The one gate an agent can't reach is the owner's pypi.org account, so the PyPI publisher is registered last, at go-live, and deleting it there stops every PyPI upload at once. `PYPI_PUBLISH` and the `pypi` environment's `v*` tag rule guard against mistakes, not against an agent.

**One-time setup, by the owner,** in this order, so no environment exists without its rules when a run first names it:

1. **Create the two environments** (Settings → Environments → New environment):
    - `testpypi`: under "Deployment branches and tags", choose "Selected branches and tags", then add the branch `develop` (for manual runs) and the tag pattern `v*` (for releases).
    - `pypi`: the tag pattern `v*` only, so it deploys only from a release tag. Add yourself under "Required reviewers" and leave "Prevent self-review" off, since you both publish and approve. GitHub offers required reviewers on a private repository only with GitHub Enterprise; if the option is missing, add it the day the repository goes public.

    The same with the GitHub CLI (drop `reviewers` and `prevent_self_review` if GitHub refuses them while the repository is private):

    ```sh
    R=SirCypkowskyy/inwards
    gh api -X PUT repos/$R/environments/testpypi --input - <<'EOF'
    {"deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}
    EOF
    gh api repos/$R/environments/testpypi/deployment-branch-policies -f name=develop -f type=branch
    gh api repos/$R/environments/testpypi/deployment-branch-policies -f name='v*' -f type=tag
    gh api -X PUT repos/$R/environments/pypi --input - <<EOF
    {"reviewers": [{"type": "User", "id": $(gh api users/SirCypkowskyy -q .id)}], "prevent_self_review": false,
     "deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}
    EOF
    gh api repos/$R/environments/pypi/deployment-branch-policies -f name='v*' -f type=tag
    ```

2. **Register a pending publisher on TestPyPI.** TestPyPI has its own accounts: sign up at [test.pypi.org](https://test.pypi.org/account/register/), verify the email and turn on 2FA. Then, under [Your account → Publishing](https://test.pypi.org/manage/account/publishing/), add a pending GitHub publisher:

    | Field | Value |
    |---|---|
    | PyPI Project Name | `inwards` |
    | Owner | `SirCypkowskyy` |
    | Repository name | `inwards` |
    | Workflow name | `pypi.yml` |
    | Environment name | `testpypi` |

    A pending publisher doesn't reserve the name; the first upload creates the project. Run step 3 soon after.
3. **Dry run on TestPyPI** with the published pre-release v0.1.0-rc.1, once `pypi.yml` is on `develop`. That tag predates the workflow, so the run starts from `develop`, which only the `testpypi` environment accepts:

    ```sh
    gh workflow run pypi.yml --repo SirCypkowskyy/inwards --ref develop -f tag=v0.1.0-rc.1 -f index=testpypi
    gh run watch --repo SirCypkowskyy/inwards \
      "$(gh run list --repo SirCypkowskyy/inwards --workflow pypi.yml -L 1 --json databaseId -q '.[0].databaseId')"
    ```

    [test.pypi.org/project/inwards/0.1.0rc1](https://test.pypi.org/project/inwards/0.1.0rc1/) should then list five wheels and render the README. Install it in a fresh project, on as many platforms as you can:

    ```sh
    cd "$(mktemp -d)" && uv init --bare --name testpypi-check
    uv add --dev "inwards==0.1.0rc1" --default-index https://test.pypi.org/simple/
    uv run inwards --version   # 0.1.0
    ```

    This spends the file names of 0.1.0rc1 on TestPyPI only; PyPI is untouched.
4. **Go live,** when the first release meant for PyPI is near:
    - Add a publisher to the existing PyPI project. `inwards` already exists on pypi.org (the 0.0.0 placeholder), so this is not a pending publisher: open [Manage `inwards` → Publishing](https://pypi.org/manage/project/inwards/settings/publishing/) and add a GitHub publisher with owner `SirCypkowskyy`, repository `inwards`, workflow `pypi.yml` and environment `pypi`.
    - Switch on publishing: `gh variable set PYPI_PUBLISH --body true --repo SirCypkowskyy/inwards`. `gh variable delete PYPI_PUBLISH` switches it off again.

Optional hardening: turn on immutable releases (Settings → General → Releases → "Enable release immutability"; the API reports the setting available and off for this repository). A published release's assets and tag can then no longer change, so a later run uploads the bytes that were published. It applies only to releases published after it is turned on, and doesn't protect a draft.

**At each release,** wait until `cd.yml`'s "Draft the GitHub Release" job has succeeded and the draft lists five `.whl` files and `SHA256SUMS`. Only then publish the draft (step 4 of the release in `AGENTS.md`). `cd.yml` refuses to attach files to a published release, so publishing early spends the version. Publishing starts `pypi.yml`: a full release goes to TestPyPI, then waits for your approval under the run's "Review deployments" before PyPI (when the `pypi` environment has a reviewer). Afterwards, `uv add --dev inwards` in a fresh project should install it. After the first release on PyPI, yank the 0.0.0 placeholder there (Manage → Releases → 0.0.0 → Options → Yank).

To put a pre-release on PyPI as well, run the workflow from its tag, which the `pypi` environment requires: `gh workflow run pypi.yml --repo SirCypkowskyy/inwards --ref v0.2.0-rc.1 -f tag=v0.2.0-rc.1 -f index=pypi`. PyPI never takes the same file name twice, so a version uploaded there is final; a re-run only fills in files a failed run missed.

## Known limitations

- One `root` per config. In a monorepo each Python package keeps its own `[tool.inwards]`. `inwards check` at a uv workspace root checks every member with its own config, and routes named paths to their nearest config; the hook and the Stop gate pick the nearest config per file ([ADR-035](05-ADR.md#adr-035-inwards-check-follows-uv-workspace-members-each-with-its-own-config)). Only uv workspaces are discovered: other monorepo layouts need a run per config, or named paths. Member globs match `*` inside one segment only, and `inwards baseline` takes one config per run.
- The language server reads only the `pyproject.toml` at the root of the first workspace folder, and it checks one open file at a time, so it doesn't report dead layer prefixes. Neither does `inwards check` with path arguments; only a whole-project run does. It reads the config again when `pyproject.toml` changes ([#163](https://github.com/SirCypkowskyy/inwards/issues/163)); a client that can't watch files reads it again only when it saves `pyproject.toml` itself. A config error pops up once and stays on `pyproject.toml` until it is fixed, with checking off meanwhile. A `pyproject.toml` that can't be read is a config error too, as in the CLI; when it isn't a file at all, only the popup shows. That diagnostic sits on the right line only for invalid TOML; for any other error (an unknown rule code, say) it sits on the first line, because the config's own checks name the key, not its line.
- Implicit namespace packages (no `__init__.py`) are named and their relative imports resolved as Python does. A module missing under one passes INW010 when another uv workspace member holds it (in its `src/`, else the member directory), when the site-packages of the project's `.venv` holds it, or when it sits directly inside a package `namespace-packages` lists ([#161](https://github.com/SirCypkowskyy/inwards/issues/161)). A virtualenv elsewhere isn't seen. The language server doesn't look in other members or the virtualenv.
- Layer membership is by module prefix only. Glob patterns (`shop.*.domain`) for vertical slices come with the config schema v2 ([#51](https://github.com/SirCypkowskyy/inwards/issues/51), [ADR-018](05-ADR.md#adr-018-package-selectors-take-globs-from-the-start-monorepos-follow-uv-workspaces)).
- Symlinks: a symlinked directory inside a layer that points outside the project isn't checked ([#83](https://github.com/SirCypkowskyy/inwards/issues/83)), and a symlinked alias inside one layer that points into another can hide an outward import ([#84](https://github.com/SirCypkowskyy/inwards/issues/84)).
- INW011 resolves a dynamic import only when its target is a constant string. Any other target is reported as unverifiable, and only in layers that have an outer layer ([ADR-026](05-ADR.md#adr-026-report-unreadable-dynamic-import-targets-in-inner-layers)). Known gaps:
    - constants are folded only within bounds ([#79](https://github.com/SirCypkowskyy/inwards/issues/79)): a module-level name counts only when the whole file binds it once and the file has no `exec`, `eval`, namespace writer or wildcard import, and `%`, `format` and f-string folding stop at anything but `%s`, `!s` and a string format spec. Anything else is unverifiable;
    - `compile` with a non-literal source is not reported, since running its code object takes `exec` or `eval`, which are; a code object run another way (`types.FunctionType`) is missed;
    - in the outermost layer an unverifiable call is not reported, so it can reach first-party code outside every layer (INW006) unseen;
    - a loader stored in a container, reached through `operator.attrgetter` or passed in as an argument is missed, and so are `SourcelessFileLoader`, `ExtensionFileLoader` and `importlib.util.spec_from_loader`. A file loader is read only from a relative `.py` path, and a `functools.partial` only where its arguments are bound;
    - a false positive of following scopes loosely: an attribute name assigned a loader anywhere in the file (`self.load = importlib.import_module`) counts on every object in that file;
    - a false positive, accepted over a miss: for a literal source, `exec`, `eval`, `compile` and `__import__` always count as the builtins, so after `from re import compile`, `compile("from shop.infrastructure import x")` is reported. Bytes that CPython rejects before running them (a UTF-8 BOM with another declared encoding, a `utf-16` or `rot13` declaration) are still read or reported as unchecked;
    - a false negative, accepted over noise: a bare `exec` or `eval` with a computed source is skipped only when the code surely rebinds that name at the call. The binding must be a `def`, `class`, plain assignment or import placed directly in the module body (before the top-level statement holding the call) or in the body of a function that encloses the call, a parameter of a function or lambda whose body holds the call, or a `for` target inside its loop. The exemption is off for the whole file when any binding of the name could be the builtin: an assignment, walrus, `for`, `with` or `except` target, or parameter default that mentions a loader; a `def` or `class` whose decorators or class arguments (bases, `metaclass=`) mention one; an import from `builtins`, `importlib`, `runpy`, a relative module or a first-party module (any of which may re-export the builtin). It is also off when the name has a `global`, `nonlocal` or `del`, or when the file has a wildcard import or names `globals`, `vars`, `locals`, `setattr`, `delattr`, `__dict__`, `__builtins__` or `sys.modules`. So `def eval(model, loader)` in training code isn't reported. It still misses the builtin passed in as an argument (`def run(exec, c): return exec(c)` called as `run(exec, code)`) and a builtin reached through an object that names neither a loader, `__self__`, `__globals__` nor a namespace writer. The same check guards `exec(compile("<literal>", ...))`, which is trusted only while `compile` isn't rebound;
    - accepted false positives of that conservative check: a comprehension variable (`[eval(m) for eval in evaluators]`), a method name used inside its own class body, and a `match` capture named `eval` or `exec` are still reported.
- INW010 checks only the module part of a static import ([ADR-025](05-ADR.md#adr-025-inw010-probes-the-disk-for-existence-and-checks-only-the-module-part-of-an-import)): `from shop.domain import pricing` passes when `shop/domain` is a package, since `pricing` could be a name its `__init__.py` defines, and dynamic imports aren't checked. A module generated at build time passes when `generated` covers it, as protoc's `*_pb2` and `*_pb2_grpc` and the `_version` module are by default ([ADR-029](05-ADR.md#adr-029-generated-modules-pass-inw010-protoc-and-version-modules-by-default)); any other one is reported until it exists in the checkout, and so is an optional import behind `try/except ImportError`. A hallucinated import whose name a `generated` pattern covers passes too. The other rules still see a generated module that isn't on disk as missing: INW001 goes by name and reports an outward import either way, and INW006 judges the import by the nearest package that exists, so a generated module directly in the package above the layers (`shop._version`, imported from a layer) gets an INW006 error worded differently with and without the file, and a baseline entry taken in one checkout doesn't match in the other. A generated top-level package with no committed `__init__.py` looks third-party to every rule. The language server doesn't notice an `__init__.py` that starts extending its `__path__` until a file is created or deleted.
- Modules that belong to no layer get no layer rule. INW006 makes that visible (a warning per package, an error for an import into one from a layer, and dead prefixes), but the imports inside an unassigned package aren't checked against the layers until the user assigns it. Once [contexts](guides/configuration.md#contexts) are declared, every module's imports are checked against them (INW002, INW003), and INW000 applies to every file. Sourceless modules, `ignore` depth, renamed top-level packages and path-scoped prefix checks are open in [#86](https://github.com/SirCypkowskyy/inwards/issues/86).

## Rule catalogue

Each shipped rule has its own page under [Rules](rules/index.md), with examples, fixes and configuration; diagnostics link to it.

| Code | Name | What it catches | Status |
|---|---|---|---|
| INW000 | `unsupported-encoding` | A file in a layer declares an encoding (PEP 263) such as `unicode_escape` or `utf-7`, under which text Inwards reads as a comment can be a real import to CPython. The file is reported, not skipped | :white_check_mark: |
| INW001 | `layer-dependency` | An inner layer importing an outer one | :white_check_mark: |
| INW002 | `context-independence` | A bounded context or vertical slice importing another context its `depends-on` doesn't declare, static or dynamic, whether or not a layer owns the file. Either end outside every context is left alone, and a nested context is a context of its own. See [contexts](guides/configuration.md#contexts) | :white_check_mark: |
| INW003 | `public-api-only` | An import, from outside a context (another context or none), of one of its modules that isn't at or under its `public` prefixes, static or dynamic. An import INW002 already reports gets no INW003. The fix names the public module that exposes the imported name, when one does | :white_check_mark: |
| INW004 | `import-cycles` | Modules (`cycles = ["modules"]`) or contexts (the default, `["contexts"]`) that import each other in a cycle, reported once per strongly connected group with the full path and the group's size. Whole-project runs only, from the imports the check already reads; a file in a cyclic group whose skeleton could misread an import is confirmed with a full parse. Not suppressible inline; the baseline accepts existing cycles. See [ADR-032](05-ADR.md#adr-032-import-cycles-on-whole-project-runs-from-the-imports-the-check-already-reads) | :white_check_mark: |
| INW005 | `pure-domain` | A layer importing a third-party or standard-library module its `allow-libraries` / `deny-libraries` / `extend-deny-libraries` don't let it use, static or dynamic, in functions and behind `TYPE_CHECKING` too. The innermost of two or more layers denies frameworks, database and network clients and stdlib I/O (`sqlalchemy`, `fastapi`, `requests`, `subprocess`...) by default; `extend-deny-libraries` adds to that list, `deny-libraries` replaces it. First-party code is left to INW001 and INW006. See [Libraries per layer](guides/libraries.md) | :white_check_mark: |
| INW006 | `unassigned-module` | An import from a layer into first-party code that belongs to no layer, including the package above the layers (`from shop import x` runs `shop/__init__.py`, which no layer owns), static or dynamic (error); layer code moved out of every layer during a session (error); a package outside every layer and `ignore` (warning); a layer prefix matching no module (warning), a layer with no live prefix, or a prefix emptied during the session (error). Unknown keys and overlapping prefixes are config errors | :white_check_mark: |
| INW007 | `package-shape` | A package member its `[[tool.inwards.shape]]` doesn't allow (error, or a warning with `extra = "warning"`) or forbids, such as a new `helpers.py` next to `service.py`; a member name outside its `[[tool.inwards.names]]` `only-in` packages, such as `test_x.py` in the app (error); a shape selector that matches no package (warning, in pyproject.toml). The message never lists the allowed members; the fix names the likely target. See [Package shape](guides/package-shape.md) | :white_check_mark: |
| INW008 | `missing-member` | A member the package's shape requires is missing, reported on its `__init__.py`. Whole-project runs report every one; the Stop gate blocks only those new since the session started | :white_check_mark: |
| INW009 | `suppression-comment` | An inline suppression, `# inwards: ignore[INW001] reason="..."`, that hides nothing: malformed, without a reason, or naming a code that is unknown or can't be suppressed (INW000, INW004, INW007, INW008, INW009) (error); one with a code that matches no finding on its line (warning). See [ADR-028](05-ADR.md#adr-028-inline-suppressions-need-a-reason-and-an-agent-cant-add-one-by-default) | :white_check_mark: |
| INW010 | `unknown-first-party` | A static import, in a layer, of a first-party module that doesn't exist, the typical agent hallucination (`from shop.domain.pricing import X` with no `pricing`), and a relative import that climbs above the top-level package, which Python always refuses. The module part is checked: `X` of `from X import name`, the whole name otherwise. Existence is probed on disk, so namespace packages, stubs and compiled extensions (`.so`, `.pyd`, `.pyx`) count; the fix lists the three closest modules in the same package. Such an import gets no INW006 as well, and an outward import INW001 reports gets no INW010. Packages that extend their `__path__` are skipped, and so are modules a build step writes (`generated`, by default `*_pb2`, `*_pb2_grpc` and `_version`, [ADR-029](05-ADR.md#adr-029-generated-modules-pass-inw010-protoc-and-version-modules-by-default)). See [ADR-025](05-ADR.md#adr-025-inw010-probes-the-disk-for-existence-and-checks-only-the-module-part-of-an-import) | :white_check_mark: |
| INW011 | `dynamic-import` | A dynamic import with a string-literal target that reaches an outer layer: `importlib.import_module`, `__import__` (also `builtins.` and `importlib.`), `runpy.run_module`, and import statements inside literal `exec` / `eval` / `compile` source (bytes whose declared encoding Inwards can't read are reported as unchecked). Import aliases, `name = loader` assignments, `getattr(m, "name")`, `m.__dict__["name"]` and `vars(m)["name"]` are followed; `+` between literals and f-strings with literal fields are folded. In every layer but the outermost, a target Inwards can't read is reported as unverifiable: a variable, an f-string field, a `\N{...}` escape, an argument hidden behind `*args` or `**kwargs`, a relative `import_module` whose `package` isn't known, `exec` or `eval` of a non-literal source ([ADR-026](05-ADR.md#adr-026-report-unreadable-dynamic-import-targets-in-inner-layers)). A common way to dodge INW001. Known gaps are listed above | :white_check_mark: |
| FAPI001 | `endpoint-metadata` | Opt-in. A FastAPI path operation without the OpenAPI metadata the project requires. Registered; checks in [#183](https://github.com/SirCypkowskyy/inwards/issues/183) | :material-progress-clock: |
| FAPI002 | `undocumented-error-response` | Opt-in. A FastAPI path operation that can produce an error status code its OpenAPI entry doesn't declare. Registered; checks in [#183](https://github.com/SirCypkowskyy/inwards/issues/183) | :material-progress-clock: |
| FAPI003 | `router-wiring` | Opt-in. An `APIRouter` no app includes, or routers that include each other in a cycle. Registered; checks in [#184](https://github.com/SirCypkowskyy/inwards/issues/184) | :material-progress-clock: |

The FAPI rules ([ADR-037](05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)) read one shared model, `rules/fastapi/model.ts`: apps and routers, path operations, `include_router` and `mount` edges and exception handlers, from one parse per file that mentions FastAPI, with names resolved across files through `ProjectIndex`. FAPI004 is reserved for the [#185](https://github.com/SirCypkowskyy/inwards/issues/185) spike, and FAPI005 to FAPI009 are planned ([rules index](rules/index.md#fastapi)).

## Code map

```text
src/
├── core/                  # engine, no I/O; src/core/AGENTS.md explains the rules
│   ├── src/
│   │   ├── index.ts       # the public API adapters import (pinned by test/api.test.ts)
│   │   ├── contracts/     # records.ts: SourceFile, ImportRef, Diagnostic, Fix, Span, Suppressed
│   │   ├── meta/          # product.ts (VERSION, DOCS_BASE), registry.ts (every rule's code,
│   │   │                  #   name, severity, docs link; diagnostic())
│   │   ├── config/        # [tool.inwards]: parse.ts, rule-settings.ts ([tool.inwards.rules]),
│   │   │                  #   shape.ts (shapes and names), generated.ts, glob.ts (fnmatch),
│   │   │                  #   source-span.ts (where a value sits in pyproject.toml), toml.ts
│   │   ├── python/        # parser.ts (tree-sitter, import extraction), module-names.ts,
│   │   │                  #   prescan.ts (import skeleton), encoding.ts (PEP 263),
│   │   │                  #   literals.ts, stdlib.ts
│   │   ├── lookup/        # project-index.ts (the engine's project input), module-lookup.ts,
│   │   │                  #   directory-listing.ts (the ListDir and ListMembers ports)
│   │   ├── rules/         # one module or folder per rule, named after it; they share only shared/
│   │   │   ├── shared/    # layer-ownership.ts (owning layer, outward imports, port steps),
│   │   │   │              #   edit-distance.ts
│   │   │   ├── unsupported-encoding.ts  # INW000
│   │   │   ├── layer-dependency.ts      # INW001 + fix composer
│   │   │   ├── context-independence.ts  # INW002: depends-on between contexts
│   │   │   ├── public-api-only.ts       # INW003: a context's public modules
│   │   │   ├── import-cycles/           # INW004: graph.ts (Tarjan, shortest cycle), cycles.ts
│   │   │   ├── pure-domain.ts           # INW005: libraries per layer, default deny list
│   │   │   ├── unassigned-module/       # INW006: imports.ts (code outside every layer),
│   │   │   │                            #   layout.ts (dead prefixes, layer code moved away)
│   │   │   ├── package-shape/           # INW007 + INW008: shape.ts, fix.ts (wording, likely target)
│   │   │   ├── suppression-comment.ts   # INW009: inline suppressions, what they hide
│   │   │   ├── unknown-first-party.ts   # INW010: first-party modules that don't exist
│   │   │   ├── dynamic-import/          # INW011: imports.ts, callees.ts (loaders through aliases),
│   │   │   │                            #   loader-targets.ts, computed-source.ts
│   │   │   └── fastapi/                 # FAPI family: model.ts (apps, routers, operations, wiring,
│   │   │                                #   handlers, resolved across files); rules in #183, #184
│   │   ├── baseline/      # accepted.ts: baseline keys, which findings a baseline accepts
│   │   ├── engine/        # engine.ts: the facade, rule precedence, the baseline shortcut
│   │   └── report/        # render.ts: text / concise / json / sarif
│   ├── scripts/           # prescan-diff.ts: the differential test
│   └── test/              # mirrors src/, plus api.test.ts and architecture.test.ts
├── cli/
│   ├── src/               # one folder per concern (#176); src/cli/AGENTS.md explains the rules
│   │   ├── main.ts        # composition root: argv, then a command with the wired adapters
│   │   ├── commands/      # check, baseline, stats, hook: thin, handed AppDeps
│   │   ├── claude-code/   # the hook adapter: dispatch, SessionStart, the PreToolUse config
│   │   │                  #   guard (Bash reader, edit simulation) and shape guard, PostToolUse, the Stop gate
│   │   │                  #   and its changed-file checks, escalation, settings
│   │   ├── session/       # the session record, start identity and content, old errors,
│   │   │                  #   agent suppressions, layout changes against the session start
│   │   ├── project/       # running a check, the baseline, config discovery, project snapshots
│   │   ├── runlog/        # the opt-in run log, reading it back, stats, --export
│   │   ├── init/          # inwards init: agents, --style, the scaffold plan, the report, presets
│   │   ├── paths/         # lexical path text, the physical meaning of `..`, display paths
│   │   ├── platform/      # the contracts for everything outside the process, and print()
│   │   ├── json/          # type guards for parsed JSON and TOML
│   │   └── adapters/      # node:fs, git, the environment, stdio, state and baseline files,
│   │                      #   the grammars, the picker; compose.ts wires them into AppDeps
│   └── test/              # mirrors src/, plus integration/ (E2E, docs, parity) and support/
└── vscode-extension/
    ├── src/
    │   ├── client/        # extension.ts (activation, starts the server), selector.ts
    │   └── server/        # server.ts (LSP), workspace.ts (INW007/INW008 pass), config-file.ts
    ├── scripts/           # copy-wasm.ts: grammars next to dist/server.js
    └── test/              # LSP harness and tests, packaged.test.ts on the built dist/
```

Outside `src/`: `scripts/` builds binaries and wheels and checks versions and the docs nav, `packaging/` holds the wheel README and the name placeholders, `eval/` is the agent eval harness, `bench/` generates the synthetic benchmark repo and compares two builds on it for the PR regression gate, and `examples/clean-app` is the app CI checks.
