# :material-sitemap-outline: Architecture (C4)

This chapter describes Inwards with the [C4 model](https://c4model.com): system context (C1), containers (C2) and components (C3). The diagrams use Mermaid flowcharts in C4 notation, because Mermaid's native C4 syntax is still experimental and renders poorly.

!!! tip "Legend used in every diagram"
    :material-account: rounded nodes are people · purple boxes are parts of Inwards · grey boxes are external systems · dashed boxes are planned.

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
    agent -- "edits files, then runs inwards check (hook)" --> inwards
    dev -- "types in" --> editor
    editor -- "LSP" --> inwards
    ci -- "runs inwards check --format sarif" --> inwards
    inwards -- "reads" --> repo
    ci -- "uploads SARIF" --> scanning
    inwards -. "JSON diagnostics with fix steps" .-> agent

    classDef person fill:#5e35b1,color:#fff,stroke:#311b92
    classDef system fill:#7e57c2,color:#fff,stroke:#4527a0
    classDef ext fill:#eceff1,color:#263238,stroke:#90a4ae
    class architect,dev,agent person
    class inwards system
    class repo,editor,ci,scanning ext
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
    cli -. "reads/writes" .-> cache

    classDef person fill:#5e35b1,color:#fff,stroke:#311b92
    classDef container fill:#7e57c2,color:#fff,stroke:#4527a0
    classDef planned fill:#ede7f6,color:#4527a0,stroke:#7e57c2,stroke-dasharray:5 5
    classDef ext fill:#eceff1,color:#263238,stroke:#90a4ae
    class agent,dev person
    class cli,lsp,ext,core container
    class hooks container
    class cache planned
    class config,src,vscode ext
```

| Container | Tech | Lives in | Status |
|---|---|---|---|
| **Engine** | TypeScript, `web-tree-sitter` 0.27 + `tree-sitter-python` 0.25 (WASM) | `src/core` | :white_check_mark: INW001 |
| **CLI** | Bun 1.4 single-file executable, 6 targets | `src/cli` | :white_check_mark: `check`, text/json/sarif |
| **Language server** | `vscode-languageserver` 10 on Node | `src/vscode-extension/src/server.ts` | :white_check_mark: scaffold |
| **VS Code extension** | `vscode-languageclient` 10 | `src/vscode-extension/src/extension.ts` | :white_check_mark: scaffold |
| **Agent kit** | Generated hook config and markdown | `src/cli` (future `init` command) | :material-progress-clock: |
| **Cache** | Content-hash keyed import lists | `.inwards/cache` | :material-progress-clock: |

The engine is the only place rules live. The CLI and the language server are adapters: they find files, read them, load the grammars and pick an output format. That split is why an editor squiggle and a CI failure can't disagree. They run the same function on the same text.

!!! warning "One engine, two runtimes"
    The CLI runs the engine on Bun. The language server runs it on Node inside the VS Code extension host. A single call to a Bun-only API inside `src/core/src` would pass every test (tests run on Bun) and then break the extension at runtime. The rule is enforced by lint, not by memory: `biome.json` turns on `noRestrictedGlobals` for `src/core/src/**` and rejects `Bun` and `Deno` with a message pointing at the `GrammarBinaries` port. CI also bundles the extension for the `node` target on every push.

## C3: Components of the engine

The engine is a hexagon in miniature. It gets bytes and text in and returns plain data, and it never touches the disk. The grammars come in as a port (`GrammarBinaries`), so the Bun binary can hand over embedded blobs while the VS Code server reads them from its install folder.

```mermaid
flowchart LR
    subgraph driving["Driving side (adapters call in)"]
        files["SourceFile[]<br/><small>path, module, text</small>"]
        cfgtext["pyproject.toml text"]
        wasm["GrammarBinaries<br/><small>runtime + python .wasm</small>"]
    end

    subgraph enginebox["Engine: @inwards/core"]
        config["<b>Config parser</b><br/><small>config.ts<br/>smol-toml, validation</small>"]
        pre["<b>Import skeleton prescan</b><br/><small>prescan.ts<br/>blanks non-import lines</small>"]
        parser["<b>Parser adapter</b><br/><small>python.ts<br/>web-tree-sitter</small>"]
        extract["<b>Import extractor + resolver</b><br/><small>python.ts<br/>relative → absolute</small>"]
        rules["<b>Rules</b><br/><small>rules.ts: registry<br/>layers.ts: INW001<br/>dynamic.ts: INW011<br/>unassigned.ts + layout.ts: INW006<br/>encoding.ts: INW000</small>"]
        fix["<b>Fix composer</b><br/><small>per-violation steps</small>"]
        report["<b>Reporters</b><br/><small>reporters.ts<br/>text · json · sarif</small>"]
        engine["<b>Engine facade</b><br/><small>engine.ts<br/>checkFile / checkFiles / index</small>"]
        modgraph["<b>Module index</b><br/><small>project.ts: first-party modules,<br/>importers on demand</small>"]
    end

    cfgtext --> config --> engine
    wasm --> parser
    files --> engine
    engine --> pre --> parser --> extract --> rules
    rules --> fix
    rules --> engine
    engine -. "confirm with full parse" .-> parser
    engine --> modgraph
    modgraph -. "imports of candidate files" .-> extract
    engine --> report

    classDef comp fill:#7e57c2,color:#fff,stroke:#4527a0
    classDef planned fill:#ede7f6,color:#4527a0,stroke:#7e57c2,stroke-dasharray:5 5
    classDef port fill:#eceff1,color:#263238,stroke:#90a4ae
    class config,pre,parser,extract,rules,fix,report,engine,modgraph comp
    class files,cfgtext,wasm port
```

| Component | Responsibility | Notes |
|---|---|---|
| Config parser | Reads `[tool.inwards]`, validates it, and names the exact key that's wrong | Throws `ConfigError`. The CLI maps that to exit code 2 |
| Import skeleton prescan | Keeps only import lines, dedents them, blanks the rest so line numbers stay put | Refuses the file when `import` shows up somewhere it can't account for, which forces a full parse. See [ADR-004](05-ADR.md#adr-004-parse-the-import-skeleton-confirm-with-a-full-parse) |
| Parser adapter | Initialises web-tree-sitter from bytes and parses | Frees every tree explicitly, because WASM memory isn't garbage collected |
| Import extractor | Finds `import` / `from ... import` nodes anywhere in the tree, resolves relative imports | `from shop import infrastructure` is recorded as `shop.infrastructure`, so it can't slip past |
| Rules | Pure functions from `(file, imports, config)` to `Diagnostic[]`. Code, name, default severity, summary and docs link of every rule live in one registry (`rules.ts`); SARIF `rules[]` is built from it | INW001, INW011 for dynamic imports with literal targets, and INW000 for files whose encoding could hide imports. Planned rules are listed below |
| Fix composer | Builds numbered repair steps from the actual import and layer names | The steps name real modules, not placeholders |
| Reporters | Text for humans, `inwards/diagnostics@1` JSON for agents, SARIF 2.1.0 for GitHub | JSON fields may be added but never removed or renamed |
| Engine facade | Orchestrates prescan, rules and the confirming full parse | The only thing the adapters call. A layered file whose text names a module loader skips the prescan (see below) |
| Module index | `Engine.index(files)` returns every first-party module and answers "who imports module X" on demand, parsing only files whose text mentions X's last name segment | Not used by a rule yet (INW006 probes the file system for first-party modules instead); INW010 and cycle detection will use it |

### How one check flows

```mermaid
sequenceDiagram
    autonumber
    participant A as Adapter (CLI / LSP)
    participant E as Engine
    participant P as Prescan
    participant T as tree-sitter (WASM)
    participant R as Rules

    A->>E: checkFile({path, module, text})
    opt file in a layer names a loader (importlib, runpy, builtins, __import__, exec, eval, compile)
        E->>T: parse(full text)
        E->>R: checkLayers + checkDynamicImports (INW011)
        R-->>E: diagnostics
        E-->>A: diagnostics
    end
    E->>P: importSkeleton(text)
    alt skeleton accepted
        P-->>E: skeleton (imports only)
        E->>T: parse(skeleton)
        T-->>E: tiny tree
        E->>R: checkLayers(imports)
        alt no violations (the common case)
            R-->>E: []
            E-->>A: []
        else violations found
            E->>T: parse(full text)
            T-->>E: full tree
            E->>R: checkLayers(imports from full tree)
            R-->>E: confirmed diagnostics
            E-->>A: diagnostics
        end
    else skeleton refused (odd import placement)
        P-->>E: null
        E->>T: parse(full text)
        E->>R: checkLayers(...)
        R-->>E: diagnostics
        E-->>A: diagnostics
    end
```

The prescan may report false positives, such as an import-shaped line inside a docstring, but it can never hide a real import, because it refuses any file it can't fully account for. The full parse is the source of truth, and it only runs when a violation needs confirming.

The skeleton keeps import statements only, so a file whose only outward dependency is `importlib.import_module("shop.infrastructure.db")` would pass it. Before the prescan runs, a text check looks for the names every loading call has to spell (`importlib`, `runpy`, `builtins`, `__import__`, or a bare `exec`, `eval` or `compile`, after NFKC). A file in a layer that matches goes straight to the full parse, which also looks for dynamic imports. `re.compile` does not match. On the CPython 3.14 standard library, 209 of 1,921 files match. See [ADR-015](05-ADR.md#adr-015-check-literal-dynamic-imports-as-inw011).

The cost model has one bad case. On a legacy codebase where most files already violate, nearly every file pays for the skeleton parse and then the full parse, which is a little slower than parsing everything once. The baseline (UC6) keeps those violations from failing, but the engine still confirms each one on every run. Skipping the confirming parse for a violation the baseline already accepts is planned.

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

    classDef planned fill:#ede7f6,color:#4527a0,stroke:#7e57c2,stroke-dasharray:5 5
```

Exit codes follow Ruff: `0` clean (warnings allowed), `1` errors found, `2` usage or config error. Agents and CI scripts can branch on that without parsing output. In the JSON report, `summary.violations` counts errors and `summary.warnings` counts warnings.

## Deployment and distribution

```mermaid
flowchart LR
    tag["git tag v*"] --> cd["cd.yml on ubuntu-latest<br/><small>bun build --compile × 6 targets</small>"]
    cd --> art[("Draft GitHub Release<br/><small>binaries + SHA256SUMS + .vsix<br/>+ provenance attestations once the repo is public</small>")]
    art --> verify["verify matrix<br/><small>linux x64/arm64/musl · macOS arm64/x64 · Windows x64<br/>each binary lints examples/</small>"]
    art -.-> wheel["PyPI wheels: inwards<br/><small>one per platform, binary inside</small>"]
    art -.-> market["VS Code Marketplace"]
    wheel -.-> dev["uv add --dev inwards"]
    art --> manual["Manual download<br/><small>CI images, pre-commit</small>"]

    classDef planned fill:#ede7f6,color:#4527a0,stroke:#7e57c2,stroke-dasharray:5 5
    class wheel,market,dev planned
```

Cross-compiling from one Linux runner is possible because the grammars are WASM, with no native addon to build per platform (see [ADR-002](05-ADR.md#adr-002-web-tree-sitter-wasm-not-native-bindings)). The verify matrix then runs each binary on its real OS, since cross-compiled output that was never executed hasn't been tested.

## Known limitations

- One `root` per config. Monorepos with several Python packages each need their own `pyproject.toml` and their own run.
- The language server reads only the first workspace folder's `pyproject.toml`.
- Implicit namespace packages (no `__init__.py`) work for naming, but relative imports inside them resolve as if the directory were a regular package.
- Layer membership is by module prefix only. Glob patterns (`shop.*.domain`) for vertical slices are planned together with INW002.
- Dynamic imports are checked only when the target is a constant string (INW011). Known gaps:
    - computed targets (`importlib.import_module(name)`, a module-level `TARGET = "..."` constant, `str.format`), a relative `import_module` without a literal `package`, `__package__` or `__name__`, and literals that use a `\N{...}` escape. Flagging those as unverifiable is [#46](https://github.com/SirCypkowskyy/inwards/issues/46);
    - loaders reached through a walrus, tuple assignment, class or instance attributes, `functools.partial`, a name bound inside `exec`, or an object (`print.__self__.exec`): [#79](https://github.com/SirCypkowskyy/inwards/issues/79);
    - other loading APIs: `pkgutil.resolve_name`, `importlib.util.find_spec` with `exec_module`, and `SourceFileLoader(...).load_module()`: [#79](https://github.com/SirCypkowskyy/inwards/issues/79);
    - a false positive, accepted over a miss: `exec`, `eval`, `compile` and `__import__` always count as the builtins, so after `from re import compile`, `compile("from shop.infrastructure import x")` is reported.
- Modules that belong to no layer are not checked themselves. INW006 makes that visible (a warning per package, an error for an import into one from a layer, and dead prefixes), but the imports inside an unassigned package are still unchecked until the user assigns it.

## Rule catalogue

| Code | Name | What it catches | Status |
|---|---|---|---|
| INW000 | `unsupported-encoding` | A file in a layer declares an encoding (PEP 263) such as `unicode_escape` or `utf-7`, under which text Inwards reads as a comment can be a real import to CPython. The file is reported, not skipped | :white_check_mark: |
| INW001 | `layer-dependency` | An inner layer importing an outer one | :white_check_mark: |
| INW002 | `context-independence` | One bounded context or vertical slice importing another's internals | :material-progress-clock: |
| INW003 | `public-api-only` | Importing past a context's public module (`__init__` or `api.py`) | :material-progress-clock: |
| INW004 | `no-cycles` | Import cycles between modules or contexts | :material-progress-clock: needs the graph |
| INW006 | `unassigned-module` | An import from a layer into first-party code that belongs to no layer, including the package above the layers (`from shop import x` runs `shop/__init__.py`, which no layer owns), static or dynamic (error); layer code moved out of every layer during a session (error); a package outside every layer and `ignore` (warning); a layer prefix matching no module (warning), a layer with no live prefix, or a prefix emptied during the session (error). Unknown keys and overlapping prefixes are config errors | :white_check_mark: |
| INW005 | `pure-domain` | The domain layer importing frameworks or I/O libraries (`sqlalchemy`, `fastapi`, `requests`...) | :material-progress-clock: |
| INW010 | `unknown-first-party` | Importing a first-party module that doesn't exist, the typical agent hallucination | :material-progress-clock: needs the module index |
| INW011 | `dynamic-import` | A dynamic import with a string-literal target that reaches an outer layer: `importlib.import_module`, `__import__` (also `builtins.` and `importlib.`), `runpy.run_module`, and import statements inside literal `exec` / `eval` / `compile` source (bytes whose declared encoding Inwards can't read are reported as unchecked). Import aliases, `name = loader` assignments, `getattr(m, "name")`, `m.__dict__["name"]` and `vars(m)["name"]` are followed; `+` between literals and f-strings with literal fields are folded. A common way to dodge INW001. Known gaps are listed above | :white_check_mark: literal targets |

## Code map

```text
src/
├── core/                  # engine, no I/O
│   ├── src/
│   │   ├── config.ts      # [tool.inwards] parsing and validation
│   │   ├── prescan.ts     # import skeleton fast path
│   │   ├── python.ts      # tree-sitter adapter, import extraction, module names
│   │   ├── rules.ts       # rule registry: code, name, severity, docs
│   │   ├── layers.ts      # INW001 + fix composer
│   │   ├── dynamic.ts     # INW011: literal dynamic imports, loader hint for the engine
│   │   ├── unassigned.ts  # INW006: code outside every layer, first-party probe
│   │   ├── layout.ts      # INW006: dead prefixes, layer code moved out of every layer
│   │   ├── callees.ts     # which calls are loaders, through aliases
│   │   ├── literals.ts    # string literals and call arguments, as Python reads them
│   │   ├── encoding.ts    # INW000: declared encodings that can hide imports
│   │   ├── reporters.ts   # text / json / sarif
│   │   ├── engine.ts      # facade
│   │   ├── project.ts     # module index, importers on demand
│   │   └── meta.ts        # VERSION, DOCS_BASE
│   └── test/              # bun test
├── cli/src/               # main (commands), hook, session + state-files (session state),
│                          # project (load sources), paths, files, grammars
└── vscode-extension/src/  # extension.ts (client), server.ts (LSP)
```
