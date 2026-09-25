# :material-scale-balance: Architecture decisions (ADR)

Each record states the decision, the context it was made in, what it costs us, and what we turned down. Records are never edited after acceptance. A changed mind gets a new ADR that supersedes the old one.

| ADR | Decision | Status |
|---|---|---|
| [001](#adr-001-typescript-for-the-engine) | TypeScript for the engine | :white_check_mark: Accepted |
| [002](#adr-002-web-tree-sitter-wasm-not-native-bindings) | web-tree-sitter (WASM), not native bindings | :white_check_mark: Accepted |
| [003](#adr-003-ship-a-bun-single-file-executable) | Ship a Bun single-file executable | :white_check_mark: Accepted |
| [004](#adr-004-parse-the-import-skeleton-confirm-with-a-full-parse) | Parse the import skeleton, confirm with a full parse | :white_check_mark: Accepted |
| [005](#adr-005-configuration-lives-in-pyprojecttoml) | Configuration lives in `pyproject.toml` | :white_check_mark: Accepted |
| [006](#adr-006-the-engine-does-no-io) | The engine does no I/O | :white_check_mark: Accepted |
| [007](#adr-007-a-versioned-output-contract-with-fix-steps-as-data) | A versioned output contract with fix steps as data | :white_check_mark: Accepted |
| [008](#adr-008-language-server-on-node-inside-the-extension-for-now) | Language server on Node inside the extension, for now | :material-progress-clock: Accepted, revisit at 0.3 |
| [009](#adr-009-check-imports-wherever-they-appear) | Check imports wherever they appear | :white_check_mark: Accepted |
| [010](#adr-010-docs-built-with-zensical-served-by-cloudflare-workers) | Docs built with Zensical, served by Cloudflare Workers | :material-swap-horizontal: Hosting superseded by 012 |
| [011](#adr-011-rename-stratum-to-inwards) | Rename Stratum to Inwards | :white_check_mark: Accepted |
| [012](#adr-012-publish-the-docs-on-github-pages-for-now) | Publish the docs on GitHub Pages, for now | :white_check_mark: Accepted |

## ADR-001: TypeScript for the engine

**Status:** Accepted · 2026-09-25

**Context.** Every fast linter we studied (Ruff, ty, Biome, grimp's new core, Tach) is written in Rust. Rust gives the best raw speed and the smallest binaries. But Inwards' hard problem isn't parsing speed. It's the product surface: rule semantics, fix text, agent integrations and an editor extension. That surface needs fast iteration. The VS Code extension host runs JavaScript, so a TypeScript engine runs there in-process with no second build.

**Decision.** Write the engine in TypeScript, and treat speed as an architecture problem (what we parse and when) rather than a language problem.

**Consequences.**

- :material-plus-circle-outline: One language across the engine, CLI, language server and extension. A contributor who fixes a rule sees the effect in all three.
- :material-plus-circle-outline: The large TypeScript contributor pool, and quick prototyping of agent-facing features.
- :material-minus-circle-outline: A Bun binary is large (82 MB for Linux x64, measured) compared with a Rust one.
- :material-minus-circle-outline: Parsing is slower. WASM tree-sitter manages about 1.3 MB/s per core in our benchmark. [ADR-004](#adr-004-parse-the-import-skeleton-confirm-with-a-full-parse) exists because of this.
- :material-alert-outline: If the technical hypothesis fails on real repos, the fallback is to move the prescan and graph into a Rust or Zig WASM module that the TypeScript engine calls. The rest stays.

**Alternatives.** *Rust*: best performance, but the agent kit, the rules and the extension would move slower, and we'd compete with Astral on Astral's ground. *Python*: this is what import-linter and pytest-archon do. It needs the user's environment, and grimp had to move to Rust anyway for speed.

## ADR-002: web-tree-sitter (WASM), not native bindings

**Status:** Accepted · 2026-09-25

**Context.** tree-sitter has two JavaScript bindings. The native Node addon (`tree-sitter` 0.25.1) is faster, but tree-sitter issue #5939 documents that it fails under `bun run` and `bun build --compile` ("To load Node-API modules, use require()…"). It also can't resolve its prebuild paths inside a compiled binary. Cross-compiling would mean shipping one `.node` prebuild per target, and `tree-sitter-python` publishes none for musl. The WASM binding (`web-tree-sitter` 0.27.0) is portable, and `tree-sitter-python` ships a `.wasm` grammar in its npm package.

**Decision.** Use `web-tree-sitter` with `tree-sitter-python.wasm`. The CLI embeds both `.wasm` files in the binary through `import … with { type: "file" }`. The engine receives the bytes through the `GrammarBinaries` port and never looks them up on disk. That also sidesteps the known pitfall of web-tree-sitter searching for its `.wasm` next to its JS file.

**Consequences.**

- :material-plus-circle-outline: One Linux runner cross-compiles all six targets. The CD pipeline proves it on every tag by running each binary on its native OS.
- :material-plus-circle-outline: The same bytes run in Bun, Node and, later, a browser playground.
- :material-minus-circle-outline: WASM parsing is slower than native. We haven't measured the gap ourselves yet.
- :material-minus-circle-outline: Trees live in WASM memory and must be freed by hand (`tree.delete()`). The engine does this in a `finally` block.

**Alternatives.** *Native addon*: blocked by the Bun issue and by cross-compilation. *Hand-written import lexer*: fast, but it would have to reimplement Python's string, bracket and continuation rules. The prescan in ADR-004 takes the cheap part of that idea and hands everything hard back to tree-sitter.

## ADR-003: Ship a Bun single-file executable

**Status:** Accepted · 2026-09-25

**Context.** Users expect `uv add --dev <linter>` and a binary that starts instantly, the way Ruff and ty work. Asking Python teams to install Node is a non-starter. Bun's `--compile` targets Linux (glibc and musl), macOS and Windows on x64 and arm64, and embeds assets.

**Decision.** Distribute `inwards` as one executable per target, built with `bun build --compile` (see `scripts/build-binaries.ts`). Later, wrap each binary in a platform wheel published as `inwards` on PyPI (see [ADR-011](#adr-011-rename-stratum-to-inwards) for the name).

**Consequences.**

- :material-plus-circle-outline: No runtime prerequisites. Measured: about 25 ms wall time for a one-file check including process start.
- :material-plus-circle-outline: Tags produce verified binaries automatically (`cd.yml`).
- :material-minus-circle-outline: 82 MB per binary, and each platform wheel will carry one. Bun's `--bytecode` flag and minification are the first things to try for startup and size.
- :material-minus-circle-outline: We depend on Bun's release cadence and on its compile feature staying stable.

**Alternatives.** *npm package*: needs Node on the user's machine. *Node SEA (single executable applications)*: workable, but Bun gives us cross-compilation, asset embedding, the bundler and the test runner in one tool. *Deno compile*: viable, but Bun's test runner, bundler and package manager in one tool keep the monorepo simpler.

## ADR-004: Parse the import skeleton, confirm with a full parse

**Status:** Accepted · 2026-09-25

**Context.** Our first implementation parsed every file fully. On a synthetic repo of 2,100 files and 496k lines (8 MB), a cold run took **7.5 s**, and 6.1 s of that was tree-sitter parsing. Architecture rules only need imports, and in real code imports sit on their own logical lines. Parsing only the import lines of the same repo took 0.27 s.

**Decision.** Before parsing, build an *import skeleton*: keep lines that start an import statement (including parenthesised and backslash continuations), dedent them, and blank every other line so line numbers stay correct. Parse the skeleton and run the rules. If the prescan meets the word `import` anywhere it can't account for (`x = 1; import os`, `if a: import b`, a docstring line), it refuses the file and the engine parses it in full. Comment lines are skipped, since a comment can't hide an import. If the skeleton produces a violation, the engine confirms it with a full parse before reporting, which removes false positives from import-shaped text inside strings.

**Consequences.**

- :material-plus-circle-outline: Cold full run on the same repo: **0.63 to 0.96 s**, about 8 to 12 times faster, still on one core.
- :material-plus-circle-outline: Correctness is anchored to the full parse, and we test that instead of assuming it. `src/core/scripts/prescan-diff.ts` extracts imports from every file of a corpus both ways and fails if the skeleton misses one. On the CPython 3.14 standard library (1,921 files) it misses **none**, finds 33 extra that the confirming parse throws away, and refuses 8.2 % of files, which then get the full parse. CI runs it on every push against the runner's stdlib. Unit tests cover nested, parenthesised, semicolon and docstring cases.

<figure markdown="span">
  ![prescan differential test on the CPython stdlib](assets/screens/prescan-diff.svg){ loading=lazy }
  <figcaption>The differential test on the CPython 3.14 standard library. CI runs the same script on every push.</figcaption>
</figure>

- :material-alert-outline: One theoretical gap remains: an unbalanced bracket inside a string *on an import line* could make the prescan copy the wrong span. Such a file hasn't shown up in the corpus yet. If one does, the differential test will catch it.
- :material-minus-circle-outline: Files with violations pay for two parses. On a legacy repo with many violations that approaches the naive cost, until the baseline (UC6) lets the engine skip re-confirming known violations.
- :material-minus-circle-outline: Future rules that need more than imports (for example "no framework decorators in the domain") can't use the skeleton and will need their own fast path or the full parse.

**Alternatives.** *Full parse with a content-hash cache*: we'll add the cache anyway, but it doesn't help cold CI runs or the first run. *tree-sitter incremental parsing*: useful in the editor, where we hold the old tree, and no help to a fresh CLI process. *`ruff analyze graph` as the import source*: fast and Rust-backed, but it makes Ruff a hard dependency, reports file-to-file edges without line and column (so no precise diagnostics), and started life as a preview command.

## ADR-005: Configuration lives in `pyproject.toml`

**Status:** Accepted · 2026-09-25

**Context.** Python tools have converged on `[tool.<name>]` in `pyproject.toml` (Ruff, pytest, mypy, uv). import-linter uses `.importlinter` or `setup.cfg` as well.

**Decision.** Read `[tool.inwards]` from the nearest `pyproject.toml` walking up from the working directory, or from `--config`. Layers are an ordered list, innermost first. A module may import its own layer and any layer listed before it.

**Consequences.**

- :material-plus-circle-outline: No new file, and one obvious place to look.
- :material-plus-circle-outline: Ordered layers make the common case (a strict onion) a four-line config.
- :material-minus-circle-outline: The config sits in a file agents edit often, for dependencies. Protecting it needs a hook or CODEOWNERS rather than a separate file with separate permissions. [Chapter 4](04-AI-Integration.md#stopping-the-agent-from-gaming-the-check) covers the guard.
- :material-minus-circle-outline: Non-linear rules (slices that may not see each other, "only via `api.py`") need more syntax later. They'll be separate tables, so the simple case stays simple.

**Alternatives.** *`inwards.toml`*: easier to lock down, but one more file. We may still support it as an option. *Python config (like pytest-archon)*: would require executing user code, which conflicts with ADR-006.

## ADR-006: The engine does no I/O

**Status:** Accepted · 2026-09-25

**Context.** The engine runs in two hosts with different I/O: a Bun binary with embedded files, and a Node language server with files on disk and unsaved buffers in memory. It will later run in tests, an MCP server, and maybe a browser.

**Decision.** `@inwards/core` takes plain data (`SourceFile[]`, the config text, `GrammarBinaries`) and returns plain data. Finding files, reading them, embedding grammars and choosing where output goes all belong to the adapters. `biome.json` enforces the runtime side of this by banning the `Bun` and `Deno` globals in `src/core/src`.

**Consequences.**

- :material-plus-circle-outline: The editor checks the unsaved buffer, and the CLI checks the file on disk, with the same function.
- :material-plus-circle-outline: Tests need no temp directories. They pass strings.
- :material-minus-circle-outline: Cross-file rules (cycles, unknown modules) need the adapter to supply the module index. The engine's API grows a "project" input when those rules arrive.

**Alternatives.** *Engine reads files itself*: simpler at first, but it would lock the engine to one runtime's file API and make the editor case awkward.

## ADR-007: A versioned output contract with fix steps as data

**Status:** Accepted · 2026-09-25

**Context.** Agents and scripts parse our output. Any unannounced change breaks someone's hook. SARIF is the standard for code-scanning UIs, and GitHub ingests it through `github/codeql-action/upload-sarif`.

**Decision.** JSON output carries `"schema": "inwards/diagnostics@1"`. Within a major version, fields may be added but never renamed or removed. Every diagnostic has `fix.summary` and `fix.steps[]`, built from the actual import and layer names. SARIF 2.1.0 carries the same steps in `message.text` and `properties.fix`. When stdout isn't a terminal, output is compact.

**Consequences.**

- :material-plus-circle-outline: Hooks and agents can depend on the shape.
- :material-plus-circle-outline: Fix quality becomes testable: tests assert on the steps.
- :material-minus-circle-outline: Fix text is now an API. Rewording it is harmless for models, but it can break snapshot tests people write against us.

**Alternatives.** *Unversioned JSON*: the common choice (Biome marks its JSON reporter experimental), but it pushes risk onto the integrations we care about most.

## ADR-008: Language server on Node inside the extension, for now

**Status:** Accepted, revisit at 0.3 · 2026-09-25

**Context.** Ruff and ty ship their language server inside the same binary (`ruff server`). That gives every LSP-capable editor (Neovim, Zed, Helix) the server for free. Inwards' scaffold instead bundles a Node LSP server into the VS Code extension, next to the grammar files.

**Decision.** Keep the Node server in the extension until the CLI has a stable `inwards server` subcommand. Then the extension becomes a thin client that starts the binary, and the Node server is deleted.

**Consequences.**

- :material-plus-circle-outline: Works today with no binary download in the extension.
- :material-minus-circle-outline: Two ways the engine is packaged. The runtime guard (ADR-006) and the extension build in CI keep them honest.
- :material-minus-circle-outline: Other editors wait for `inwards server`.

**Alternatives.** *`inwards server` now*: the better end state, but it needs stdio LSP plumbing in the binary and a download step in the extension. That's more than a scaffold should carry.

## ADR-009: Check imports wherever they appear

**Status:** Accepted · 2026-09-25

**Context.** pytest-archon lets users skip `TYPE_CHECKING` imports and look only at top-level imports. For humans those are reasonable options. For agents they're escape hatches: moving an import into a function body or a `TYPE_CHECKING` block is the cheapest way to silence a checker that ignores them.

**Decision.** INW001 checks every import in the file: top level, nested in functions or classes, and under `if TYPE_CHECKING:`. Relative imports and `from package import submodule` are resolved first.

**Consequences.**

- :material-plus-circle-outline: The common dodges don't work, and the fix text says so up front.
- :material-minus-circle-outline: Teams that deliberately allow type-only references to outer layers will want an opt-out. If we add one, it will be per layer pair and off by default.

**Alternatives.** *Top-level imports only*: faster to explain and easy to evade.

## ADR-010: Docs built with Zensical, served by Cloudflare Workers

**Status:** Accepted · 2026-09-25 · hosting part superseded by [ADR-012](#adr-012-publish-the-docs-on-github-pages-for-now)

**Context.** The docs are Markdown with Mermaid diagrams and icons. Zensical, from the Material for MkDocs team, reads `zensical.toml`, renders Mermaid natively and bundles the Material icon sets. For hosting, Cloudflare's current docs lead new static sites to Workers static assets, configured with an `assets` block in `wrangler.jsonc`.

**Decision.** `docs/zensical.toml` builds `docs/chapters/` into `docs/site/`. `docs/wrangler.jsonc` declares an assets-only Worker (`inwards-docs`). `.github/workflows/docs.yml` builds with `--clean --strict` and deploys with `cloudflare/wrangler-action@v4` on pushes to `main`. CI builds the docs on every pull request, so a broken page fails before merge.

**Consequences.**

- :material-plus-circle-outline: No Worker code to maintain. Cloudflare serves the files directly, with a real 404 page.
- :material-minus-circle-outline: Zensical is young (0.0.x). Its docs advise against build caches on CI for now, hence `--clean`.
- :material-minus-circle-outline: Needs two repository secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

**Alternatives.** *GitHub Pages*: simpler auth, but no edge features if we later want redirects or a rules-search API. *Cloudflare Pages*: still works. We chose Workers to follow Cloudflare's current guidance and to leave room for a small Worker later (redirects, a rules search endpoint).

## ADR-011: Rename Stratum to Inwards

**Status:** Accepted · 2026-09-25

**Context.** The working name "Stratum" was taken on PyPI, npm and crates.io. Worse, in the Python world it names the Bitcoin mining pool protocol: the `stratum` package on PyPI is a Twisted mining server, and the top Python repositories called "stratum" on GitHub are mining servers and proxies. A developer searching for the linter would land on mining software. We checked a dozen alternatives against PyPI and npm on 2026-09-25.

**Decision.** The project, the command and the config table are called **Inwards**: `inwards check`, `[tool.inwards]`, the `inwards` package on PyPI and npm (both free on that date), and rule codes `INW001` and up. The name states the rule the tool enforces: dependencies point inwards.

**Consequences.**

- :material-plus-circle-outline: One name everywhere: the repository, the binary, the PyPI wheel, the config table and the rule prefix.
- :material-plus-circle-outline: No collision in our space. A GitHub search on 2026-09-25 found only small unrelated projects named Inwards (a water-data dashboard, a Flutter widget, a game), none of them Python tooling.
- :material-minus-circle-outline: "Inwards" is an ordinary English word, so searches need the "linter" or "python" qualifier.
- :material-minus-circle-outline: The JSON schema id changed to `inwards/diagnostics@1` before any release, so nothing outside this repository depended on the old one.

**Alternatives.** *Keep Stratum and publish as `stratum-lint`*: no rename work, but the mining-protocol collision stays forever. *`strataguard`, `layerly`, `onion-lint`, `tierlint`*: all free, none says what the tool does as directly.

## ADR-012: Publish the docs on GitHub Pages, for now

**Status:** Accepted · 2026-09-25 · supersedes the hosting part of [ADR-010](#adr-010-docs-built-with-zensical-served-by-cloudflare-workers)

**Context.** The first Cloudflare deploy failed: the only API token available was scoped to Cloudflare Tunnel, and the Workers API answered "No access to the specified resource". The docs shouldn't wait for a new token.

**Decision.** `.github/workflows/docs.yml` builds with Zensical and publishes `docs/site/` with `actions/upload-pages-artifact` and `actions/deploy-pages`. The Cloudflare path stays ready but dormant: `docs/wrangler.jsonc` is unchanged, and `.github/workflows/docs-cloudflare.yml` deploys it on manual dispatch once a token with *Workers Scripts: Edit* exists.

**Consequences.**

- :material-plus-circle-outline: No third-party credentials. Pages uses the workflow's own OIDC token.
- :material-plus-circle-outline: Switching back is one secret and one workflow run. Nothing in the site depends on the host.
- :material-minus-circle-outline: The site lives under a path (`/inwards/`), so `site_url` in `zensical.toml` and `DOCS_BASE` in the engine must change together if the host changes.
- :material-minus-circle-outline: GitHub Pages for a private repository needs a paid GitHub plan.

**Alternatives.** *Wait for a Cloudflare token*: leaves the docs offline for no technical reason. *Deploy from a local machine*: not reproducible, and it skips the strict build in CI.

