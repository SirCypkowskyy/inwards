# :material-scale-balance: Architecture decisions (ADR)

Each record states the decision, the context it was made in, what it costs us, and what we turned down. Records are never edited after acceptance. A changed mind gets a new ADR that supersedes the old one.

| ADR | Decision | Status |
|---|---|---|
| [001](#adr-001-typescript-for-the-engine) | TypeScript for the engine | :white_check_mark: Accepted |
| [002](#adr-002-web-tree-sitter-wasm-not-native-bindings) | web-tree-sitter (WASM), not native bindings | :white_check_mark: Accepted |
| [003](#adr-003-ship-a-bun-single-file-executable) | Ship a Bun single-file executable | :white_check_mark: Accepted, built with `--bytecode` since [#39](06-Constraints-and-Quality.md#spike-bytecode-and-minification) |
| [004](#adr-004-parse-the-import-skeleton-confirm-with-a-full-parse) | Parse the import skeleton, confirm with a full parse | :white_check_mark: Accepted, baselined modules skip the confirming parse since [#108](03-Architecture-C4.md#c3-components-of-the-engine) |
| [005](#adr-005-configuration-lives-in-pyprojecttoml) | Configuration lives in `pyproject.toml` | :white_check_mark: Accepted |
| [006](#adr-006-the-engine-does-no-io) | The engine does no I/O | :white_check_mark: Accepted, the adapter supplies the module index through a ProjectFiles port since [#44](03-Architecture-C4.md#c3-components-of-the-engine) |
| [007](#adr-007-a-versioned-output-contract-with-fix-steps-as-data) | A versioned output contract with fix steps as data | :white_check_mark: Accepted |
| [008](#adr-008-language-server-on-node-inside-the-extension-for-now) | Language server on Node inside the extension, for now | :material-progress-clock: Accepted, revisit in M6 (v0.6) |
| [009](#adr-009-check-imports-wherever-they-appear) | Check imports wherever they appear | :white_check_mark: Accepted |
| [010](#adr-010-docs-built-with-zensical-served-by-cloudflare-workers) | Docs built with Zensical, served by Cloudflare Workers | :material-swap-horizontal: Hosting superseded by 012 |
| [011](#adr-011-rename-stratum-to-inwards) | Rename Stratum to Inwards | :white_check_mark: Accepted |
| [012](#adr-012-publish-the-docs-on-github-pages-for-now) | Publish the docs on GitHub Pages, for now | :white_check_mark: Accepted, deployed from `develop` since 019 |
| [013](#adr-013-real-paths-for-the-boundary-import-paths-for-module-names) | Real paths for the boundary, import paths for module names | :white_check_mark: Accepted |
| [014](#adr-014-report-files-whose-declared-encoding-can-hide-imports) | Report files whose declared encoding can hide imports | :white_check_mark: Accepted |
| [015](#adr-015-check-literal-dynamic-imports-as-inw011) | Check literal dynamic imports as INW011 | :white_check_mark: Accepted, unreadable targets reported since 026 |
| [016](#adr-016-versions-and-releases-come-from-commit-types-via-a-release-pr) | Versions and releases come from commit types, via a release PR | :material-swap-horizontal: Branching model superseded by 019 |
| [017](#adr-017-squash-merges-with-conventional-commit-pr-titles) | Squash merges with Conventional Commit PR titles | :white_check_mark: Accepted, squashed into `develop` since 019 |
| [018](#adr-018-package-selectors-take-globs-from-the-start-monorepos-follow-uv-workspaces) | Package selectors take globs from the start; monorepos follow uv workspaces | :white_check_mark: Accepted |
| [019](#adr-019-a-develop-integration-branch-main-moves-only-at-releases) | A `develop` integration branch; `main` moves only at releases | :white_check_mark: Accepted |
| [020](#adr-020-the-init-picker-uses-clackprompts-loaded-from-a-split-chunk) | The `init` picker uses @clack/prompts, loaded from a split chunk | :white_check_mark: Accepted |
| [021](#adr-021-publish-the-release-wheels-to-pypi-from-their-own-workflow-with-trusted-publishing) | Publish the release wheels to PyPI from their own workflow, with trusted publishing | :white_check_mark: Accepted, switched on by the owner |
| [022](#adr-022-m2-go-or-no-go-continue-conditionally-until-partner-data) | M2 go or no-go: continue, conditionally, until partner data | :material-progress-clock: Accepted, provisional until partner data |
| [023](#adr-023-libraries-per-layer-with-a-default-deny-list-for-the-innermost-layer) | Libraries per layer, with a default deny list for the innermost layer | :white_check_mark: Accepted, `extend-deny-libraries` adds to the default since [#155](guides/libraries.md#configure-it) |
| [024](#adr-024-a-polish-translation-as-a-second-build-translated-in-the-same-pr) | A Polish translation as a second build, translated in the same PR | :white_check_mark: Accepted |
| [025](#adr-025-inw010-probes-the-disk-for-existence-and-checks-only-the-module-part-of-an-import) | INW010 probes the disk for existence and checks only the module part of an import | :white_check_mark: Accepted, generated modules pass when missing since [029](#adr-029-generated-modules-pass-inw010-protoc-and-version-modules-by-default) |
| [026](#adr-026-report-unreadable-dynamic-import-targets-in-inner-layers) | Report unreadable dynamic-import targets in inner layers | :white_check_mark: Accepted |
| [027](#adr-027-per-rule-select-ignore-and-severity-in-a-toolinwardsrules-table) | Per-rule `select`, `ignore` and `severity` in a `[tool.inwards.rules]` table | :white_check_mark: Accepted, the language server re-reads the table without a restart since [#163](03-Architecture-C4.md#known-limitations) |
| [028](#adr-028-inline-suppressions-need-a-reason-and-an-agent-cant-add-one-by-default) | Inline suppressions need a reason, and an agent can't add one by default | :white_check_mark: Accepted |
| [029](#adr-029-generated-modules-pass-inw010-protoc-and-version-modules-by-default) | Generated modules pass INW010, protoc and version modules by default | :white_check_mark: Accepted |
| [030](#adr-030-bounded-contexts-as-a-contexts-table-of-literal-prefixes) | Bounded contexts as a `contexts` table of literal prefixes | :white_check_mark: Accepted |
| [031](#adr-031-a-content-keyed-extraction-cache-that-the-hooks-never-read) | A content-keyed extraction cache that the hooks never read | :white_check_mark: Accepted |
| [032](#adr-032-import-cycles-on-whole-project-runs-from-the-imports-the-check-already-reads) | Import cycles on whole-project runs, from the imports the check already reads | :white_check_mark: Accepted |

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
- :material-plus-circle-outline: Correctness is anchored to the full parse, and we test that instead of assuming it. `src/core/scripts/prescan-diff.ts` extracts imports from every file of a corpus both ways and fails if the skeleton misses one. On the CPython 3.14 standard library (1,921 files) it misses **none**, finds 33 extra that the confirming parse throws away, and refuses 8.3 % of files, which then get the full parse. CI runs it on every push against a full CPython 3.14 stdlib (2,273 files) and fails if that corpus has fewer than 1,500 files. Unit tests cover nested, parenthesised, semicolon and docstring cases.

<figure markdown="span">
  ![prescan differential test on the CPython stdlib](assets/screens/prescan-diff.svg){ loading=lazy }
  <figcaption>The differential test on the CPython 3.14 standard library. CI runs the same script on every push.</figcaption>
</figure>

- :material-alert-outline: Review found a real gap the corpus never showed: `from shop.infrastructure \` with `import sql_orders` on the next line was read as `import sql_orders`, and the violation went unreported. The prescan now refuses any file where a line mentioning `import` follows a backslash continuation. The stdlib has no such spellings, so `prescan-diff` now also generates its own corpus: 58 import spellings (continuations, semicolons, one-line `if`/`try`, strings and comments around imports, spaces inside dotted names, tabs, CRLF, BOM), combined in pairs and in string-context triples: 52,338 files in under 1 s. Its first run found a second gap: a string holding `from a import (` glued the real code after it onto a bogus import. The engine now discards any skeleton that doesn't parse cleanly and falls back to the full parse. A review then found the same trick with a clean parse: `import a; t = '''` inside one string opens a new string in the skeleton, which swallows the real import below it. So a skeleton is also discarded unless it holds nothing but import statements and comments. Both spellings are in the generator now (972 misses without the second guard, none with it), and the stdlib refusal rate did not change.
- :material-alert-outline: A lone `\r` ends a line in Python but not in tree-sitter, so `# note\rimport x` hid a real import inside a comment even from the full parse. The engine turns lone `\r` into `\n` before parsing. The differential test can't see this class of bug, because both sides share the parser, so a unit test pins it.
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

**Status:** Accepted, revisit in M6 (v0.6) · 2026-09-25

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

## ADR-013: Real paths for the boundary, import paths for module names

**Status:** Accepted · 2026-09-25

**Context.** The hook's payload comes from the agent, so any path in it is untrusted. Two reviews in M0 showed that one kind of path can't serve both jobs. Checking containment and naming modules on lexical paths lets a symlink reach outside the project. Doing both on real paths (the first fix) renamed a symlinked `shop/domain/order.py` to `shared.order`, which is in no layer. A later version skipped a real package once a symlinked alias of it had been walked, so `ln -s shop/domain aaa` hid the whole domain layer. Two platform details made it worse. On macOS `/var` is a link to `/private/var`. And Bun's `realpath` folds `dlink/..` away as text, while the OS resolves `dlink` first.

**Decision.**

- **Containment** is decided on real paths. The boundary is `CLAUDE_PROJECT_DIR`, or the directory the host runs the hook in, never the payload's `cwd`. `..` is resolved the way the OS resolves it, one real path at a time.
- **Module names** follow Python: a module is named after the path it is imported through. A file reachable under several names (an alias and its real path) is checked under each name that falls under the config root, once per file.
- **The walker** follows symlinks only while their target stays inside the directory being walked. It stops only on a real cycle, found on the chain of parent directories.
- **Config discovery** decides on parsed TOML, and in the hook it ignores any `pyproject.toml` whose real path is outside the project.

**Consequences.**

- :material-plus-circle-outline: An alias can't move a file out of its layer, and a link can't pull files from outside the project into a check or into the hook's output.
- :material-minus-circle-outline: Code shared through a symlink to a directory outside the project isn't checked. Checking it would mean reading outside the project.
- :material-minus-circle-outline: A file that really has two module names can be reported twice, once per name. Both are real import paths, so both reports are true.

**Alternatives.** *Real paths only*: renames symlinked files and hides layers. *Lexical paths only*: lets a symlink reach outside the project. *No symlink support*: packages linked into a project would go unchecked without any warning.

## ADR-014: Report files whose declared encoding can hide imports

**Status:** Accepted · 2026-09-25

**Context.** CPython honours a PEP 263 declaration such as `# coding: unicode_escape` on line 1 or 2. Under that codec, the text `#\u000aimport shop.infrastructure.db` is a comment to any reader that treats the file as UTF-8, and a real import to CPython. Adapters read files as UTF-8, and the engine does no I/O and ships no codec tables.

**Decision.** The engine finds the declaration with CPython's tokenizer rules: line 1, or line 2 when line 1 is blank or a comment, with CRLF and U+2028 handled. UTF-8 variants and ASCII-compatible single-byte codecs (ASCII, Latin-1, ISO-8859-*, cp125x) are read as usual, because none of their bytes can turn into a line break or a quote. Any other declared codec gets one INW000 diagnostic on line 1 for a file in a layer, and that file's imports are not checked.

**Consequences.**

- :material-plus-circle-outline: A file whose encoding can hide an import is reported instead of being passed.
- :material-minus-circle-outline: Legitimate files in codecs such as Shift_JIS or EUC-JP get INW000 too. That is conservative, because a Shift_JIS lead byte can swallow a backslash. The fix is to save the file as UTF-8.

**Alternatives.** *Decode every codec Python supports*: needs codec tables in the engine and still has to match CPython byte for byte. *Ignore the declaration*: a silent bypass.

## ADR-015: Check literal dynamic imports as INW011

**Status:** Accepted · 2026-09-25

**Context.** Once INW001 catches imports in functions and behind `TYPE_CHECKING` ([ADR-009](#adr-009-check-imports-wherever-they-appear)), the next cheapest dodge is a call: `importlib.import_module("shop.infrastructure.db")`, `__import__(...)`, `runpy.run_module(...)`, or `exec("from shop.infrastructure import db")`. Inwards never runs user code (C4), so it can only read targets that are written down. The import skeleton ([ADR-004](#adr-004-parse-the-import-skeleton-confirm-with-a-full-parse)) keeps import statements only: a file whose only outward dependency is a call would pass the fast path with no imports at all.

**Decision.**

- A string-literal target of `importlib.import_module`, `__import__` (also as `builtins.__import__` and `importlib.__import__`) or `runpy.run_module`, and every import inside literal `exec`, `eval` or `compile` source, is checked like an import. The literal source is parsed with the same grammar, and its imports (dynamic ones too) are reported at the call.
- It is reported as its own rule, INW011 `dynamic-import`, not as INW001. The fix names the loader as the problem: delete the call and use a port, because rebuilding the name at runtime or moving it to another loader only hides the dependency.
- Loaders are recognised through import aliases (`from importlib import import_module as im`, `import builtins as b`, `from importlib import *`), plain assignments (`load = importlib.import_module`), `getattr(m, "name")`, `m["name"]`, `m.__dict__["name"]`, `vars(m)["name"]` and `__import__("importlib")`. Scopes are ignored, and `exec`, `eval`, `compile` and `__import__` always count as the builtins, so resolution can add findings but not drop one. The accepted cost is a false positive: after `from re import compile`, `compile("from shop.infrastructure import x")` is reported.
- Bindings not listed above are not followed. [#79](https://github.com/SirCypkowskyy/inwards/issues/79) added the walrus, tuple, starred and chained assignment, class and instance attributes, `functools.partial`, names bound inside a literal `exec`, and builtins reached through `__self__`, `__globals__`, `globals()` and `sys.modules`, and the loading APIs `pkgutil.resolve_name`, `importlib.util.find_spec`, `spec_from_file_location` and `SourceFileLoader`. Chapter 3 lists what is still missed.
- A target is a constant string: literals, implicit concatenation, `+` between constants, and f-strings whose fields are constant strings. [#79](https://github.com/SirCypkowskyy/inwards/issues/79) added `%` with `%s`, `*`, `str.join`, `str.format`, slicing, `!s` and string format specs, and module-level names bound once to a constant in a file with no `exec`, `eval`, namespace writer or wildcard import.
- Bytes passed to `exec` or `compile` are decoded as CPython does. A PEP 263 declaration counts, and a codec Inwards can't read (the INW000 rules, [ADR-014](#adr-014-report-files-whose-declared-encoding-can-hide-imports)) gets an INW011 diagnostic saying the source can't be checked, in any layer. A `str` source ignores the declaration, as in CPython.
- Relative targets resolve as at runtime: `import_module(".x", package=...)` with a literal package, `__package__` or `__name__`, and `__import__` with a literal `level` against the file's package.
- Before the prescan, a text check looks for the names every loading call must spell: `importlib`, `runpy`, `pkgutil`, `builtins`, `__import__`, `__self__`, or `exec`, `eval` or `compile` not preceded by a dot, on NFKC-normalised text. A file in a layer that matches skips the skeleton and gets the full parse. `prescan-diff` checks the hint on both corpora: a dynamic import in a file the hint rejects is a miss.

**Consequences.**

- :material-plus-circle-outline: The common dynamic dodges are reported with a fix aimed at them. Tests cover each call form and alias.
- :material-minus-circle-outline: INW011 is not complete. The routes chapter 3 lists as known gaps are false negatives; computed targets are reported as unverifiable in inner layers ([ADR-026](#adr-026-report-unreadable-dynamic-import-targets-in-inner-layers)).
- :material-plus-circle-outline: The hint sends 209 of 1,921 CPython 3.14 stdlib files to the full parse, and only files in a layer pay for it. `re.compile` does not trigger it.
- :material-minus-circle-outline: Computed targets (`import_module(name)`, f-strings with fields), a relative `import_module` without a readable package, and literals with a `\N{...}` escape are not read. Computed targets need a separate decision, flagging every non-literal loader call in an inner layer ([#46](https://github.com/SirCypkowskyy/inwards/issues/46)).
- :material-minus-circle-outline: `prescan-diff` now parses every file it can't rule out, so the generated corpus (65,262 files) takes about 4 s instead of 1 s.
- :material-minus-circle-outline: The module index (`importersOf`) still reads static imports only, so a dynamic importer of a module is not listed as one.

**Alternatives.** *Report as INW001*: the agent would read "delete the import" and look for an import statement that isn't there. *Scan call names inside the skeleton*: the skeleton would have to keep arbitrary expression lines, which is the full parse by another name. *Flag every loader call in an inner layer*: catches computed targets too, but reports `importlib.import_module("json")`; left for a later issue.

## ADR-016: Versions and releases come from commit types, via a release PR

**Status:** Accepted · 2026-09-26

**Context.** Up to v0.1.0-rc.1, releases meant bumping `VERSION` by hand in five files (`meta.ts`, three `package.json` files, `pyproject.toml`), pushing a `v*` tag, and writing release notes by hand. Tags typed by hand are tedious and easy to get wrong, and a wrong tag is expensive: `cd.yml` refuses a tag that doesn't match `VERSION`, and PyPI never accepts the same version twice. The owner asked for versions that set themselves and a changelog nobody writes. Inwards is pre-1.0 and pre-alpha. `required-version` (pinned by `inwards init`) has to mean "the oldest release with the features this config uses".

**Decision.**

- **[release-please](https://github.com/googleapis/release-please) keeps a release PR open** (`chore: release X.Y.Z`) with the next version, the version stamped into every file, and the new `CHANGELOG.md` section. Merging it is the release: it tags `vX.Y.Z`, drafts the GitHub Release and starts `cd.yml`. Nobody types a tag or a changelog entry.
- **The version comes from the commit type** of each squash-merged PR ([ADR-017](#adr-017-squash-merges-with-conventional-commit-pr-titles)). Before 1.0, `feat` and `fix` bump the patch and a breaking change (`feat!`, `BREAKING CHANGE:`) bumps the minor, as in Cargo. After 1.0 the usual SemVer rules apply.
- **Milestone versions are set on purpose.** Closing milestone N sets `Release-As: 0.N.0` as the last paragraph of a PR description, so releases line up with the milestone names (M2 is v0.2).
- **There is one version source:** `.release-please-manifest.json`. CI fails on any PR where another version field disagrees with it.
- **The branching model is trunk-based.** There is only `main`, with short-lived branches, and no `develop` branch.
- **A release candidate is an optional hand-pushed tag** (`v0.2.0-rc.1`) on the release PR's branch, `release-please--branches--main--components--inwards`. `main` still holds the old version until the release PR merges, so a tag there fails the version check. This is the same flow as v0.1.0-rc.1.
- **Development builds from `main`** (`0.2.1-dev.N+g<sha>` for binaries, `0.2.1.devN` for wheels) are left for later, until design partners need nightlies.
- **There is no v0.1.0 release yet.** v0.1.0-rc.1 stays the published pre-release, and the release PR waits until a milestone is worth presenting.
- **Compatibility before 1.0:**
  - A patch release adds or fixes; it never breaks a config that worked.
  - A minor release may break the config or the CLI, and says so under a breaking-changes note in the CHANGELOG.
  - The `inwards/diagnostics@1` output only ever gains fields ([ADR-007](#adr-007-a-versioned-output-contract-with-fix-steps-as-data)).
  - `required-version` means "the oldest release with the features this config uses".

**Consequences.**

- :material-plus-circle-outline: A release is one merge, and the release PR shows exactly what will ship before it does.
- :material-plus-circle-outline: Version numbers stay meaningful for users and for `required-version`.
- :material-minus-circle-outline: The changelog is only as good as the PR titles ([ADR-017](#adr-017-squash-merges-with-conventional-commit-pr-titles)).
- :material-minus-circle-outline: While the repository is private and on the default `GITHUB_TOKEN`, the release PR gets no CI run of its own. Its diff is only version stamps and the changelog, and `cd.yml` reruns the tests on the tag. A GitHub App token fixes this when the repository goes public.
- :material-minus-circle-outline: A release-please release starts `cd.yml` through `workflow_dispatch`, because a tag pushed with `GITHUB_TOKEN` starts no workflow. Moving to an App token later means removing that dispatch step, or every release is built twice.
- :material-minus-circle-outline: The first release will be v0.1.1 or later (`Release-As` picks it), never v0.1.0. Its changelog compare link points at a v0.1.0 tag that doesn't exist.

**Alternatives.**

- *Bump by branch: minor on every merge to `main`, major on every release, and a `develop` branch publishing `dev+sha` builds.* This was the owner's first idea, and its goal (no manual tagging) is kept. Minor on every merge would reach 0.40 within weeks, burn a version number per PR that nobody installs, and break `required-version`: a teammate one merge behind would get "requires Inwards X or newer" all the time. Major on every release breaks SemVer, since major means incompatible. A `develop` branch adds back-merges and double CI for one maintainer merging one PR at a time.
- *semantic-release:* releases on every push with no review step, and doesn't support 0.x versions.
- *python-semantic-release:* commits and tags straight to `main` on each push, and puts a Python tool in charge of a Bun repository.
- *git-cliff plus our own tag job:* the best changelog renderer, but the bumping, stamping and tagging would all be home-made.
- *changesets:* needs a hand-written changeset file in every PR, which is exactly what the owner wanted to avoid.

## ADR-017: Squash merges with Conventional Commit PR titles

**Status:** Accepted · 2026-09-26

**Context.** Automatic versions and changelogs ([ADR-016](#adr-016-versions-and-releases-come-from-commit-types-via-a-release-pr)) read commit messages on `main`. Up to 2026-09-25 PRs were merged with merge commits, which carried every branch commit into `main`: "review fixes" rounds, work-in-progress commits, and `fix:` commits that fixed work never released. Only 19% of those commits followed Conventional Commits.

**Decision.**

- **The repository allows squash merges only.** The squash commit's title is the PR title and its message is the PR description. Merged branches are deleted automatically.
- **Every PR title is a Conventional Commit**, `type(scope): summary`, checked in CI by `pr-title.yml`.
  - `feat`, `fix`, `perf`, `deps`, `revert` and `docs` appear in the changelog.
  - `refactor`, `test`, `build`, `ci` and `chore` are hidden.
- **A breaking change is marked in the title and explained in the description:** `feat!:` in the title, plus a `BREAKING CHANGE: <what to do>` paragraph in the PR description.
- **Commits inside a branch can say anything.** They never reach `main`.

**Consequences.**

- :material-plus-circle-outline: One PR is one commit and one changelog line.
- :material-plus-circle-outline: A changelog line can be fixed after merging by editing the PR description, with a `BEGIN_COMMIT_OVERRIDE` block.
- :material-minus-circle-outline: `git bisect` on `main` stops at a whole PR, not at a single commit inside it.
- :material-minus-circle-outline: A squash-merged branch isn't an ancestor of `main`, so worktrees are cleaned up with `git branch -D` after checking that the PR is merged.

**Alternatives.**

- *Keep merge commits and lint every commit:* every review-fix commit would need a type, and branch-internal fixes would still reach the changelog.
- *Rebase merges:* the same problem, with one commit per line.
- *Hand-written changelog entries:* rejected in [ADR-016](#adr-016-versions-and-releases-come-from-commit-types-via-a-release-pr).

## ADR-018: Package selectors take globs from the start; monorepos follow uv workspaces

**Status:** Accepted · 2026-09-26

**Context.** Package shape ([#95](https://github.com/SirCypkowskyy/inwards/issues/95)) and its successors (templates [#97](https://github.com/SirCypkowskyy/inwards/issues/97), role rules [#98](https://github.com/SirCypkowskyy/inwards/issues/98)) pick packages by name. Layouts like [fastapi-best-practices](https://github.com/zhanymkanov/fastapi-best-practices) add a package per business domain, and Inwards has to serve a single-package monolith and a monorepo with several projects alike.

**Decision.**

- **Selectors accept globs from v1**, in import-linter's grammar: `a.b` is exact, `a.*` is one segment, and `a.**` is any depth below `a`. The first matching entry wins, and an exact entry hidden by an earlier glob is a config error. The config schema v2 ([#51](https://github.com/SirCypkowskyy/inwards/issues/51)) reuses the same grammar.
- **Monorepos follow uv workspaces** (`[tool.uv.workspace] members = [...]`).
  - Each member keeps its own `[tool.inwards]`, and the nearest config applies to each file, as today.
  - A later workspace-level config may apply one shape or template to every member by reusing uv's `members` globs, so the list of projects isn't repeated in the Inwards config ([#57](https://github.com/SirCypkowskyy/inwards/issues/57)).

**Consequences.**

- :material-plus-circle-outline: A new domain (`src/payments/`) is covered by `src.*` the moment it exists. The agent can't dodge the shape by adding a package the config doesn't name yet.
- :material-plus-circle-outline: Monorepo users describe their projects once, in the place uv already reads.
- :material-minus-circle-outline: Glob precedence has to be explained and tested. A glob can match packages the user didn't mean, so a selector that matches nothing is reported, and so is one hidden by an earlier entry.

**Alternatives.**

- *Explicit package names only in v1, globs later:* simpler at first, but every new domain would need a config change. The config guard ([#23](https://github.com/SirCypkowskyy/inwards/issues/23)) forbids agents from making that change, so every new domain would have to stop and wait for the user.
- *Our own workspace syntax:* would duplicate what uv already defines, and drift from it.

## ADR-019: A `develop` integration branch; `main` moves only at releases

**Status:** Accepted · 2026-09-26 · Supersedes the branching bullet of [ADR-016](#adr-016-versions-and-releases-come-from-commit-types-via-a-release-pr)

**Context.** ADR-016 chose trunk-based development because one maintainer merged one PR at a time. That changed: the owner wants agents from other harnesses (Codex, Cursor and others) to open their own PRs while the coordinating agent works. Several writers need one protected integration branch, and `main` should show only released code. Before this, neither branch had any protection.

**Decision.** The owner chose this model on 2026-09-26:

- **`develop` is the default branch.** Every PR, from any agent or person, targets it and is squash-merged with a Conventional Commit title ([ADR-017](#adr-017-squash-merges-with-conventional-commit-pr-titles)). GitHub has no separate "default base for PRs" setting, so the default branch is what makes a PR from any tool land on `develop` without extra setup.
- **`main` moves only at a release.** A promotion PR `develop` → `main` is merged with a **merge commit**, never squashed, so release-please on `main` still sees one commit per feature PR through the merge. Then the owner merges release-please's release PR into `main` (`target-branch: main` is set explicitly, because release-please would otherwise target the default branch).
- **A release happens in one sitting, with `develop` frozen:** promote, let release-please update its PR, merge it, then reopen `develop`. release-please reads `main`'s history in commit-date order and stops at the last release commit. A squash commit's date is its merge time, so a PR merged into `develop` before a release PR merges, but promoted after it, would come after the stop point and never reach a changelog. Promoting only when releasing, and releasing right after promoting, closes that window.
- **The release commit stays on `main`; nothing is merged back into `develop`.** release-please stamps versions only on lines agents never edit: `CHANGELOG.md`, the manifest, `meta.ts` (a marked line of its own), the `version` fields of the three `package.json` files, `pyproject.toml` and `uv.lock`. At the next promotion git takes those lines from `main` without a conflict. The README and the docs no longer carry a stamped version in their status paragraphs, because agents edit those sentences and every promotion would then conflict. On `develop` the version fields stay at `0.1.0` forever; they agree with each other, so the version check still passes.
- **Rulesets enforce the flow.**
  - Both branches: no direct pushes, no force pushes, no deletion, and the CI checks and the PR-title check must pass. Branches don't have to be up to date, because parallel agents would otherwise rebase each other forever. No approvals are required: every agent shares the owner's account and can't approve its own PR.
  - `develop` accepts squash merges only, and nobody can bypass its ruleset.
  - `main` accepts merge commits only, for the promotion and the release PR alike: a squashed promotion would hide every feature commit behind one `chore:` commit. The owner may bypass the checks on a PR, because release-please's PR is opened with `GITHUB_TOKEN` and gets no CI run. Every agent acts as the owner, so an agent could use that bypass too; AGENTS.md forbids it outside step 3 of a release.
- **CI runs on pushes to both branches. The docs site deploys from `develop`**, since the chapters describe the code as it is, and `main` may lag by a whole milestone.
- **Worktrees live in `~/Documents/GitHub/worktrees/<repo>/<worktree>`**, outside every checkout, so agents from different harnesses find them in one place and none is nested in another repository.

**Consequences.**

- :material-plus-circle-outline: Any number of agents can open PRs at once; the rulesets, not the agents' discipline, keep `develop` green and `main` release-only.
- :material-plus-circle-outline: `main` shows exactly what users can install. The repository page shows `develop`, the default branch.
- :material-minus-circle-outline: A release is now three steps (promote, merge the release PR, publish the draft) instead of two.
- :material-minus-circle-outline: `git log main` has merge commits again. The changelog is unaffected: the promotion's own title is `chore:` and hidden, and its description must not start a paragraph with a commit type.
- :material-minus-circle-outline: A binary built from `develop` always reports `0.1.0`, whatever the latest release is.
- :material-minus-circle-outline: A release freezes `develop` for a few minutes, and a release PR can't sit open for weeks as ADR-016 planned: release candidates are tagged in the same sitting, or on a branch cut for them.
- :material-minus-circle-outline: The docs site can describe features no release has yet. Chapters already mark planned work, and the install guide names the release it applies to.

**Alternatives.**

- *Stay trunk-based and protect `main`:* the simplest option, but then every agent's PR goes straight to the release branch, and the owner wanted a staging branch between agents and releases.
- *`main` as the default branch, plus a workflow that retargets PRs to `develop`:* the repository page would show released code. But every PR would first open against `main`, its first CI and benchmark run would compare with the wrong base, and it adds a workflow to maintain. The owner chose `develop` as the default.
- *release-please on `develop`:* releases would be cut from unpromoted code, and `main` would have no role left.
- *An automatic back-merge of `main` into `develop` after each release:* on a repository owned by a personal account, GitHub Actions can't be a ruleset bypass actor, so the push would need a PAT or a GitHub App secret. Doing it through a PR instead needs an admin bypass on `develop`, because a PR opened with `GITHUB_TOKEN` gets no CI, and that bypass would also let any agent on the owner's account merge a red PR. Since nothing conflicts without it, the owner chose not to back-merge.

## ADR-020: The `init` picker uses @clack/prompts, loaded from a split chunk

**Status:** Accepted · 2026-09-26 · [#92](https://github.com/SirCypkowskyy/inwards/issues/92)

**Context.** `inwards init` on a terminal, with no `--style` or `--agent`, asks for the architecture style, the scaffold and the agent ([#92](https://github.com/SirCypkowskyy/inwards/issues/92)). The prompt library ships inside the one binary ([ADR-003](#adr-003-ship-a-bun-single-file-executable)), but `check` and the hooks start on every agent edit and must not pay for a prompt they never show. The budget in #92 is 3 ms of start-up.

**Decision.**

- **@clack/prompts, pinned to an exact version (1.8.1).** The analysis on #92 measured it at about 61 KB in the compiled binary. Ink plus React adds about 496 KB and 10 to 29 ms of start-up, crashes at start-up under `bun build --compile` unless a plugin stubs `react-devtools-core`, and has recent Windows rendering regressions. @inquirer/prompts has an open Windows select bug.
- **Loaded with a dynamic `import()`** inside the picker, and only when stdin and stdout are TTYs and `CI` is unset. Without a terminal, init exits 2 at once with the flags; it never waits for input.
- **`splitting: true` in `scripts/build-binaries.ts`.** Without it, Bun inlines the dynamically imported module into the one bundle: its code runs only when imported, but every start still loads it. Measured on Linux x64 against `develop` built with the same flags, 150 to 300 alternating runs each, median of per-pair differences:

    | Build | `--version` | small `check` | hook run |
    |---|---|---|---|
    | Without bytecode, no splitting | +5.2 ms | +5.9 ms | +5.2 ms |
    | Bytecode ([#118](https://github.com/SirCypkowskyy/inwards/pull/118)), no splitting | +1.7 ms | +1.7 ms | +1.1 ms |
    | Bytecode and splitting (adopted) | -0.1 ms | +0.0 ms | -0.1 ms |

    With splitting the library is its own chunk inside the binary, read only when the picker runs. The #29 benchmark agrees: hook -0.0%, full check -1.8%.

**Consequences.**

- :material-plus-circle-outline: `check` and the hooks keep their start-up; the picker's cost falls on the one command that shows it.
- :material-plus-circle-outline: A later lazily loaded feature gets the same treatment for free.
- :material-minus-circle-outline: The build writes a `chunk-*.js.map` next to each binary in `dist/`. The release upload already takes only `inwards-*` files.
- :material-minus-circle-outline: The picker can't be tested in CI, which has no TTY. It was driven through a pseudo-terminal on Linux; Windows Terminal, PowerShell and macOS Terminal still need a check by hand (#92).

**Alternatives.**

- *Ink:* richer layouts, but see the numbers above.
- *Hand-written prompts on raw stdin:* no dependency, but cursor handling, resize and Windows consoles are what the library already gets right.
- *Bytecode alone:* it cuts the library's cost from about 5 ms to 1 to 2 ms, but a 10 ms start-up still pays it on every hook call for a prompt the hook never shows.

## ADR-021: Publish the release wheels to PyPI from their own workflow, with trusted publishing

**Status:** Accepted · 2026-09-26 · [#32](https://github.com/SirCypkowskyy/inwards/issues/32)

**Context.** Design partners should install with `uv add --dev inwards`. `cd.yml` already builds five platform wheels, runs each binary and installs each wheel on its own runner, and attaches them to a draft GitHub Release ([ADR-016](#adr-016-versions-and-releases-come-from-commit-types-via-a-release-pr)). The owner publishes that draft by hand. PyPI never accepts the same file name twice, so a wrong upload can't be undone, and the owner wants no PyPI upload by accident. The repository is private for now, and every agent works under the owner's GitHub account.

**Decision.**

- **Trusted publishing** (OIDC) with `pypa/gh-action-pypi-publish`, pinned by commit SHA. No PyPI token is stored anywhere.
- **Its own workflow, `pypi.yml`, not a job in `cd.yml`.** It starts when a release is published, never on a draft, or by hand with a tag and an index. `cd.yml` ends at the draft and can't see the owner publish it. PyPI trusts only `pypi.yml`, which runs no build or test code.
- **It uploads the release's own wheels**, the files the owner just published, after checking them against the release's `SHA256SUMS`, and against the build provenance once the repository is public. It never rebuilds them.
- **TestPyPI first, then PyPI**, each in its own GitHub environment (`testpypi`, `pypi`) that the publisher on each index is bound to. Only the two upload jobs get `id-token: write`.
- **A pre-release goes to TestPyPI only**, whether the release is marked as one or its tag has a suffix (`-rc.1`). PyPI has a 0.0.0 final placeholder, so uv would pick it over any pre-release anyway. An rc can still go to PyPI by a manual run from its tag.
- **The real gate is the owner's pypi.org account.** Every agent works under the owner's GitHub account, so the variable, the environments, tags and manual runs are all within an agent's reach, and PyPI doesn't check a run's ref or commit. The PyPI publisher is therefore registered last, at go-live, and deleting it stops every PyPI upload. On the GitHub side, the repository variable `PYPI_PUBLISH` must be `true` for any PyPI upload, from a release or a manual run; the `pypi` environment deploys only from `v*` tags; and it gets the owner as required reviewer once GitHub offers that (public repository, or Enterprise). These catch mistakes, not an agent.
- **No PEP 740 attestations while the repository is private.** They are signed through Sigstore's public transparency log with the repository, workflow and commit in them.

**Consequences.**

- :material-plus-circle-outline: A release reaches PyPI with the exact bytes users could already download from GitHub, and that were run on every platform.
- :material-plus-circle-outline: Trusted publishing works from a private repository: PyPI checks the owner, repository, workflow file and environment, not the visibility.
- :material-minus-circle-outline: Once the PyPI publisher exists, an agent acting as the owner can set `PYPI_PUBLISH`, push a `v*` tag (no ruleset protects tags) and start an upload; even a required reviewer can be approved through the API as the owner. Only `AGENTS.md` holds agents back then, and the owner can delete the publisher between releases.
- :material-minus-circle-outline: A draft's wheels and `SHA256SUMS` can be replaced by hand before publishing. While private, the checksum check proves only that they agree with each other.
- :material-minus-circle-outline: The five wheels of v0.1.0-rc.1 weigh 170 MB together, against PyPI's default limit of 10 GB per project: roughly 60 releases before asking PyPI for more.
- :material-minus-circle-outline: A release built while private has no provenance. Once the repository is public, `pypi.yml` refuses to upload it.

**Alternatives.**

- *Upload from `cd.yml` right after the verify jobs:* PyPI would get a version before the owner has looked at the draft, and the trusted workflow would also run `bun install` and the build.
- *Download the build artifact of the `cd.yml` run:* it expires after 90 days, has to be found by run ID, and isn't what the owner published.
- *A project-scoped API token as an environment secret:* a long-lived credential to rotate, and one that works from any machine it leaks to.
- *A reusable workflow called from `cd.yml`:* PyPI can't use a reusable workflow as a trusted publisher.

## ADR-022: M2 go or no-go: continue, conditionally, until partner data

**Status:** Accepted, provisional · 2026-09-26 · [#42](https://github.com/SirCypkowskyy/inwards/issues/42) · To be revisited with partner data ([#132](https://github.com/SirCypkowskyy/inwards/issues/132))

**Context.** M2 ends with a checkpoint: do the numbers in the [business hypothesis](02-Business-Context.md#business-hypothesis) hold well enough to spend M3 to M6 on it? The hypothesis was meant to be measured on design partners' repositories, but the owner moved partner recruiting to the end of the roadmap, so no partner data exists. The evidence available on 2026-09-26:

| Bet (chapter 2) | Threshold | Evidence | Reading |
|---|---|---|---|
| The fix steps work for models | ≥ 80 % fixed within one retry | The agent eval ([#101](https://github.com/SirCypkowskyy/inwards/issues/101), `eval/README.md`): 11 fixtures, one run each on Sonnet and Haiku, full hook set. `inwards stats`: 5 of 7 (71 %). The 2 unfixed are the "loosen the config" task, where the agent correctly stopped and asked the user. Of the 5 fixed, 3 ended with the task not done (2 reverted and asked the user), so only 2 were clean fixes with the task done | Points the right way (no violation stayed, no evasion), but 7 seeded violations settle nothing |
| Agents break layering often enough | ≥ 1 violation per 1,000 agent-written lines | 25.5 per 1,000 lines in the eval, but its fixtures are built to tempt a violation | No evidence either way |
| Speed is the moat | Hook p50 < 100 ms | Eval: p50 21 ms, p95 28 ms, on the 10-file example app. Local hook p50 about 32 ms after bytecode ([#39](https://github.com/SirCypkowskyy/inwards/issues/39)). Five real services ([#36](https://github.com/SirCypkowskyy/inwards/issues/36)): 55 to 83 ms per file locally; one 4,500-line file was 280 ms on a GitHub runner before bytecode ([#122](https://github.com/SirCypkowskyy/inwards/issues/122)) | Holds, with one known outlier |
| Hooks are the channel | ≥ 60 % of installs keep a hook | Partner-reported only; nothing yet | Unknown |
| Room next to Astral | Adopted alongside Ruff and ty | Nothing new since M0 | Unknown |

The eval also showed what the checks can't: no evasion in any final diff; the config guard, the deny rules and the Stop gate each held when an agent tried to loosen the rules or switch the hooks off. And one weakness: without a baseline, the Stop gate kept agents working until violations that were already in the files they edited were gone, and in all 6 such runs they rewrote code nobody asked them to touch ([#134](https://github.com/SirCypkowskyy/inwards/issues/134)).

**Decision.** The owner chose to continue, conditionally:

- **Continue with M3 as planned**, with [#134](https://github.com/SirCypkowskyy/inwards/issues/134) (the Stop gate blocks only on violations new in each edited file) moved to P0 at the start of M3: an agent rewriting unrelated code is the failure mode most likely to make a team switch the hooks off, which is the channel bet.
- **The decision is provisional.** It is revisited on partner data as part of [#132](https://github.com/SirCypkowskyy/inwards/issues/132): the same table, filled with `inwards stats` from partner repositories. If "fixed within one retry" stays under 50 %, or hooks are switched off at most installs, the plan for M4 to M6 is reopened.
- **The eval stays the interim measure.** Before the partner review, it is rerun with 3 runs per case on each model (`bun run eval/run.ts --runs 3`), which #101 left open to keep spend small.

**Consequences.**

- :material-plus-circle-outline: Work continues on the part of the hypothesis the evidence supports (speed, fix steps, resistance to evasion) without waiting months for partners.
- :material-plus-circle-outline: The criteria that would reopen the plan are written down now, before the data can bias them.
- :material-minus-circle-outline: Two bets (violation frequency, hook adoption) have no evidence at all; M3 to M6 could be built for a problem partners don't have.
- :material-minus-circle-outline: The eval's fixtures come from the same people who built the tool, which makes them a weak stand-in for real repositories.

**Alternatives.**

- *Continue without conditions:* cheaper to state, but it would treat numbers from 7 seeded violations as if they settled the hypothesis.
- *Pause until partner data (move recruiting, #132, to M3):* the most rigorous option. The owner kept recruiting at the end of the roadmap, and the measurable bets point the right way.
- *Stop or pivot:* nothing measured contradicts a threshold, so there is no case for either.

## ADR-023: Libraries per layer, with a default deny list for the innermost layer

**Status:** Accepted · 2026-09-26 · [#47](https://github.com/SirCypkowskyy/inwards/issues/47)

**Context.** INW001 only sees first-party layers, so `from sqlalchemy.orm import Session` in the domain passes it, and it is the most common leak in layered Python code. Telling a library apart from first-party code must not need a virtualenv (C4): Inwards never imports user code, so it can't ask Python where a module comes from.

**Decision.**

- INW005 `pure-domain` checks every import of a file in a layer that is neither first-party (a layer or the INW006 file-system probe owns it) nor allowed by the layer's `allow-libraries` / `deny-libraries`. Entries are module names that cover their submodules; the longest matching entry decides, `allow` on a tie.
- `allow-libraries` makes the layer an allowlist for third-party code only. The standard library stays allowed, told apart by a bundled list: the union of `sys.stdlib_module_names` on CPython 3.11 to 3.14, plus the modules older versions had.
- Entries must be dotted Python identifiers. A glob or a distribution name would match nothing and, on the innermost layer, silently drop the default.
- The innermost layer of a config with two or more layers denies a fixed list of frameworks, database and network clients and stdlib I/O unless it sets `deny-libraries`, which replaces the list rather than extending it. A one-layer config gets no default: its only layer is the whole app, not a domain.
- The message names the library's top-level package, never the configured lists, so a baseline entry survives a change to them. The fix names the deny entry that matched (`http.client`, which `allow-libraries = ["http"]` would not override) and every outer layer the config lets use the library; the agent picks the one that holds adapters, since layer order doesn't say which one that is in a hexagonal layout.

**Consequences.**

- :material-plus-circle-outline: Existing configs with two or more layers catch SQLAlchemy, FastAPI or Requests in the domain with no config change.
- :material-minus-circle-outline: That is also a new source of errors on upgrade for projects whose domain uses such a library on purpose. `deny-libraries = []` or an `allow-libraries` entry turns it off, and `inwards baseline` accepts what is there.
- :material-minus-circle-outline: Import names are matched, not distribution names (`PyYAML` is `yaml`), and a stdlib module newer than the bundled list counts as third-party.

**Alternatives.** *Read installed distributions from the virtualenv*: exact, but breaks C4 and fails in CI images without the dependencies. *Default deny for every layer but the outermost*: guesses too much about what an application layer may use. *Name the configured list in the message*: a changed list would bring back every baselined violation.

## ADR-024: A Polish translation as a second build, translated in the same PR

**Status:** Accepted · 2026-09-26 · [#149](https://github.com/SirCypkowskyy/inwards/issues/149)

**Context.** The owner wants the docs in Polish too, with a language switcher. Zensical 0.0.65 builds one language per project: internationalization is on its roadmap, and today a header selector (`extra.alternate`) links to other builds. Its built-in switcher maps pages through the other build's sitemap and assumes sibling roots (`/en/`, `/pl/`), but the English site already lives at `/inwards/`, and the CLI's `docs:` links point there. Zensical can't exclude a Markdown file inside `docs_dir`, and it doesn't follow symlinked directories.

**Decision.**

- **Two builds.** `docs/chapters/` stays English at `/inwards/`. `docs/pl/` mirrors every page in the English nav at the same path, and `docs/zensical.pl.toml` builds it into `docs/site/pl/`, so one Pages artifact holds both. The Polish pages take images, CSS and scripts from the English site through `../` paths instead of copies.
- **The switcher keeps the page.** A theme override (`docs/overrides/partials/alternate.html`) links each language to the same page in the other build, and `language-switch.mjs` keeps those links current (instant navigation doesn't re-render the header, so they would go stale) and, on click, falls back to the language root when the page doesn't exist. Polish headings keep the English anchors (`{ #id }`), so the switch keeps the `#anchor` too.
- **The agent translates, in the same PR as the English change** (the owner chose this over machine translation in CI, a machine draft plus review, or community translation). `docs/GLOSSARY.pl.md` fixes the terms and sits outside both `docs_dir`s, so it isn't published. A subagent reviews terminology and meaning like any other PR.
- **Staleness is tracked by hash.** Each Polish page records `source` and the SHA-256 of the English file it was translated from. `scripts/check-docs-translation.py` fails CI on a missing or orphaned page, a committed banner, or configs whose theme, extensions or assets drift apart, and warns on a stale page; the deploy adds a "may be out of date" banner to stale pages in its checkout.
- **Everything is translated except** code blocks, CLI output, config keys, diagnostic messages, identifiers and the changelog. ADR bodies are translated in full.

**Consequences.**

- :material-plus-circle-outline: English URLs and anchors don't change, and a reader switching language lands on the same section.
- :material-plus-circle-outline: A missing translation can't merge, and a stale one is visible to readers instead of silently wrong.
- :material-minus-circle-outline: Every docs PR also touches `docs/pl/`, and the translation is only as good as the review.
- :material-minus-circle-outline: The Polish build is only complete inside the English one: `zensical serve -f docs/zensical.pl.toml` shows no screenshots or custom styles.
- :material-minus-circle-outline: A hash changes on any edit, a typo fix included, so some "stale" warnings need only `--fix-hashes`.
- :material-minus-circle-outline: GitHub Pages serves only the root `404.html`, so a missing page under `/pl/` shows the English 404 page (its language switcher still works).

**Alternatives.** *English under `/en/` next to `/pl/`:* the built-in switcher would work, but every existing link and the CLI's `docs:` URLs would move. *Machine translation on each merge:* always in sync, but it needs a secret and a budget, terminology drifts between runs, and nobody reviews it. *Copies of the assets in `docs/pl/`:* self-contained, but two copies of every screenshot to keep equal.

## ADR-025: INW010 probes the disk for existence and checks only the module part of an import

**Status:** Accepted · 2026-09-26 · [#45](https://github.com/SirCypkowskyy/inwards/issues/45)

**Context.** INW010 flags an import of a first-party module that doesn't exist. The module index offers two answers to "does it exist": its listing (`modules`) and a probe of the file system (`ownerOf`). The listing misses namespace packages, modules behind a symlink that leaves the root, and anything under node_modules, `__pycache__` or a virtualenv, and the CLI and the language server list layer packages differently. Neither answer knows compiled extensions (`name.cpython-313-x86_64-linux-gnu.so`), which the probe can't spell. An import statement doesn't say which of its parts is a module either: `from shop.domain import pricing` imports a submodule or a name defined in `shop/domain/__init__.py`. And a package can extend its `__path__` (`pkgutil.extend_path`, `pkg_resources.declare_namespace`) to share its top-level name with an installed distribution: polar in the corpus does this with its SDK, and 79 of its imports name modules only the SDK has.

**Decision.**

- Existence is decided by `ownerOf`, which probes the disk the way Python imports, never by the listing.
- When the probe finds a module missing, the package it would live in is listed once (`ProjectFiles.listDir`). A compiled extension (`.so`, `.pyd`, with or without an ABI tag), Cython source (`.pyx`) or bytecode (`.pyc`) of that name counts as the module. The fix suggests the three members of that package closest to the missing name by edit distance, never the importing file or its own package.
- Only the module part is checked: `X` of `from X import name`, the whole name of `import X` and `from X import *`. The `name` is never checked.
- An import is first-party when a prefix of it probes as a first-party module (a top-level package needs an `__init__.py`, as for INW006). One under a package whose `__init__.py` mentions `__path__` or `declare_namespace` passes.
- A relative import that climbs above the top-level package is an INW010 error too: Python refuses it whatever is on disk.
- Only static imports in files inside a layer are checked. An import INW010 reports gets no INW006 as well, which would contradict it, and an outward import INW001 reports gets no INW010: INW001's fix deletes the import, while INW010's would create the module.
- The suggestions go in the fix steps, not the message, so a baseline key doesn't change when modules are added.
- The index probes each path once. The language server rebuilds the index, and checks the open documents again, when a path that could be a module is created or deleted (a `.py`, `.pyi`, extension or bytecode file, or a directory, outside hidden directories, caches, node_modules and site-packages), so creating the missing module clears the error without a keystroke. With a client that can't report file events, it builds a fresh index for each check instead, so the error clears at the next keystroke.

**Consequences.**

- :material-minus-circle-outline: `from shop.domain import pricing` with no `pricing` passes when `shop/domain` is a package.
- :material-minus-circle-outline: A module generated at build time (`_version.py`, `*_pb2.py`) is reported until it exists in the checkout ([#160](https://github.com/SirCypkowskyy/inwards/issues/160)), and so is an optional import behind `try/except ImportError`. A namespace package shared with an installed distribution is reported as missing ([#161](https://github.com/SirCypkowskyy/inwards/issues/161)).
- :material-minus-circle-outline: The language server rebuilds only on create and delete, so an `__init__.py` edited to extend its `__path__` takes effect at the next create or delete.
- :material-minus-circle-outline: A finding in the hook costs the confirming full parse every finding costs (ADR-004) and one directory read: on saleor, `webhook/payloads.py` (1,301 lines) goes from 38.8 ms to 71.6 ms p50, about what an INW001 finding in that file costs on develop (70.1 ms); `channel/tasks/saleor3_22.py` from 27.4 to 32.7 ms.
- :material-plus-circle-outline: No false positive on the five corpus repositories (6,543 files) or the examples. The four findings, all in saleor, are real broken imports: a `TYPE_CHECKING` import of `saleor.translation.models`, which doesn't exist (the class lives in `saleor.core.utils.translations`), an import of `saleor.models`, and two relative imports that climb above `saleor`.
- :material-plus-circle-outline: The editor and the CLI agree whatever each lists, since neither decision nor suggestion reads the listing.
- :material-plus-circle-outline: Every import in a layered file is probed now, not only those outside every layer; probing each path once keeps the whole-project cost level: saleor's full check takes 1.96 s against 2.15 s on develop (median of 8 alternating local runs), and on the synthetic repo the hook is 2.9 % slower and the full check 1.3 % faster (`bench/compare.ts`, threshold 20 %).

**Alternatives.**

- *Membership in `modules`:* false errors in the editor for namespace packages and anything a listing skips (the review of [#153](https://github.com/SirCypkowskyy/inwards/pull/153)), and a walk of the whole project for each finding's suggestions, which cost the hook 50 to 130 ms on saleor.
- *Read `__init__.py` to check `from X import name`:* a star import or a module-level `__getattr__` can define any name, so a text check would guess.
- *Skip imports inside `try/except ImportError`:* an agent could then silence the rule by wrapping the import, the escape hatch the fix steps close.
- *Drop the probe cache in the language server:* stays correct, but an open document would still show a stale error until the next keystroke. That is what a client without file events gets.

## ADR-026: Report unreadable dynamic-import targets in inner layers

**Status:** Accepted · 2026-09-26 · [#46](https://github.com/SirCypkowskyy/inwards/issues/46)

**Context.** [ADR-015](#adr-015-check-literal-dynamic-imports-as-inw011) checks a dynamic import only when its target is a constant string, and left the rest for a separate decision. Everything else passed silently: `importlib.import_module(name)`, `import_module(f"shop.{layer}.db")`, `exec(code)`, a relative `import_module` whose `package` is a variable, and a literal with a `\N{...}` escape (decoding one needs the Unicode name table, which the engine doesn't ship). For an agent that INW011 has just blocked, putting the module name in a variable is the next dodge, and Inwards can't evaluate it without running user code (C4).

**Decision.**

- A loader call whose target Inwards can't read is reported as INW011, severity error, with a message saying the target can't be verified. That covers `import_module` with a name that isn't a literal, or a relative name whose `package` is given but isn't a literal, `__package__` or `__name__`; `__import__` with a computed name or `level`, or a `fromlist` that isn't `None` or a list or tuple of literals; `run_module` with a computed name; and `exec` or `eval` with a computed source. An argument that isn't found while the call passes `*args`, or a `**kwargs` that isn't a literal dict with string keys, counts as computed, since the splat may hold it; a literal `**{"package": "shop"}` is read exactly. Loaders are recognised through the same aliases as in ADR-015, and a computed call inside a literal `exec` source counts at the outer call.
- It is reported only in layers that have an outer layer. In the outermost layer every first-party target is allowed by direction, so there is nothing to verify, and that is where plugin loaders and composition roots belong. Files outside every layer stay unchecked.
- The fix gives two ways out: write the target as a literal (or as an import statement), or move the loader to the outermost layer and pass what it loads in through a parameter typed against a `typing.Protocol` of the inner layer.
- `compile` with a computed source is not reported. It only builds a code object, and running that takes `exec` or `eval`, which are. This also keeps `from re import compile` followed by `compile(pattern)` quiet, since ADR-015 always reads `compile` as the builtin. `exec(compile("<literal>", ...))` isn't reported either, as long as `compile` isn't rebound by the check below: the literal is read at the `compile` call.
- A bare `exec` or `eval` with a computed source is skipped only when the code surely rebinds that name at the call. The binding must be a `def`, `class`, plain assignment or import placed directly in the module body, before the top-level statement that holds the call, or directly in the body of a function that encloses the call; or a parameter of a function or lambda whose body holds the call; or a `for` target inside its loop. Bindings under `if`, `try`, `with` or `while` don't count. The exemption is off for the whole file when any binding of the name could be the builtin: an assignment, walrus, `for`, `with` or `except` target, or parameter default whose value mentions a loader or a module that holds one (`exec = exec`, `eval = builtins.eval`, `def run(code, exec=exec)`); a `def` or `class` whose decorators or class arguments (bases, `metaclass=`, keywords) mention one; or an import from `builtins`, `importlib`, `runpy`, a relative module or a first-party module, since first-party code may re-export the builtin (the engine's module index decides what is first-party). A `global`, `nonlocal` or `del` of the name turns it off too, and so does a wildcard import or any mention of `globals`, `vars`, `locals`, `setattr`, `delattr`, `__dict__`, `__builtins__` or `sys.modules`, through which code can put the builtin back. PyTorch training code often defines `eval(model, loader)`, and reporting it as a dynamic import would be noise with a nonsense fix. A literal source is still read whatever the name is bound to, as ADR-015 decided.
- Calls that fail at runtime stay unreported: a relative `import_module` with no `package`, `package=None` or `package=""`, a relative `run_module`, an empty name.
- A name bound to several loaders reports each load once.
- Severity error, like the rest of INW011. Warnings pass the CLI exit code, the hook and the Stop gate, and they are not baselined, so a warning would let the dodge through.

**Consequences.**

- :material-plus-circle-outline: The variable-name dodge is reported, through every alias ADR-015 follows. Tests cover each loader, the aliases, f-strings, variables, `\N{...}` literals, arguments behind `*args` and `**kwargs`, a relative `import_module` with an unknown package, and every rebinding of `exec`, `eval` or `compile` that doesn't shadow the builtin at the call. The loader hint needs no change, and `prescan-diff` still misses nothing.
- :material-minus-circle-outline: Legitimate runtime loaders in inner layers are reported. On the real-repo corpus (5 repositories, 6,543 files) the change adds 4 findings, each an `import_module(path)` that loads a configured class or plugin: one in python-ddd's `seedwork.application`, three in saleor (`saleor.core.telemetry`, `saleor.plugins`, `saleor.schedulers`). Their teams would move each loader outward or baseline it.
- :material-minus-circle-outline: Constant targets that aren't literals (a module-level `TARGET = "..."`, `str.format`, `%`, f-string conversions such as `{'shop'!s}`) were reported as unverifiable instead of passing. [#79](https://github.com/SirCypkowskyy/inwards/issues/79) folds them, so they are now reported exactly; a name that may be rebound stays unverifiable.
- :material-minus-circle-outline: The rebinding exemption misses the builtin passed in as an argument: `def run(exec, c): return exec(c)` called as `run(exec, code)` is not reported, since the parameter shadows the builtin inside `run`. It also misses a builtin reached through an object that names neither a loader, `__self__`, `__globals__` nor a namespace writer. Since [#79](https://github.com/SirCypkowskyy/inwards/issues/79), `print.__self__` counts as the `builtins` module, so `exec = operator.attrgetter("exec")(print.__self__)` turns the exemption off. Being conservative, it reports some calls that are not the builtin: a comprehension variable (`[eval(m) for eval in evaluators]`), a method name used inside its own class body, a `match` capture, any binding under `if` or `try` or made through `global` even when it does run before the call, and every rebinding in a file that touches a namespace writer or has a wildcard import.
- :material-minus-circle-outline: The report is about direction only. In the outermost layer an unverifiable call can still reach first-party code outside every layer (INW006) without a report, and a `compile` code object run by something other than `exec` or `eval` (`types.FunctionType`) is missed.

**Alternatives.** *Report in every layer, the outermost too*: flags composition roots and plugin registries, where a runtime loader is the right design. *Warning instead of error*: passes the hook and the Stop gate, so the agent's dodge would still land. *Resolve known prefixes* (`f"shop.plugins.{name}"` can only reach `shop.plugins`): fewer reports where the prefix sits in an inner layer, but more code for a case the corpus doesn't have yet; a later issue can add it if real projects need it. *Flag every loader call in an inner layer, literal or not* (an ADR-015 alternative): reports `import_module("json")` too.

## ADR-027: Per-rule `select`, `ignore` and `severity` in a `[tool.inwards.rules]` table

**Status:** Accepted · 2026-09-26 · [#43](https://github.com/SirCypkowskyy/inwards/issues/43)

**Context.** A team adopting Inwards on a legacy codebase wants to turn rules on one at a time, or see a rule's findings as warnings before they block. Ruff users expect `select` and `ignore`, but `[tool.inwards]` already has an `ignore` key: module names left out of the INW006 unassigned-package warning, which `inwards init` writes. Diagnostics come from the engine and from five checks the adapters call directly (`checkShape`, `checkRequired`, `checkSelectors`, `checkPrefixes`, `checkMoves`), and the Stop gate compares configs as JSON.

**Decision.**

- **A sub-table.** `[tool.inwards.rules]` holds `select` and `ignore`, lists of rule codes, and `severity`, a table from code to `"error"` or `"warning"`. The top-level `ignore` keeps its meaning. Without `select` every rule reports; `ignore` wins over `select`. `severity` sets the level of every finding of a rule, including findings a rule reports at a level of its own: with `INW006 = "error"`, the per-package warning becomes an error.
- **Exact codes, validated.** A code the registry doesn't have is a config error, like an unknown key. No prefixes: codes aren't grouped by category, and a prefix such as `INW00` would silently take in rules that ship later. An empty `select` is an error too, since turning rules off is `ignore`'s job.
- **INW000 is fixed.** `ignore` and `severity` can't list it, and `select` doesn't turn it off. A file whose declared encoding can hide imports gets INW000 instead of a check, so turning INW000 off or down would let that file pass unchecked.
- **The session layout check is fixed too.** The Stop gate's INW006 comparison with the session start (a prefix emptied since then, layer code moved out of every layer) ignores the table. It is the defence against `mv shop/domain shop/core`, a dodge rather than a rule a team phases in, and with `select = ["INW001"]` or `ignore = ["INW006"]` that move would pass.
- **Applied in the core, last.** Every other core function that returns diagnostics to an adapter applies the table, so `inwards check`, the hooks, the Stop gate and the language server agree. `Engine.checkFiles` applies it after keeping INW006's per-package warning once per package, so a configured severity doesn't change how many copies are reported. The rules still run; their findings are dropped or re-levelled afterwards.
- **A warning is a warning.** A rule set to `"warning"` shows up in every format but, like any warning, doesn't change the exit code, block the per-edit hook or the Stop gate, or go into the baseline.
- **Baseline.** `inwards baseline` records only what the check reports, so it leaves out rules that are off or at warning. Entries already in the file for such a rule are dormant: they don't count as fixed (`resolved`), `inwards baseline` keeps them, and they apply again once the rule is back at error. The other way round, an entry taken while a rule was raised to error is used up by the matching warning once the rule is back at its default, so it doesn't count as fixed either.
- **SARIF.** `rules[]` still lists every registered rule with the registry's default in `defaultConfiguration.level`. Each result carries the configured `level`, which is what viewers show. A rule that is off has no results.
- **Run log.** `codes` and `severities` record what was reported, after the table.
- **Guarded like the rest.** The table is inside `[tool.inwards]`, so the config guard denies an edit that changes it and the Stop gate fails a change made through Bash. Tests pin both.

**Consequences.**

- :material-plus-circle-outline: A team can phase rules in without a baseline, and show a rule as warnings before it blocks.
- :material-plus-circle-outline: No per-adapter code path: the language server picks up the table with no change of its own.
- :material-minus-circle-outline: `rules.ignore` and the top-level `ignore` share a word but not a meaning. Renaming the top-level key is a breaking change, left for the config schema v2 ([#51](https://github.com/SirCypkowskyy/inwards/issues/51)).
- :material-minus-circle-outline: A rule that is off still costs its check time. Skipping it would mean passing the table into every rule, to save a few milliseconds.
- :material-minus-circle-outline: A config that names a rule only a newer Inwards knows fails with exit 2; `required-version` gives the clearer message.
- :material-minus-circle-outline: INW006 can't be fully turned off: the session layout check still blocks a layer moved away.
- :material-minus-circle-outline: The language server reads the table when it starts, so a change needs a restart, and a config error (an unknown code, say) only reaches its output channel ([#163](https://github.com/SirCypkowskyy/inwards/issues/163)).
- :material-minus-circle-outline: After a Bash edit of the table, the Stop gate fails on the change but checks with the edited config, so it doesn't list what the edit hides ([#164](https://github.com/SirCypkowskyy/inwards/issues/164)).
- :material-minus-circle-outline: No per-file or per-path settings. Those belong with suppressions ([#50](https://github.com/SirCypkowskyy/inwards/issues/50)).

**Alternatives.** *Top-level `select` and `ignore`, as in Ruff:* familiar, but `ignore` is taken, and telling `INW001` from a module named `tests` by its shape is a guess. *One key per rule, `INW001 = "off"`, as in ESLint:* compact, but it can't say "only these rules". *Code prefixes:* see above. *Filtering in each adapter:* four call sites (the check, the Stop gate's layout check, two in the language server) that could drift apart.

## ADR-028: Inline suppressions need a reason, and an agent can't add one by default

**Status:** Accepted · 2026-09-26 · [#50](https://github.com/SirCypkowskyy/inwards/issues/50)

**Context.** A team sometimes has to accept one import for good: a legacy adapter, a vendored module, a generated one. The baseline accepts violations as a set and is meant to shrink, and `[tool.inwards.rules]` works per rule, not per line. Ruff, mypy and ESLint answer this with a comment on the line. For Inwards a comment is also the cheapest way for an agent to turn a check green, and a hook can't tell who wrote a line. The #134 machinery already reads a file as it was at session start, safely, from the git blob the start manifest vouches for.

**Decision.**

- **Syntax.** `# inwards: ignore[INW001] reason="why"` hides every finding of the named rules that points at the comment's line, however many there are (`from x import a, b` gives two). Several codes go in one comment (`ignore[INW001,INW005]`), and the directive may follow another tool's comment on the same line; a second directive in the same comment is an INW009 error rather than being read or dropped silently. The line is the one the diagnostic points at: for a parenthesised import, the imported name's line, not the `from` line; for a dynamic import spread over several lines, the call's first line. No blanket form without codes, no file-level form, no next-line form: each would hide more than the finding someone looked at.
- **Accountable.** The reason is mandatory. A comment that is malformed, has an empty or missing reason, or names a code that is unknown or can't be suppressed hides nothing and is itself an error, INW009 `suppression-comment`. A valid code that matches no finding on its line is an INW009 warning, since it would silently hide a new finding there later; a rule that is off in `[tool.inwards.rules]` isn't reported as unused. INW009 follows the table like any rule.
- **What can be suppressed.** Every rule that points at a line of Python: INW001, INW005, INW006, INW010, INW011 and rules added later (for INW010, a generated module that a fresh checkout lacks, [#160](https://github.com/SirCypkowskyy/inwards/issues/160)). Not INW000 (the file isn't checked at all, so under its declared encoding a "comment" may be code), INW007 and INW008 (they are about the package tree; the shape config is the place to change them) and INW009 itself. A file with INW000 has no suppressions read at all.
- **Read from the syntax tree.** Comments come from a full parse, so `x = "# inwards: ignore[...]"` doesn't count. A file whose text mentions `inwards: ignore` skips the import skeleton and goes straight to the full parse, which yields its imports and its comments from one tree, so it costs what a file with a violation costs. Skipping the skeleton only makes the check more exact; the prescan and its soundness argument ([ADR-004](#adr-004-parse-the-import-skeleton-confirm-with-a-full-parse)) are untouched.
- **Applied in the core.** `Engine.checkFile` and `Engine.check` apply suppressions per file, before `[tool.inwards.rules]`, so the CLI, the hooks and the language server agree. `Engine.check` also returns the suppressed findings with their reasons; `checkFiles` keeps returning only what is reported.
- **Visible.** Text and concise output end with "N findings suppressed by inline comments", and the JSON summary has `suppressed` (only when there are some). SARIF lists each suppressed finding as a result with an `inSource` suppression whose `justification` is the reason, so code scanning shows it as suppressed rather than losing it. The run log records `suppressed` and `rejected` per run, and `inwards stats` counts rejected suppressions.
- **`agent-suppressions = "deny"` by default.** In the Claude Code hooks, a suppression is honoured when its file is byte for byte what it was at session start (the start manifest's SHA-256), since the agent didn't touch it, committed or not; otherwise only if the file, as it was at session start (the #134 git blob), had the same finding (rule, module, message) suppressed too, in the same file, copy for copy. The file matters because `order.py` and `order.pyi` share a module: a suppression moved from one into the other is new. A suppression the agent adds, copies to another import, moves, or widens with another code isn't honoured, and neither is one in a file the agent created, renamed or linked. Both checks, and the #134 one, follow one invariant: a file has a start identity only when its path as written (the cwd as given joined with the file path, `..` applied as text, relative to the real project root) equals its physical path, and the file isn't itself a symlink. So a new symlinked file (`ln -s order.pyi order.py`), a cwd inside a new symlinked directory, `..` through either, or a start file swapped for a link to the same bytes can't borrow a start record. The Stop gate re-checks a start file that lost its identity even when its content hash is unchanged. The finding is then treated exactly as if the comment weren't there: a baseline entry still accepts it, a violation the file had at session start is still context (#134), and anything else blocks like any other violation, with a note saying why. To make that work, a suppressed finding uses up a matching baseline entry, after the reported ones, so the entry doesn't count as fixed either. Editing only the reason of an existing suppression changes nothing. The mode is read from the session-start config, so a Bash edit of it changes nothing in the hooks and fails the Stop gate; the config guard covers it like every `[tool.inwards]` key. `"allow"` honours every suppression. `inwards check`, CI and the language server always honour suppressions: they have no session to compare with.

**Consequences.**

- :material-plus-circle-outline: One accepted import no longer needs a baseline or a rule turned off, and every such exception carries its reason in the code, next to the import.
- :material-plus-circle-outline: An agent can't silence a violation with a comment unless the owner opts in, and a rejected attempt shows up in `inwards stats`.
- :material-plus-circle-outline: Adding the feature changes nothing for existing projects: no file has a suppression yet, and the new key is optional.
- :material-minus-circle-outline: Under `"deny"`, a suppression in a file that was uncommitted or untracked at session start, or in any file of a project outside git, counts as new once the agent edits that file, because the hooks can't prove its start content ([#134](https://github.com/SirCypkowskyy/inwards/issues/134)). A file the agent leaves alone keeps its suppressions. The owner commits a suppression before handing the file to an agent.
- :material-minus-circle-outline: Moving a suppression between two imports that give the same finding (the same target twice in one module) isn't noticed. It hides nothing new.
- :material-minus-circle-outline: Renaming or moving a file with a suppression makes the suppression new, since the new path has no start content. So does reaching a file through any symlink inside the project, even one that existed at session start.
- :material-minus-circle-outline: A reason can't contain `"`, and nothing checks that it says anything useful. Review does.
- :material-minus-circle-outline: A file with a suppression always gets the full parse, which a clean file without one skips.
- :material-minus-circle-outline: Under `stop-gate = "project"` the Stop gate checks every suppression in the project against its start content, one more check per file that has one.

**Alternatives.** *`# noqa: INW001` or `# type: ignore`-style blanket comments:* other tools read those, and a bare form would hide everything on the line. *A next-line or file-level directive:* hides findings no one looked at. *Suppressions in `pyproject.toml` by path:* one more place to keep in sync with the code, and the config guard would have to judge each entry; per path is left to #160 and the config schema v2 ([#51](https://github.com/SirCypkowskyy/inwards/issues/51)). *Honour agent suppressions and only count them:* a count doesn't keep a violation out of the code. *Reject every suppression in a changed file:* the owner's existing ones would block any edit of that file.

## ADR-029: Generated modules pass INW010, protoc and version modules by default

**Status:** Accepted · 2026-09-26 · [#160](https://github.com/SirCypkowskyy/inwards/issues/160)

**Context.** INW010 decides on disk whether a module exists ([ADR-025](#adr-025-inw010-probes-the-disk-for-existence-and-checks-only-the-module-part-of-an-import)). Some modules only exist after a build step: `*_pb2.py` and `*_pb2_grpc.py` from protoc, `_version.py` from setuptools-scm or hatch-vcs. A developer's checkout has them and a fresh CI checkout doesn't, so the same commit passes locally and fails in CI. The ways out were a baseline, which is meant to shrink and is the wrong tool for a module that exists at run time; an inline suppression ([ADR-028](#adr-028-inline-suppressions-need-a-reason-and-an-agent-cant-add-one-by-default)) on every import of it; or INW010 turned off in `[tool.inwards.rules]`.

**Decision.**

- **A `generated` key** in `[tool.inwards]`: module patterns that INW010 treats as existing when the probe finds them missing.
- **Patterns are dotted names with `*` and `?` per segment.** No bracket sets: a set can hold any character, so `[!/]*` would pass a character check and still cover every segment. A pattern matches whole segments anywhere in the module name, as the top-level `ignore` does, and a wildcard never crosses a dot: `*_pb2` covers `shop.api.orders_pb2`, `_version` covers `shop._version`, `shop.api.gen` covers everything under `shop/api/gen/`. It is matched against the resolved module part of the import, so `from .orders_pb2 import Order` in `shop.api` is `shop.api.orders_pb2`.
- **Validated.** An empty segment, a character that can't be in a module name (`[` and `]` included), or a pattern made only of wildcards and dots (`*`, `*.*`) is a config error. The last would turn INW010 off, which is `[tool.inwards.rules]`'s job.
- **On by default.** Without the key the list is `["*_pb2", "*_pb2_grpc", "_version"]`. Tools write these names and people rarely do, so a missing one is almost always a build step that hasn't run. Setting the key replaces the default, as `deny-libraries` replaces its default ([ADR-023](#adr-023-libraries-per-layer-with-a-default-deny-list-for-the-innermost-layer)), and `generated = []` turns it off.
- **Matched without regular expressions.** The module name comes from an import an agent writes, and a regex translation (`.*` per star) backtracks: `*_*_*_*_pb2` against a 240-character segment took over 300 ms in the hook. An iterative two-pointer match that resumes only after the last star costs O(pattern × segment). The shape member patterns share the matcher, and it fixes their bracket sets, where the regex translation turned `?` and `*` into wildcards.
- **Only INW010 reads it.** The module index still sees the module as missing, so the other rules judge it as they judge any missing module: INW001 goes by name and reports an outward import whatever is on disk, INW005 counts it as first-party through its nearest package that exists, and INW006 names that package.
- **Guarded** like every key in `[tool.inwards]`: the config guard denies an agent's edit of it, and the Stop gate fails a change made through Bash. A test pins the guard.
- **No per-file ignore.** An inline suppression is already a per-line escape, and suppressions by path in the config are left to the config schema v2 ([#51](https://github.com/SirCypkowskyy/inwards/issues/51)), as ADR-028 decided.

**Consequences.**

- :material-plus-circle-outline: A project that imports protoc or version modules gets the same result in CI as locally, with no config. Tests pin both checkouts, for the default and for a configured pattern.
- :material-plus-circle-outline: Not a breaking change. INW010 has not been released yet (0.2.0 predates it), and the default only removes findings; no exit code, key or `diagnostics@1` field changes.
- :material-plus-circle-outline: No finding changes on the corpus (5 repositories, 6,543 files), and INW010's four findings in saleor remain.
- :material-minus-circle-outline: A hallucinated import whose name a pattern covers (`shop.api.payments_pb2` with no `payments.proto`) passes INW010, by default for `*_pb2`, `*_pb2_grpc` and `_version`. It still fails when the code runs. A team that wants those caught sets `generated = []` and runs the generator before the check.
- :material-minus-circle-outline: INW006 still sees the module as missing. For a generated module directly in the package above the layers (`shop._version` imported from a layer), both checkouts get an INW006 error, but it names "the package above the layers" without the file and the unassigned module with it, so a baseline entry taken in one checkout doesn't match in the other. A generated module inside an unassigned package (`shop.persistence.orders_pb2`) is worded the same in both.
- :material-minus-circle-outline: A generated top-level package with no committed `__init__.py` isn't first-party to any rule: INW010 never checks it, and INW005 treats it as a library.
- :material-minus-circle-outline: "Anywhere" is broad: a pattern `api` covers every module with an `api` segment. A longer pattern (`shop.api.gen`) is narrower.

**Alternatives.**

- *No default:* stricter, but every gRPC or setuptools-scm project would meet the CI failure first and find the key from there, for names that almost never come from an agent.
- *fnmatch over the whole dotted name, with `*` crossing dots:* the issue's example `*._version` would work as written, but `*` would mean something else than in `ignore` and the shape patterns, where it stays inside a segment, and `shop.*` would reach any depth.
- *Match the whole name only:* `*_pb2` would then need a form for "at any depth", such as the shape selectors' `**`, in every pattern.
- *Teach the module index that generated modules exist, for every rule:* INW006 would word its finding the same in both checkouts, but INW005, INW006 and the language server would believe in files that aren't there, and the index would need the config.
- *A per-file INW010 ignore in the config:* one more place to keep in sync with the code, and the per-line suppression already exists.
- *fnmatch bracket sets, as in the shape member patterns:* a set's contents escape the character check, and `*` and `?` cover every case the issue names.

## ADR-030: Bounded contexts as a `contexts` table of literal prefixes

**Status:** Accepted · 2026-09-27 · [#51](https://github.com/SirCypkowskyy/inwards/issues/51)

**Context.** Layers describe one onion: an ordered list in which every module may import the layers before it. Bounded contexts and vertical slices cut across that. `orders` and `billing` each have a domain and an application, and orders may use billing only through billing's API. [ADR-005](#adr-005-configuration-lives-in-pyprojecttoml) promised that such non-linear rules would get their own tables, so the simple case stays simple. INW002 (contexts depend on each other only as declared) and INW003 (outside callers use only a context's public modules) need a shared definition of what a context owns and allows.

**Decision.**

- **A `[[tool.inwards.contexts]]` table**, one entry per context, with `name`, `modules`, `public` and `depends-on`. [The configuration reference](guides/configuration.md#contexts) lists the keys.
- **Literal prefixes, longest match wins.** `modules` and `public` are full dotted module names, as layer entries are. The context whose prefix matches the most of a module owns it, so nested contexts work and the order of the tables never matters. The same prefix in two contexts is a config error. Glob selectors (`shop.*`) are left to [#191](https://github.com/SirCypkowskyy/inwards/issues/191), which brings them to layers first; until then a wildcard in a context is a config error, not a silent literal.
- **`public` is absolute and owned.** A public entry is a full module name, not relative to its context, and the context must own it under the longest-match rule. A module is public when it lies at or under a public prefix and its owner is this context, so a context nested inside a public package keeps its own internals private. Public status belongs to modules: an imported name is first resolved to its module.
- **`depends-on` is direct.** It names the contexts this one may import from. It isn't passed on through a chain and isn't granted in return. Forward references are fine; the context's own name, an unknown name and a repeat are config errors. Cycles between contexts are allowed by the parser; INW004 may forbid them.
- **Contexts and layers add up.** A declared dependency or a public module never allows an import that the layer order forbids, and belonging to a context says nothing about the layer, or the other way round. Context checks apply whether or not a layer owns the file.
- **Permissions, for INW002 and INW003.** INW002 requires a `depends-on` only between two different owned contexts, and says nothing when either end belongs to no context. INW003 requires a public target for every caller outside the target's context, including callers that belong to no context. A context uses only its own declarations, even when its prefixes sit inside another context's.
- **A JSON Schema** for the whole table, draft-07 for SchemaStore compatibility, published with the docs and attached to each release. It checks structure; the parser also checks relations between entries, which draft-07 can't express. Tests keep the two equal: keys, rule codes and defaults.

**Consequences.**

- :material-plus-circle-outline: One definition of ownership and permission for INW002 and INW003, decided before either rule is written, so they can't disagree.
- :material-plus-circle-outline: A config with no `contexts` behaves exactly as before, and `contexts = []` means the same.
- :material-plus-circle-outline: Editors can complete and check `[tool.inwards]` with the schema, and the docs' own examples are validated against it.
- :material-minus-circle-outline: A project with twenty slices lists twenty contexts until #191 brings globs.
- :material-minus-circle-outline: `public` can't express "only these names from the module"; re-exports and `__all__` are out of scope.
- :material-minus-circle-outline: Until INW002 and INW003 ship, a `contexts` table is parsed and checked but reports nothing.

**Alternatives.**

- *import-linter's contracts (independence, forbidden, layers as separate contract types):* expressive, but every contract names its modules again, and the relations between contracts aren't checked. One table with ownership rules keeps each module's context in one place. `inwards import-config` ([#55](https://github.com/SirCypkowskyy/inwards/issues/55)) will translate contracts.
- *Contexts inside `layers` (a layer per context):* mixes two independent dimensions and makes every context repeat the onion.
- *First match wins, as for shapes:* makes the order of the tables change the architecture. Longest match is what layers already do.
- *Relative `public` entries (`api` meaning the context's `api`):* shorter, but ambiguous with several prefixes per context and inconsistent with every other module name in the config.

## ADR-031: A content-keyed extraction cache that the hooks never read

**Status:** Accepted · 2026-09-27 · [#56](https://github.com/SirCypkowskyy/inwards/issues/56)

**Context.** A full check parses every file, even when none changed since the last run: about 0.9 s for the 2,100-file synthetic repo, most of it in WASM parsing. What a file yields depends almost entirely on its own text. But the cache would sit in the project, where the agent Inwards guards can write, and the hooks are the enforcement path. A planted entry that says a file imports nothing must never let a violation past PostToolUse or the Stop gate.

**Decision.**

- **Only per-file facts are cached**: the prescan's import skeleton (or its refusal), the full parse's static imports and the suppression comments. Dynamic imports (INW011) aren't, because whether an imported `eval` could be the builtin depends on other files. Neither is anything the engine decides from those facts: layers, rule settings, the baseline, whether a target exists (INW010).
- **The key is the whole identity**: the normalised text, the module name, whether the file is a package's `__init__`, and an extraction revision. The revision is bumped whenever the prescan, the parser, module naming, suppression parsing or the rule registry changes what a text yields; a test fingerprints those files and fails until it is. The namespace directory also names the cache format and a hash of the loaded grammars.
- **The engine takes an optional port.** `Engine.create(wasm, config, { cache })` accepts any `ExtractionCache`; without one it parses as before. The engine still does no I/O ([ADR-006](#adr-006-the-engine-does-no-io)).
- **`inwards check` and `inwards baseline` use `.inwards/cache`; nothing else reads it.** The hooks get no cache, and the language server keeps an in-memory one that never touches the disk: only each module's latest text, at most 5,000 entries and about 32 MB, the least recently used going first. `--no-cache` or `INWARDS_NO_CACHE=1` turns the disk cache off.
- **Reading trusts nothing.** An entry is read only if every directory on its path is a real directory, and it is opened without following a link or waiting on a FIFO, then read only if it is a regular file under 256 KB. Its JSON must have the expected shape and record the same identity; anything else is a miss.
- **Writing is safe to race.** Each entry is written to a uniquely named temporary file and renamed into place. Two runs can overwrite each other's entries; neither sees half of one. Every failure falls back to parsing.
- **Pruning is bounded.** A run prunes a shard (one of 256 directories) the first time it writes there, and again whenever its own writes take the shard past 512 KB: temporary files older than an hour, entries older than 30 days, then the oldest entries until the shard is under the limit. It checks the directories from the project down again first, and deletes only names the cache itself writes.

**Consequences.**

- :material-plus-circle-outline: A warm `inwards check` skips parsing unchanged files: 3.0 times faster on the synthetic repo (0.46 s against 1.25 s, p50). The benchmark reports no cache, an empty cache and a warm cache separately.
- :material-plus-circle-outline: The hooks' results can't be changed by anything in `.inwards/cache`, which a test checks with a planted entry.
- :material-minus-circle-outline: A cached `inwards check` trusts the cache. Anyone who can write the project can make it miss a violation. CI that restores the cache from an untrusted branch should run `--no-cache`, as the [GitHub Actions guide](guides/ci.md#caching-between-runs) says.
- :material-minus-circle-outline: Directories are checked by path, not held open: Node has no `openat` or `unlinkat`. The cache assumes that whoever can write the project also runs as the user, as a coding agent with a shell does; a process that can only write files, and races a run by swapping a directory for a link between a check and the write or prune after it, can send that one operation elsewhere. Every publication and every prune checks the whole chain first and stops using a shard that changed, and pruning deletes only names the cache writes.
- :material-minus-circle-outline: The revision has to be bumped by hand; the fingerprint test only notices that the files changed.
- :material-minus-circle-outline: An empty cache pays for a write per file: the run that fills it was 27% slower on the synthetic repo. The benchmark reports that cost and doesn't gate it, since it depends on the runner's filesystem more than on the code.

**Alternatives.**

- *Key by path and modification time:* cheaper to check, but a checkout or `touch` breaks it both ways, and it can't be shared between clones.
- *One cache file per project:* fewer files, but every run rewrites all of it and concurrent runs need a lock.
- *Cache for the hooks too, with an HMAC keyed outside the project:* the key would have to live where the agent can't read it, and the hooks check one file, where parsing isn't the cost ([chapter 6](06-Constraints-and-Quality.md#where-a-single-file-check-spends-its-time)).
- *Cache whole results:* they depend on the config, the baseline and other files; invalidating them correctly is the hard problem this design avoids.

## ADR-032: Import cycles on whole-project runs, from the imports the check already reads

**Status:** Accepted · 2026-09-27 · [#54](https://github.com/SirCypkowskyy/inwards/issues/54)

**Context.** A cycle between modules, or between bounded contexts, is an architecture smell no single import shows: every step can be allowed on its own. ADR-030 left cycles between contexts to INW004. Finding a cycle needs every module's imports, and the hooks check one file within a 100 ms budget. The issue asked for a cold run on the synthetic repo to stay under 1 s, cycle search included.

**Decision.**

- **Whole-project runs only.** INW004 runs when a check covers the whole project: `inwards check` without paths, `inwards baseline`, the Stop gate with `stop-gate = "project"`. The per-edit hook and the language server never report it.
- **From the imports the check already reads.** The engine keeps each checked file's imports as it scans and confirms them: the skeleton's, or the full parse's with readable dynamic imports. No file is read twice, and the extraction cache ([ADR-031](#adr-031-a-content-keyed-extraction-cache-that-the-hooks-never-read)) applies. Every import counts, function-level and `TYPE_CHECKING` ones included, as for the other rules.
- **Nodes are the checked modules.** An import is an edge to the longest checked module its target starts with. Anything else, the standard library or a package outside the check, can't close a cycle and makes no edge; resolving targets needs no filesystem.
- **One report per strongly connected group.** Tarjan's algorithm, iterative, finds the groups; each gets the shortest cycle through its first module, with the full path, on the import that makes the first step. Nodes and edges are visited in sorted order, so the report is the same on every run. The message also gives the group's size in members and links and a hash of its links, so a baseline stops matching when the group changes in any way. That includes a group that lost a link: the project runs `inwards baseline` again to accept it.
- **Every file in a cyclic group is confirmed.** The skeleton can read an import that isn't one: a line inside a multi-line string or an f-string, or a line the parser, recovering from a syntax error, doesn't read as an import. One such edge can join two groups into one. So every file with an edge inside a cyclic group that only the skeleton read is confirmed, and the search runs again until every group stands on confirmed imports. Confirming stays cheap. A file with nothing but top-level imports, comments and blank lines up to its last import needs no parse: its skeleton is that same text, which parsed into imports alone. Any other file is parsed up to the end of its last import. When that text parses without an error, the cut is outside every string, bracket and continuation, so it holds the same imports as the whole file (the skeleton never misses one, so none come later); otherwise the whole file is parsed.
- **`cycles` picks the kinds**, `["contexts"]` by default: cycles between contexts are the architecture question contexts exist for, and module cycles would fail many existing projects on upgrade. `"modules"` adds them; `[]` turns the rule off.
- **Not suppressible inline.** A one-file check can't tell whether a suppressed cycle still exists, and the comment would sit on one import of many. The baseline accepts the cycles a project already has.

**Consequences.**

- :material-plus-circle-outline: On the synthetic repo (2,100 files), where the generator's random imports put most modules of each layer in one cyclic group, the search with its confirmation made a cold whole-project check 1.51 s against 1.35 s without it (medians of 8 alternating runs with `INWARDS_NO_CACHE=1`, load average about 1.1). A full parse of every file in a group took about 7 s instead. The search found four cycles. The cold check is over the 1 s budget on this machine with or without it.
- :material-plus-circle-outline: A cycle between contexts is caught even when `depends-on` allows both directions.
- :material-minus-circle-outline: The editor and the per-edit hook don't show cycles; the Stop gate does only in project mode.
- :material-minus-circle-outline: Importing a submodule also runs its package's `__init__`; that implicit step is no edge, so a cycle that only closes through an `__init__` is missed.
- :material-minus-circle-outline: Without contexts, files outside every layer aren't parsed, so cycles through them aren't seen.
- :material-minus-circle-outline: A file with a syntax error after its last import counts with the imports written above the error; Python wouldn't import it at all.

**Alternatives.**

- *A separate graph pass that reads every file:* simpler to write, but it doubles the reading and parsing the check already does.
- *Resolve edges with `ownerOf`:* follows Python exactly, but probes the filesystem for every import, 55 ms of the first measurement, and a module outside the check can't be on a reported cycle anyway.
- *A token scanner that decides when the skeleton can be trusted:* the first version of this rule had one. Review found valid code it misread (an f-string nested in an f-string, allowed since Python 3.12) and syntax errors it couldn't follow; Python's tokenizer and the parser's error recovery are more than a scanner can mirror.
- *A full parse of every file in a cyclic group:* sound, but about 7 s cold on the synthetic repo.
- *Report every elementary cycle:* the count explodes with the size of a group; one shortest cycle per group is enough to act on, and the next run shows the next.
- *Module cycles on by default:* the stricter setting, but an upgrade that fails most codebases teaches people to turn the rule off.

## ADR-033: OpenCode through a plugin that runs the Claude Code hook

**Status:** Accepted · 2026-09-27 · [#170](https://github.com/SirCypkowskyy/inwards/issues/170)

**Context.** The agent evals ([#48](https://github.com/SirCypkowskyy/inwards/issues/48)) run on OpenCode, and Inwards can only measure an agent it's wired into. OpenCode has no hook settings like Claude Code's. It loads JavaScript plugins from `.opencode/plugins/`, and a plugin gets events and tool calls: `tool.execute.before` can throw to block a call, `tool.execute.after` can change the tool's output, and the `session.idle` event fires after a turn has ended. The rules, the session record, the config guard and the Stop gate already exist as `inwards hook claude-code`. The design and its guarantees are based on OpenCode 1.18.31.

**Decision.**

- **A plugin that translates, one hook implementation.** `inwards init --agent opencode` writes `.opencode/plugins/inwards.js`, plain JavaScript with no build step and no dependencies. The plugin turns OpenCode's events into the payloads Claude Code sends and runs `inwards hook claude-code` with them: `session.created` becomes SessionStart, `tool.execute.before` for `edit`, `write` and `bash` becomes PreToolUse (with `filePath`, `oldString` and the rest renamed), `tool.execute.after` for `edit`, `write` and `apply_patch` becomes PostToolUse, and `session.idle` becomes Stop. There is no `inwards hook opencode` for now; the recorded payloads stay the one contract.
- **Like Claude Code's settings file, the plugin holds this machine's path to the binary.** It starts Inwards with no shell, by the absolute path `init` found, and `init` adds it to `.gitignore`. A first line marks the file as written by `init`, which refuses to replace a file without it, a directory or a link. The hook runs in the project the file sits in, not in the directory OpenCode was started from, since OpenCode also loads the plugins of parent directories.
- **A block is a thrown error; everything else the hook says joins the tool result or the session.** A PreToolUse deny becomes an `Error` with the guard's reason, which OpenCode shows to the model instead of running the tool. A PostToolUse finding, warning or escalation request is appended to the tool's output, which the model reads before its next step. What Claude Code shows the user or adds at session start (the Stop gate's final summary, the problems earlier sessions left) goes into the session as a message from the plugin that starts no turn (`noReply`).
- **The Stop gate starts another turn.** When the gate blocks on `session.idle`, the plugin sends its reasons into the session with `client.session.promptAsync`, prefaced "Inwards Stop gate (sent by the Inwards plugin, not the user)", as the agent, model and variant the user last picked. Without the preface, a model took the report for the user repeating a request. The plugin keeps `stop_hook_active` per session and clears it when the user sends a message, so `escalate-after` works as on Claude Code. OpenCode doesn't wait for one event before the next, so the gate runs one at a time per session, and a result is dropped when the user sent a message after the idle it answers, when a turn is running, or when the gate's last message hasn't arrived yet. The gate runs only for an idle that ends a turn a message started (the user's or its own, seen through `chat.message`): a shell command, a manual compaction or an abort (`MessageAbortedError`) sends nobody back. A refused message is tried three times; one that still fails, or whose request broke off, goes out at the next idle unless it arrived or the user wrote first. A shell command that starts and ends while the gate runs drops the result, and the idle after it checks again.
- **What the guard can't read, the plugin refuses.** The config guard judges an edit by its old and new text, and `apply_patch` has neither. So the plugin refuses a patch that touches `pyproject.toml`, `.opencode/`, `opencode.json(c)`, `.inwards/` or `inwards-baseline.json`, and an `edit` or `write` of the last four, which on Claude Code `permissions.deny` covers. Patch headers are read as leniently as OpenCode reads them, and paths are compared as written and with links resolved. When the hook can't run, a call that touches those files or `pyproject.toml` is refused instead of let through unchecked, and a hook run is stopped after 60 seconds, Claude Code's default hook timeout. Two OpenCode arguments the guard never sees are checked in the plugin: `bash` may not run in one of Inwards' directories (its `workdir`, or OpenCode's own directory without one), and an `edit` of `pyproject.toml` whose `oldString` doesn't match exactly once (at least once with `replaceAll`) is refused, because OpenCode then falls back to looser matches the guard's simulation can't follow.
- **Subagents share their top-level session**, as on Claude Code: a child session's calls use its root's session id, and the Stop gate runs for top-level sessions only. A session the plugin didn't see created (a subagent resumed after a restart) is looked up through the SDK, up to three times; while the lookup fails, its calls are checked under its own session id, and the Stop gate doesn't run for it.
- **The Stop gate checks the plugin file**, not Claude Code's settings, when `INWARDS_HOOK_HOST=opencode` says who is calling. The plugin hashes its own file when OpenCode loads it and passes the hash along; the gate blocks when the file on disk is gone or differs, so a plugin emptied during a session, marker kept, is reported before the next start runs nothing.

**Consequences.**

- :material-plus-circle-outline: The rules, the guard, the Stop gate and escalation have one implementation, and a change to them reaches OpenCode with no plugin change.
- :material-plus-circle-outline: An end-to-end test runs `opencode run` with a real model when one is configured: the agent writes an outward import, reads INW001 in the tool result and fixes it.
- :material-minus-circle-outline: OpenCode can't refuse the end of a turn. The gate's reasons arrive as a new message after the turn ended, and `opencode run` exits at that point, so a non-interactive run gets no second turn; the per-edit check still reaches the agent. [The guide](guides/opencode.md#what-holds-on-opencode) lists every difference.
- :material-minus-circle-outline: The plugin can't block a message the user sends, and a new message resets the `escalate-after` count, as a new turn does on Claude Code.
- :material-minus-circle-outline: A Bash command can still delete or rewrite the plugin. The Stop gate of the running session notices, but the next OpenCode start loads nothing to notice with, as when Claude Code's settings file is deleted.
- :material-minus-circle-outline: Running `init` again during a session with a different Inwards (an upgrade, a moved binary) writes different bytes, so the gate asks for a restart of OpenCode before the turn can end; a rerun that changes nothing doesn't.

**Alternatives.**

- *An `inwards hook opencode` entry point that reads OpenCode's shapes:* the translation would move into the tested CLI, but it would add a second payload contract for a plugin API that is still changing. The translation is small; it can move later.
- *A plugin that reimplements the checks in JavaScript:* no process per event, but two implementations of every rule and of the guard.
- *Blocking the end of a turn through `chat.message` or permissions:* neither runs when a turn ends; `session.idle` is the only point, and it comes after the turn.
