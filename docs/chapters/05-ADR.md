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
| [023](#adr-023-libraries-per-layer-with-a-default-deny-list-for-the-innermost-layer) | Libraries per layer, with a default deny list for the innermost layer | :white_check_mark: Accepted |
| [024](#adr-024-a-polish-translation-as-a-second-build-translated-in-the-same-pr) | A Polish translation as a second build, translated in the same PR | :white_check_mark: Accepted |
| [025](#adr-025-inw010-probes-the-disk-for-existence-and-checks-only-the-module-part-of-an-import) | INW010 probes the disk for existence and checks only the module part of an import | :white_check_mark: Accepted |
| [026](#adr-026-report-unreadable-dynamic-import-targets-in-inner-layers) | Report unreadable dynamic-import targets in inner layers | :white_check_mark: Accepted |
| [027](#adr-027-per-rule-select-ignore-and-severity-in-a-toolinwardsrules-table) | Per-rule `select`, `ignore` and `severity` in a `[tool.inwards.rules]` table | :white_check_mark: Accepted |

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
- Bindings not listed above are not followed, so a loader reached through them is missed: walrus, tuple assignment, class and instance attributes, `functools.partial`, names bound inside `exec`, and builtins reached through objects (`print.__self__`). Other loading APIs (`pkgutil.resolve_name`, `importlib.util.find_spec` with `exec_module`, `SourceFileLoader`) are not read either. [#79](https://github.com/SirCypkowskyy/inwards/issues/79) tracks all of them.
- A target is a constant string: literals, implicit concatenation, `+` between constants, and f-strings whose fields are constant strings.
- Bytes passed to `exec` or `compile` are decoded as CPython does. A PEP 263 declaration counts, and a codec Inwards can't read (the INW000 rules, [ADR-014](#adr-014-report-files-whose-declared-encoding-can-hide-imports)) gets an INW011 diagnostic saying the source can't be checked, in any layer. A `str` source ignores the declaration, as in CPython.
- Relative targets resolve as at runtime: `import_module(".x", package=...)` with a literal package, `__package__` or `__name__`, and `__import__` with a literal `level` against the file's package.
- Before the prescan, a text check looks for the names every loading call must spell: `importlib`, `runpy`, `builtins`, `__import__`, or `exec`, `eval` or `compile` not preceded by a dot, on NFKC-normalised text. A file in a layer that matches skips the skeleton and gets the full parse. `prescan-diff` checks the hint on both corpora: a dynamic import in a file the hint rejects is a miss.

**Consequences.**

- :material-plus-circle-outline: The common dynamic dodges are reported with a fix aimed at them. Tests cover each call form and alias.
- :material-minus-circle-outline: INW011 is not complete. The unfollowed bindings and loading APIs above, and computed targets, are false negatives until [#79](https://github.com/SirCypkowskyy/inwards/issues/79) and [#46](https://github.com/SirCypkowskyy/inwards/issues/46) land.
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
- A bare `exec` or `eval` with a computed source is skipped only when the code surely rebinds that name at the call. The binding must be a `def`, `class`, plain assignment or import placed directly in the module body, before the top-level statement that holds the call, or directly in the body of a function that encloses the call; or a parameter of a function or lambda whose body holds the call; or a `for` target inside its loop. Bindings under `if`, `try`, `with` or `while` don't count. The exemption is off for the whole file when any binding of the name could be the builtin: an assignment, walrus, `for`, `with` or `except` target, or parameter default whose value mentions a loader or a module that holds one (`exec = exec`, `eval = builtins.eval`, `def run(code, exec=exec)`), or an import from `builtins`, `importlib`, `runpy` or a relative module (first-party code may re-export the builtin). A `global`, `nonlocal` or `del` of the name turns it off too. PyTorch training code often defines `eval(model, loader)`, and reporting it as a dynamic import would be noise with a nonsense fix. A literal source is still read whatever the name is bound to, as ADR-015 decided.
- Calls that fail at runtime stay unreported: a relative `import_module` with no `package`, `package=None` or `package=""`, a relative `run_module`, an empty name.
- A name bound to several loaders reports each load once.
- Severity error, like the rest of INW011. Warnings pass the CLI exit code, the hook and the Stop gate, and they are not baselined, so a warning would let the dodge through.

**Consequences.**

- :material-plus-circle-outline: The variable-name dodge is reported, through every alias ADR-015 follows. Tests cover each loader, the aliases, f-strings, variables, `\N{...}` literals, arguments behind `*args` and `**kwargs`, a relative `import_module` with an unknown package, and every rebinding of `exec`, `eval` or `compile` that doesn't shadow the builtin at the call. The loader hint needs no change, and `prescan-diff` still misses nothing.
- :material-minus-circle-outline: Legitimate runtime loaders in inner layers are reported. On the real-repo corpus (5 repositories, 6,543 files) the change adds 4 findings, each an `import_module(path)` that loads a configured class or plugin: one in python-ddd's `seedwork.application`, three in saleor (`saleor.core.telemetry`, `saleor.plugins`, `saleor.schedulers`). Their teams would move each loader outward or baseline it.
- :material-minus-circle-outline: Constant targets that aren't literals (a module-level `TARGET = "..."`, `str.format`, `%`, f-string conversions such as `{'shop'!s}`) are now reported as unverifiable instead of passing. Folding them, and so reporting them exactly, is [#79](https://github.com/SirCypkowskyy/inwards/issues/79).
- :material-minus-circle-outline: The rebinding exemption misses the builtin passed in as an argument: `def run(exec, c): return exec(c)` called as `run(exec, code)` is not reported, since the parameter shadows the builtin inside `run`. Being conservative, it also reports some calls that are not the builtin: a comprehension variable (`[eval(m) for eval in evaluators]`), a method name used inside its own class body, a `match` capture, and any binding under `if` or `try` or made through `global`, even when that binding does run before the call.
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
