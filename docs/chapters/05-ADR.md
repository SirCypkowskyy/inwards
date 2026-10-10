# :material-scale-balance: Architecture decisions (ADR)

Each record states the decision, the context it was made in, what it costs us, and what we turned down. Records are never edited after acceptance. A changed mind gets a new ADR that supersedes the old one.

| ADR | Decision | Status |
|---|---|---|
| [001](#adr-001-typescript-for-the-engine) | TypeScript for the engine | :material-check-circle: Accepted |
| [002](#adr-002-web-tree-sitter-wasm-not-native-bindings) | web-tree-sitter (WASM), not native bindings | :material-check-circle: Accepted |
| [003](#adr-003-ship-a-bun-single-file-executable) | Ship a Bun single-file executable | :material-check-circle: Accepted, built with `--bytecode` since [#39](06-Constraints-and-Quality.md#spike-bytecode-and-minification) |
| [004](#adr-004-parse-the-import-skeleton-confirm-with-a-full-parse) | Parse the import skeleton, confirm with a full parse | :material-check-circle: Accepted, baselined modules skip the confirming parse since [#108](03-Architecture-C4.md#c3-components-of-the-engine) |
| [005](#adr-005-configuration-lives-in-pyprojecttoml) | Configuration lives in `pyproject.toml` | :material-check-circle: Accepted |
| [006](#adr-006-the-engine-does-no-io) | The engine does no I/O | :material-check-circle: Accepted, the adapter supplies the module index through a ProjectFiles port since [#44](03-Architecture-C4.md#c3-components-of-the-engine) |
| [007](#adr-007-a-versioned-output-contract-with-fix-steps-as-data) | A versioned output contract with fix steps as data | :material-check-circle: Accepted |
| [008](#adr-008-language-server-on-node-inside-the-extension-for-now) | Language server on Node inside the extension, for now | :material-swap-horizontal: Superseded by [041](#adr-041-inwards-server-runs-inwards-checks-own-code-the-extensions-node-server-stays-until-it-switches); the name `inwards server` and its place beside the hook daemon in [039](#adr-039-a-hook-daemon-per-project-separate-from-the-language-server) |
| [009](#adr-009-check-imports-wherever-they-appear) | Check imports wherever they appear | :material-check-circle: Accepted |
| [010](#adr-010-docs-built-with-zensical-served-by-cloudflare-workers) | Docs built with Zensical, served by Cloudflare Workers | :material-swap-horizontal: Hosting superseded by 012 |
| [011](#adr-011-rename-stratum-to-inwards) | Rename Stratum to Inwards | :material-check-circle: Accepted |
| [012](#adr-012-publish-the-docs-on-github-pages-for-now) | Publish the docs on GitHub Pages, for now | :material-check-circle: Accepted, deployed from `develop` since 019 |
| [013](#adr-013-real-paths-for-the-boundary-import-paths-for-module-names) | Real paths for the boundary, import paths for module names | :material-check-circle: Accepted, symlinks in layers that hide code reported since [#83](https://github.com/SirCypkowskyy/inwards/issues/83) and [#84](https://github.com/SirCypkowskyy/inwards/issues/84) |
| [014](#adr-014-report-files-whose-declared-encoding-can-hide-imports) | Report files whose declared encoding can hide imports | :material-check-circle: Accepted |
| [015](#adr-015-check-literal-dynamic-imports-as-inw011) | Check literal dynamic imports as INW011 | :material-check-circle: Accepted, unreadable targets reported since 026 |
| [016](#adr-016-versions-and-releases-come-from-commit-types-via-a-release-pr) | Versions and releases come from commit types, via a release PR | :material-swap-horizontal: Branching model superseded by 019 |
| [017](#adr-017-squash-merges-with-conventional-commit-pr-titles) | Squash merges with Conventional Commit PR titles | :material-check-circle: Accepted, squashed into `develop` since 019 |
| [018](#adr-018-package-selectors-take-globs-from-the-start-monorepos-follow-uv-workspaces) | Package selectors take globs from the start; monorepos follow uv workspaces | :material-check-circle: Accepted |
| [019](#adr-019-a-develop-integration-branch-main-moves-only-at-releases) | A `develop` integration branch; `main` moves only at releases | :material-check-circle: Accepted |
| [020](#adr-020-the-init-picker-uses-clackprompts-loaded-from-a-split-chunk) | The `init` picker uses @clack/prompts, loaded from a split chunk | :material-check-circle: Accepted |
| [021](#adr-021-publish-the-release-wheels-to-pypi-from-their-own-workflow-with-trusted-publishing) | Publish the release wheels to PyPI from their own workflow, with trusted publishing | :material-check-circle: Accepted, switched on by the owner |
| [022](#adr-022-m2-go-or-no-go-continue-conditionally-until-partner-data) | M2 go or no-go: continue, conditionally, until partner data | :material-progress-clock: Accepted, provisional until partner data |
| [023](#adr-023-libraries-per-layer-with-a-default-deny-list-for-the-innermost-layer) | Libraries per layer, with a default deny list for the innermost layer | :material-check-circle: Accepted, `extend-deny-libraries` adds to the default since [#155](guides/libraries.md#configure-it) |
| [024](#adr-024-a-polish-translation-as-a-second-build-translated-in-the-same-pr) | A Polish translation as a second build, translated in the same PR | :material-check-circle: Accepted |
| [025](#adr-025-inw010-probes-the-disk-for-existence-and-checks-only-the-module-part-of-an-import) | INW010 probes the disk for existence and checks only the module part of an import | :material-check-circle: Accepted, generated modules pass when missing since [029](#adr-029-generated-modules-pass-inw010-protoc-and-version-modules-by-default) |
| [026](#adr-026-report-unreadable-dynamic-import-targets-in-inner-layers) | Report unreadable dynamic-import targets in inner layers | :material-check-circle: Accepted |
| [027](#adr-027-per-rule-select-ignore-and-severity-in-a-toolinwardsrules-table) | Per-rule `select`, `ignore` and `severity` in a `[tool.inwards.rules]` table | :material-check-circle: Accepted, the language server re-reads the table without a restart since [#163](03-Architecture-C4.md#known-limitations) |
| [028](#adr-028-inline-suppressions-need-a-reason-and-an-agent-cant-add-one-by-default) | Inline suppressions need a reason, and an agent can't add one by default | :material-check-circle: Accepted |
| [029](#adr-029-generated-modules-pass-inw010-protoc-and-version-modules-by-default) | Generated modules pass INW010, protoc and version modules by default | :material-check-circle: Accepted |
| [030](#adr-030-bounded-contexts-as-a-contexts-table-of-literal-prefixes) | Bounded contexts as a `contexts` table of literal prefixes | :material-check-circle: Accepted |
| [031](#adr-031-a-content-keyed-extraction-cache-that-the-hooks-never-read) | A content-keyed extraction cache that the hooks never read | :material-check-circle: Accepted |
| [032](#adr-032-import-cycles-on-whole-project-runs-from-the-imports-the-check-already-reads) | Import cycles on whole-project runs, from the imports the check already reads | :material-check-circle: Accepted |
| [033](#adr-033-opencode-through-a-plugin-that-runs-the-claude-code-hook) | OpenCode through a plugin that runs the Claude Code hook | :material-check-circle: Accepted |
| [034](#adr-034-layer-selectors-anchored-in-a-top-level-package-with-slice-aware-session-checks) | Layer selectors anchored in a top-level package, with slice-aware session checks | :material-check-circle: Accepted |
| [035](#adr-035-inwards-check-follows-uv-workspace-members-each-with-its-own-config) | `inwards check` follows uv workspace members, each with its own config | :material-check-circle: Accepted |
| [036](#adr-036-package-templates-expand-into-config-a-user-could-write-by-hand) | Package templates expand into config a user could write by hand | :material-check-circle: Accepted |
| [037](#adr-037-framework-rule-families-opt-in-with-their-own-prefix) | Framework rule families, opt-in, with their own prefix | :material-check-circle: Accepted |
| [038](#adr-038-a-witness-of-the-session-start-outside-the-project-against-a-replayed-sessionstart) | A witness of the session start outside the project, against a replayed SessionStart | :material-check-circle: Accepted |
| [039](#adr-039-a-hook-daemon-per-project-separate-from-the-language-server) | A hook daemon per project, separate from the language server | :material-check-circle: Accepted |
| [040](#adr-040-worker-threads-parse-a-large-full-check-the-main-thread-keeps-every-decision) | Worker threads parse a large full check; the main thread keeps every decision | :material-check-circle: Accepted |
| [041](#adr-041-inwards-server-runs-inwards-checks-own-code-the-extensions-node-server-stays-until-it-switches) | `inwards server` runs `inwards check`'s own code; the extension's Node server stays until it switches | :material-check-circle: Accepted, the extension switched in [043](#adr-043-the-vs-code-extension-bundles-the-binary-one-vsix-per-platform) |
| [042](#adr-042-inwards-mcp-answers-with-inwards-checks-own-check-on-texts-laid-over-the-disk) | `inwards mcp` answers with `inwards check`'s own check, on texts laid over the disk | :material-check-circle: Accepted |
| [043](#adr-043-the-vs-code-extension-bundles-the-binary-one-vsix-per-platform) | The VS Code extension bundles the binary, one VSIX per platform | :material-check-circle: Accepted |
| [044](#adr-044-copilot-through-an-inwards-hook-copilot-entry-point-and-a-committed-hooks-file) | Copilot through an `inwards hook copilot` entry point and a committed hooks file | :material-help-circle-outline: Proposed, waits for the owner |

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

**Status:** Superseded by [ADR-041](#adr-041-inwards-server-runs-inwards-checks-own-code-the-extensions-node-server-stays-until-it-switches) · 2026-09-25 · [ADR-039](#adr-039-a-hook-daemon-per-project-separate-from-the-language-server) keeps `inwards server` for the language server and gives the hooks a separate `inwards daemon`

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

**Amendment · 2026-09-28 · [#83](https://github.com/SirCypkowskyy/inwards/issues/83), [#84](https://github.com/SirCypkowskyy/inwards/issues/84).** Two links hid code from the rules. `ln -s /outside/dir shop/domain/ext` gives an importable `shop.domain.ext.leak` that the walker never reads, as decided above. `ln -s ../infrastructure shop/domain/infra_alias` gives `shop.domain.infra_alias.db`, infrastructure code that INW001 takes for domain code by its name, so `from shop.domain.infra_alias import db` passes.

- **A symlink inside a layer is an INW006 error at the link** when its real target lies outside the config root, in another layer, or above the layers (the package that holds them, or the root). A link within its layer passes, and so does a link into code outside every layer: that code is checked under the link's name. A link above the layers that could hold layer code (`shop/payments` under `shop.*.domain`) is an error when it leaves the root, unless its name isn't a Python identifier (`static-assets`). A target that contains the real directory of a layer package that is itself a link (`packages` with `shop -> packages/shop`) holds layers too. Links to a directory or to a `.py` or `.pyi` file count; dangling links don't.
- **The walk lists links by the path Python imports them through.** It covers every layer's top-level package (`layerPackages`, [ADR-034](#adr-034-layer-selectors-anchored-in-a-top-level-package-with-slice-aware-session-checks)) and the package itself when it is a link, so a root of links to uv workspace members names each link. It follows links that stay in the root (cycle guarded) and never those that leave it, so a chain through code outside every layer (`shop/domain/a -> ../misc` plus `shop/misc/y -> ../infrastructure`) shows up as `shop/domain/a/y`. A target under a layer package that is itself a link in the root (`shop -> packages/shop`) is named by the package (`shop.infrastructure`), not its real path. The engine gets root-relative names and decides.
- **The session start records the links**, link path to real target. At Stop, a finding that is new since the start (a new link, or one pointing elsewhere) blocks, and `[tool.inwards.rules]` doesn't apply, as for a layer moved away ([ADR-027](#adr-027-per-rule-select-ignore-and-severity-in-a-toolinwardsrules-table)). A link that was there at the start doesn't block, like an old violation in an untouched file. A start record without links, from an older version, makes every such link new.

*Consequences:* the code behind a link out of the root is still never read; the finding says it is there. A directory of data files linked into a layer package from outside the root is reported too. The language server and `inwards check` with path arguments don't report links, as they don't report dead prefixes.

*Alternatives:* *resolve each import to the file Python loads and take the layer from every name that file has*: exact for #84, but every import would need a real-path probe through a new engine port, and it does nothing for #83. *Check the target read-only*: would read files outside the project, which the decision above rules out. *Report every link in a layer*: flags aliases within a layer, which ADR-013 supports on purpose.

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

**Amendment, 2026-09-28: libraries denied to a module prefix ([#219](https://github.com/SirCypkowskyy/inwards/issues/219)).** import-linter's most common `forbidden` contract, "`mypackage.one` must not import `django`", names a package that isn't a layer, so `inwards import-config` ([#55](https://github.com/SirCypkowskyy/inwards/issues/55)) had to skip it.

- **In INW005's options table.** `[tool.inwards.rules.pure-domain]` takes `deny`, a list of `{ modules, libraries }` tables, next to the `modules` every rule has since [ADR-027](#adr-027-per-rule-select-ignore-and-severity-in-a-toolinwardsrules-table)'s #181 amendment. `modules` has the grammar of `layers[].modules`, and `libraries` the grammar of `deny-libraries`. Only `pure-domain` takes the key; on another rule's table it is an unknown key.
- **Independent of layers.** An entry applies to the modules it matches whether a layer owns them or not, so a file outside every layer that an entry covers gets its imports read. The layer's `allow-libraries` doesn't undo it: an entry is narrower than a layer, and a team writes one to take something away.
- **The layer's lists are asked first.** When they deny the import too, the finding is the layer's, with the layer's message, so adding an entry leaves existing baseline keys alone. Otherwise the message names the module and the prefix the entry matched (`denies to "mypackage.one"`), and the fix puts the port in that prefix and the implementation outside it. The table's own `modules` still scopes every INW005 finding.
- **`import-config`** keeps `extend-deny-libraries` for sources that are exactly one or more layers and writes a `deny` entry for everything else.

*Alternatives.* *`deny-libraries` on a `[[tool.inwards.contexts]]` entry*: a context also brings INW002 and INW003 permissions, so a converted contract would change what else the package may import and who may import it. *A `modules` field on a layer's deny entries*: `deny-libraries` is a list of strings, and turning its entries into tables would change the type of an existing key.

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

**Amendment, 2026-09-28: opt-in rules and options tables ([#181](https://github.com/SirCypkowskyy/inwards/issues/181)).** The next rules (the thin-endpoint rule, the FastAPI family) judge handler content against thresholds a team picks, so they must start off and take options. `select` can't turn one rule on without turning the rest off, and #98's `[[tool.inwards.rules]]` can't live next to the `rules` table in TOML.

- **Default on or off.** Each registry entry has `default: "on"` or `"off"`. Every rule so far is `"on"`, so no existing config changes. A rule that is off reports only when `select` or the new `extend-select` lists it.
- **`extend-select`** (Ruff's name) turns rules on next to `select`, or next to the defaults when `select` is absent. `ignore` still wins over both. Its codes are validated like the others, and it can't list INW000.
- **Options tables.** A rule's options go in `[tool.inwards.rules.<rule-name>]`, keyed by the kebab-case name, so they can't clash with the four list and table keys. Every rule takes `modules`, a list of entries in the grammar of `layers[].modules` ([ADR-034](#adr-034-layer-selectors-anchored-in-a-top-level-package-with-slice-aware-session-checks)): a prefix such as `shop.domain` covers that package and everything below it, and a selector such as `shop.*.api` uses wildcards. The rule reports only in the modules they match, and a finding in `pyproject.toml` itself isn't scoped. A rule with options of its own adds its keys; an unknown key or a wrong type is a config error that names the key. INW000 can't have a table, for the reason above. Tables come out sorted by name, so reordering them changes nothing.
- **A table turns nothing on.** A table for a rule that is off is a warning located at the table in `pyproject.toml`, under that rule's code, not an error, so a team can stage options before turning a rule on. The warning isn't filtered by the table, since the rule it names is off.
- **SARIF** lists an opt-in rule in `rules[]` with `defaultConfiguration.enabled = false`, so the output stays one list. Rules that are on keep their entry as before.
- **Baseline.** An entry for a rule that is off in its module (opt-in and not selected, or scoped away by `modules`) is dormant, like an ignored rule's.
- **Guarded.** The new keys are inside `[tool.inwards]`, so the config guard denies an agent edit of them and the Stop gate fails a change made through Bash. Tests pin both.

The issue asked for the shape selectors of #95, but there `shop.domain` matches one package and nothing below it, which is the wrong default for scoping a rule; the layer grammar says the same thing a layer does. `inwards check` has no rule listing, so "opt-in" shows in the Default column of the docs rule index only.

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
- :material-minus-circle-outline: Under `"deny"`, a suppression in a file that was uncommitted or untracked at session start, or in any file of a project outside git, counts as new once the agent edits that file, because the hooks can't prove its start content ([#134](https://github.com/SirCypkowskyy/inwards/issues/134)). Since [#157](https://github.com/SirCypkowskyy/inwards/issues/157) this holds only for such a file too large for the hooks to keep a copy of at session start (over 512 KiB, or past 4 MiB of such files). A file the agent leaves alone keeps its suppressions. The owner commits a suppression before handing such a file to an agent.
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

## ADR-034: Layer selectors anchored in a top-level package, with slice-aware session checks

**Status:** Accepted · 2026-09-28 · [#191](https://github.com/SirCypkowskyy/inwards/issues/191)

**Context.** Vertical slices repeat the same layers in every slice: `shop.orders.domain`, `shop.billing.domain`, and so on. Listing every slice's package in every layer works, but it is long, and a new slice that nobody adds to the config is simply unchecked. Shapes already take selectors in the grammar of [ADR-018](#adr-018-package-selectors-take-globs-from-the-start-monorepos-follow-uv-workspaces). Layers are harder: ownership decides every rule, INW006 reasons about the packages above the layers, the Stop gate compares sessions by prefix, and three directory walks (the CLI's, the session manifest's and the language server's) decide which code exists at all.

**Decision.**

- **Recognition and compatibility.** An entry with a `*` anywhere is a selector and is validated strictly: its segments are `*` (one segment), `**` (one or more) or identifiers. Partial wildcards, `?`, brackets, empty segments and path separators are config errors. Every entry without a `*` is a literal prefix with the lenient validation it always had, including legacy malformed names, and an empty `modules` list stays valid.
- **A selector starts with a literal top-level package** (`shop.*.domain`, not `*.domain`). That package anchors the directory walks, which open it in full as they already open a literal prefix's top-level package, and INW006's search for evidence. A selector without a literal first segment is a config error; a project with several top-level packages lists one selector per package.
- **Matching.** A selector owns every module equal to one of its complete matches, and their descendants. Matching is dynamic programming over segments, O(selector × module) per call, not the recursive matcher of shapes, since it runs for every import. Shapes keep their own matching and first-match precedence.
- **Precedence, in order:** the deepest last literal segment of the match, then the deeper match, then more literal segments, then the earlier layer. The first criterion lets a literal subtree (`shop.orders.domain`) win over a broad `shop.**` that matches deeper. For literal entries alone the order reduces to the longest prefix, so existing configs keep their owners. [The configuration reference](guides/configuration.md#selectors) has the truth table.
- **Fix steps name the importing module's own matched prefix**, never the raw selector or another slice, and suggest `<prefix>.ports` only when that prefix is a package. With several literal prefixes in a layer the wording changes on purpose: the fix used to name the layer's first prefix.
- **INW006 needs evidence for selectors.** A package holds a selector's layer only when the project has a module below it that the selector matches. The module index answers this by listing only the directories the selector allows, never the whole tree, and caches the answer. Literal entries keep the textual rule. Imports into a genuine container package stay errors.
- **Sessions check slices.** A selector is dead when it matches no module, whatever the precedence. In a session, it is also checked per slice, a slice being a matched module's prefix up to the selector's last literal segment: `shop.orders.domain` for `shop.*.domain`, `shop.orders.infra` for `shop.*.infra.*`, `shop` for `shop.**`. A slice that held modules at session start and holds none now is an error, like a literal prefix that stopped matching. Moves of layer code out of every layer are caught module by module, as before. Config findings point at the selector's text.
- **Renaming or deleting a slice needs the user**, as it does with literal prefixes: `git mv shop/orders shop/sales`, moving a slice deeper under `shop.**.domain`, and deleting a slice whose only module is its `__init__.py` all block the Stop gate.
- **One helper names the packages to walk.** `layerPackages` gives each entry's top-level package; the CLI walk, the session manifest and the language server's listing and file-event filter all open those directories, so the editor indexes the same modules as the CLI. A config reload rebuilds all of it.

**Consequences.**

- :material-plus-circle-outline: One entry per layer covers every slice, and a new slice is checked the moment it exists.
- :material-plus-circle-outline: Existing configs keep their owners and their messages, except the fix wording for layers with several literal prefixes.
- :material-plus-circle-outline: The language server no longer skips `node_modules` or virtualenv directories inside a layer's package, which closes a gap with the CLI that predates selectors.
- :material-minus-circle-outline: Slices can't come and go during a session without the user. Naming slices up to the last literal segment keeps routine edits (deleting or renaming a module inside a slice that keeps others) from blocking, but emptying a slice blocks even when it was a deliberate deletion: a move into a directory the walk skips looks exactly like one.
- :material-minus-circle-outline: A selector can't start with a wildcard, so a project with several top-level packages writes one selector per package.
- :material-minus-circle-outline: The evidence search doesn't follow symlinked directories. A slice reachable only through a link doesn't make its parent a container, so INW006 reports more there, never less.
- :material-minus-circle-outline: Contexts ([ADR-030](#adr-030-bounded-contexts-as-a-contexts-table-of-literal-prefixes)) still take literal prefixes only.

**Alternatives.**

- *Rank by matched depth alone:* simple, but `shop.**` would take `shop.orders.domain.order` away from a literal `shop.orders.domain` layer, which is never what the user meant.
- *First matching entry wins, as for shapes:* makes the order of the layers decide ownership as well as direction.
- *Name each slice by its full matched prefix:* under `shop.**` every file becomes its own slice, and deleting or renaming any module blocks the Stop gate.
- *Treat deleting a slice as allowed and only moves as errors:* the manifest can't tell a deletion from a move into `node_modules` or a virtualenv at the root, which the walks skip.
- *Leading wildcards (`*.domain`) with a walk of the whole tree:* the walks would have to open every top-level directory, virtualenvs included, to be safe.

## ADR-035: `inwards check` follows uv workspace members, each with its own config

**Status:** Accepted · 2026-09-28 · [#57](https://github.com/SirCypkowskyy/inwards/issues/57)

**Context.** A config has one `root`, and module names are paths below it. A uv workspace puts each member's package under its own `src/` (qv-lite: 7 members, `src/packages/core/src/qv_core`), so a config at the workspace root names the package `packages.core.src.qv_core` while other members import `qv_core`, and those imports pass as third-party ([#201](https://github.com/SirCypkowskyy/inwards/issues/201)). What worked was one `[tool.inwards]` per member and a shell loop of `inwards check --config <member>/pyproject.toml`. The hooks already pick the nearest config per file and pin every config at session start. [ADR-018](#adr-018-package-selectors-take-globs-from-the-start-monorepos-follow-uv-workspaces) decided that monorepos follow uv workspaces. Members also share implicit namespace packages (`acme.core` in one member, `acme.api` in another), which Python merges from both.

**Decision.**

- **Members come from uv, configs stay per member.** `inwards check` without `--config` reads `[tool.uv.workspace]` (`members` less `exclude`, `*` inside a segment) from the nearest workspace root at or above the working directory. Run where members with `[tool.inwards]` lie below it, it checks each against its own config and baseline; the nearest config at or below the workspace root checks the rest with those member directories left out, and a member nested in another is left to its own config. A member without `[tool.inwards]` is listed as not checked unless the root's config checks it. There is no new config key and no `--workspace` flag.
- **Named paths go to their nearest config.** Each path is checked against the nearest config above it, and a directory that holds configured members against theirs too. The workspace is looked for from each path, not from the working directory, so the plan doesn't depend on where the command runs. `--config` keeps its meaning: one config for everything.
- **One report.** The reports merge into one: one JSON or SARIF document, paths relative to the working directory, counts summed. Text and concise output end with a line per config. The exit code is the worst one; an invalid member config is exit 2, and the other members are still checked. "Nothing checked" (#200) is judged once, on the merged report. With `--log`, each config writes its own line, with only its own findings and duration.
- **Namespace packages look in the other members.** Relative imports already resolved by name as Python does. What was wrong was existence: INW010 reported a module missing from this member that another member's portion of the namespace package holds. The CLI now gives the engine a `portions` probe of the other members' import roots (`src/`, else the member directory) through `ProjectFiles`, and INW010 passes a missing module when its package here is a namespace package from the top-level package down and a portion holds it.
- **The hooks keep what they had,** with one addition: the config guard also protects a member's `[tool.inwards]` and baseline when neither session state nor a root config exists yet.

**Consequences.**

- :material-plus-circle-outline: qv-lite's loop becomes `inwards check` at the workspace root, and the list of members stays in the one place uv reads.
- :material-plus-circle-outline: A root config and member configs can live together without checking a file twice, and #201's warning still fires for a member that has no config of its own.
- :material-minus-circle-outline: Only uv workspaces are discovered. A monorepo without `[tool.uv.workspace]` still needs named paths or a run per config.
- :material-minus-circle-outline: `inwards baseline` still takes one config per run, and the language server still reads one config (its first-workspace-folder limit is tracked separately) and doesn't look in other members for namespace portions.
- :material-minus-circle-outline: A member's import root is guessed (`src/`, else the member directory), not read from its `root`, and a portion outside the workspace (an installed distribution) is still reported ([#161](https://github.com/SirCypkowskyy/inwards/issues/161)).

**Alternatives.**

- *Several roots in one config* (`roots = [...]`): one layer map for all members, but the member list would repeat what uv already has, and layers usually differ per member.
- *A walk for every nested `pyproject.toml` with `[tool.inwards]`:* covers non-uv monorepos, but costs a tree walk per run and has no notion of which directories belong together.
- *A `--workspace` flag:* explicit, but running at the workspace root already says it, and the old behaviour there (one config indexing members by path) was the false green #201 warns about.
- *Skipping INW010 under every namespace package:* simpler, but a hallucinated module in a namespace package would pass silently in every project that omits `__init__.py`.

## ADR-036: Package templates expand into config a user could write by hand

**Status:** Accepted · 2026-09-28 · [#97](https://github.com/SirCypkowskyy/inwards/issues/97)

**Context.** fastapi-best-practices gives every domain the same modules, the same import order between them (router, then dependencies, then service, then models and schemas, then constants) and the same few modules other domains may use. Shapes ([ADR-018](#adr-018-package-selectors-take-globs-from-the-start-monorepos-follow-uv-workspaces)), layer selectors ([ADR-034](#adr-034-layer-selectors-anchored-in-a-top-level-package-with-slice-aware-session-checks)) and contexts ([ADR-030](#adr-030-bounded-contexts-as-a-contexts-table-of-literal-prefixes)) could each say part of it, but only by repeating the list of modules in three tables. The issue also asked for independent siblings (`models | schemas`), which the layer order couldn't express: a layer could always import every layer listed before it, so one of two siblings could import the other.

**Decision.**

- **A template is a named table**, `[tool.inwards.templates.<name>]`, with `roles` (innermost first, `a | b` for siblings), `public`, the shape keys `allow`, `require`, `forbid` and `extra`, and `hints`. `template = "<name>"` works on a layer entry (the roles become layers inside the entry's modules), a shape entry (the template supplies the member keys, and a key the entry sets wins) and a context (the template's `public` names, under each of the context's modules, join its `public`).
- **Templates expand into config a user could write by hand, once, in the parser.** The parsed config holds no trace of them, so no rule, the baseline, the brief and the editor need to know templates exist, and a template can always be replaced by its expansion. Every template key therefore has a hand-written form, which is why two keys were added outside templates: `hints` on shape entries, and sibling layers as a nested array in `layers`.
- **Siblings are a rank.** A layer carries a rank when the config has siblings; layers of one rank may not import each other, and a layer may import every layer of a lower rank. INW001 and INW011 treat an import of a same-rank sibling as outward and say `from sibling layer`; the allowed direction joins siblings with `|`; INW005 gives every lowest-rank sibling the default deny list. A config without siblings gets no ranks, so its parsed form and every message stay as they were.
- **Role layers are named `<entry>.<role>`** and own `<module>.<role>` for each of the entry's modules, with the entry's library lists. The entry itself becomes no layer: a module in it that no role covers is outside every layer, as INW006 reports.
- **Errors name what the user wrote**: the entry's `template` key for an unknown template or one that lacks the roles or `public` the place needs, and the template's own key for a bad role, pattern or hint. A problem only the expansion shows (a role layer's name or prefix already taken) names the expanded layer.

**Consequences.**

- :material-plus-circle-outline: The fastapi-best-practices layout is one template and three short uses of it, and a new domain is covered the moment it exists. The test fixture holds the template and its hand-written equivalent, and they give the same diagnostics.
- :material-plus-circle-outline: Sibling layers work without templates too, which import-linter's `a | b` needed; `inwards import-config` still maps `|` to one layer plus contexts, and could move to nested arrays.
- :material-minus-circle-outline: Messages and the brief name role layers by their expanded names, `domain.service`, and the allowed direction of a large template is long.
- :material-minus-circle-outline: A role no package has makes an empty layer, which INW006 reports as an error, so optional members belong in `allow`, not in `roles`.
- :material-minus-circle-outline: Config findings for expanded selectors, such as a dead role layer, point at line 1 of `pyproject.toml`: the expanded text isn't in the file.
- :material-minus-circle-outline: Contexts still take literal prefixes, so each domain needs its own context entry; the template only saves its `public` list.

**Alternatives.**

- *Templates as their own concept in the rules:* the rules would need to resolve roles per package at check time, and a template could say things no hand-written config can, which makes it harder to reason about and to migrate away from.
- *Siblings as contexts, the way `inwards import-config` maps `|`:* contexts take literal prefixes, so they can't cover `src.*.models`, and a sibling context nested in a domain context would take its modules out of the domain's context.
- *Ordering the siblings instead* (`models` before `schemas`): `schemas -> models` would fail, but `models -> schemas` would pass, which is not what `|` means.
- *A `rank` key on each layer:* more flexible, but easy to get wrong; a nested array keeps the order visible in the list itself.

## ADR-037: Framework rule families, opt-in, with their own prefix

**Status:** Accepted · 2026-09-28 · [#186](https://github.com/SirCypkowskyy/inwards/issues/186)

**Context.** Chapter 1 says Inwards only reasons about the dependency structure between your own modules. [#98](https://github.com/SirCypkowskyy/inwards/issues/98) already plans content rules scoped to a layer's role. FastAPI is the next step: some of what goes wrong in a FastAPI project is architectural and needs a project-wide view that a per-file linter can't have. An `APIRouter` nothing includes, error codes the OpenAPI schema doesn't declare, and exception handlers registered in another file all span files. Ruff already has FastAPI rules (`FAST001` to `FAST003`, `FAST004` in review) and flake8-fastapi has `CF` codes, both one file at a time. Opt-in rules and per-rule options exist since [ADR-027](#adr-027-per-rule-select-ignore-and-severity-in-a-toolinwardsrules-table)'s #181 amendment.

**Decision.**

- **Framework rules come in families with their own prefix.** FastAPI rules are `FAPI` plus three digits. `INW` codes stay for architecture rules that hold in any Python project; a `FAPI` code says at once that the advice is about the framework. `FAST` is Ruff's and `CF` flake8-fastapi's, so reusing either would give one code two meanings in the same repository. A later family (`DJ` for Django, say) takes its own prefix, without renumbering anything. Codes are exact everywhere, so `select`, `ignore`, suppressions and SARIF need no change.
- **Every family rule is opt-in** (`default: "off"`): it reports only when `extend-select` or `select` lists it, and takes options in `[tool.inwards.rules.<rule-name>]`. A project that doesn't use the framework pays nothing, not even a parse: the shared model reads a file only when its text mentions the framework.
- **Don't duplicate Ruff.** A family rule never reports what Ruff's rules for that framework (`FAST`) or flake8-async (`ASYNC`) already report. Where Ruff covers the single-file case, the Inwards rule covers only what needs other files.
- **One shared model per family.** The FAPI rules read one model of apps, routers, path operations, wiring and exception handlers (`rules/fastapi/`), built statically from the source and resolved across files through `ProjectIndex`. The application is never imported or run ([ADR-006](#adr-006-the-engine-does-no-io)).
- **Registered codes may ship before their checks.** FAPI001 to FAPI003 are registered with their pages now and report nothing until [#183](https://github.com/SirCypkowskyy/inwards/issues/183) and [#184](https://github.com/SirCypkowskyy/inwards/issues/184); their pages say so. Codes planned later (FAPI004 for the [#185](https://github.com/SirCypkowskyy/inwards/issues/185) spike, FAPI005 to FAPI009 for #224 to #228) are listed in the rules index but not registered, so they stay config errors until they ship.

**Consequences.**

- :material-plus-circle-outline: A team turns the family on rule by rule, and a finding's code says whether it is architecture or framework advice.
- :material-plus-circle-outline: The model is written once; each FAPI rule is a query over it.
- :material-minus-circle-outline: Chapter 1's "only the dependency structure" no longer holds for opt-in families; the default rule set still does.
- :material-minus-circle-outline: A registered code with no checks yet is accepted by `extend-select` and does nothing, which a user may not expect; the page's banner is the only signal.
- :material-minus-circle-outline: Static resolution misses dynamic wiring (routers found by `importlib`, factories); each rule has to say how it degrades.

**Alternatives.**

- *FastAPI rules as `INW` codes:* one namespace, but a team couldn't turn the framework advice on or off as a unit, and the codes would mix two kinds of rule.
- *Reuse Ruff's `FAST` prefix:* familiar, but `FAST002` would mean two different rules in one repository.
- *On by default in projects that import FastAPI:* less configuration, but new errors would appear on an upgrade in every FastAPI project.
- *Contribute the checks to Ruff:* Ruff lints one file at a time, and these checks need the project-wide view.

**Amendment, 2026-09-28: findings that need the whole project ([#184](https://github.com/SirCypkowskyy/inwards/issues/184)).** FAPI003 is the first family rule whose findings need every file: a router is unmounted only if no app anywhere includes it.

- **Suppressible, unlike INW004.** Each FAPI003 finding sits on a line of its own (the `APIRouter(...)` call, the `include_router` call that closes a cycle), so a suppression there names one decision. INW004 can't be suppressed because its comment would sit on one import of many.
- **Checked files only, against the whole graph.** A partial run (a path argument, the Stop gate) builds the app and router graph from every FastAPI file of the project, and reports only in the files it checks. The Stop gate therefore reports a router the session created or changed, and a router already unmounted at session start is an old error.
- **The per-edit hook and the editor report one-file findings only.** Creating a router and wiring it into the app are two edits. They still build the graph when a file suppresses FAPI003, so the suppression counts as used instead of turning into an INW009 warning, then drop what it found.

## ADR-038: A witness of the session start outside the project, against a replayed SessionStart

**Status:** Accepted · 2026-09-28 · [#88](https://github.com/SirCypkowskyy/inwards/issues/88)

**Context.** The Stop gate trusts `.inwards/state/<id>.start.json`: the configs, HEAD and file hashes the session started from. The config guard keeps the agent's file tools away from it, but Bash reaches it in ways no pattern sees. The #23 review showed a full bypass: loosen `[tool.inwards]` with `sed`, `d=.inw; rm -rf ${d}ards/state`, then pipe a `SessionStart` payload with `source: startup` and the same session id into `I=inwards; $I hook claude-code`. The hook records a new start from the loosened project, and Stop passes. A partial replay (delete only `<id>.start.json`) worked too, and since #157 it also records copies of the agent's own edits. The same Bash can remove the Stop hook from `settings.local.json`; Claude Code reloads hooks at once, so that session's gate never runs. Every piece of state Inwards keeps is writable by the agent's user, so no local record is tamper-proof. The goal is to make these edits show up at Stop, without blocking a user who changed `[tool.inwards]` before the session and hasn't committed it.

**Decision.**

- **A witness outside the project.** SessionStart writes the same start record a second time, to `$XDG_STATE_HOME/inwards/sessions/<hash of the project path>/<id>.start.json` (`~/.local/state` without the variable), pruned by age only (a week). A count cap would let a flood of made-up sessions, started through the hook, evict the real session's witness before a replay, so there is none, and resume, compact and every Stop touch the witness, so a running session's never ages out. The platform gets `Runtime.stateHome` and `StateFiles.outsideDir`.
- **A replay keeps the original.** A `startup` or `clear` SessionStart for a session whose start file is gone but whose witness exists is a replay: the witness is put back as the start file and a `replay` event goes into the session log. Resume and compact are unchanged: they never create a start.
- **Readers prefer the witness.** `readSession` and `readSessionStart` use the witness when there is one, and say how the project's record compares: kept, deleted, rewritten, or unwitnessed. The per-edit hooks therefore use the original start too.
- **Stop reports what doesn't hold.** A logged replay, a deleted record and a rewritten record each block with their own message, on top of what the comparison with the original start finds (a changed config, new violations). They escalate like any other block, so the last Stop shows the user the list.
- **The committed config only where there is no witness.** A record without a witness (a session from an older Inwards, a witness deleted, or a state directory that couldn't be written) is trusted only when each of its configs is the one at its start HEAD, read with `git --no-lazy-fetch cat-file blob`, never `git show`, which could run the agent's filters. A witnessed session never makes this comparison, so a user's uncommitted config edit made before the session passes.
- **A missing Stop hook is reported by the next SessionStart.** When some layer still holds Inwards hooks but none holds the Stop hook, SessionStart tells the user in a `systemMessage` and the model in `additionalContext`. The Stop gate of the session that removed it can't run, so it can't report it.
- **No record at all still yields to the user.** When there is neither a start file nor a witness, the last Stop now ends the turn with a `systemMessage` instead of quietly.

**Consequences.**

- :material-plus-circle-outline: The replay in #88, and the partial one from #157, fail the Stop gate with a message that names the replay, and the changed config is reported against the original start.
- :material-plus-circle-outline: A user's own config edit before a session, `/clear`, resume and compaction behave as before.
- :material-minus-circle-outline: The witness is a speed bump. An agent that also deletes or forges `~/.local/state/inwards/sessions/...` before replaying gets a fresh baseline. The docs name the other layers: `permissions.deny`, CODEOWNERS and `inwards check` in CI.
- :material-minus-circle-outline: A Stop hook removed mid-session switches that session's gate off; the warning comes one session later, and only if SessionStart still runs.
- :material-minus-circle-outline: Inwards now writes outside the project, under the user's state directory. Writing the witness is best effort: when the state directory can't be written (a read-only home in a CI container or an agent sandbox), SessionStart still succeeds, tells the user once, and the session falls back to the committed-config comparison.
- :material-minus-circle-outline: Git older than 2.44 has no `--no-lazy-fetch`. Outside a partial clone nothing can be fetched, so the committed config is read without the flag. In a partial clone (`extensions.partialClone`, or a remote with `promisor` or `partialclonefilter`) it isn't read, and an unwitnessed record blocks with a message that says the config couldn't be checked and that a newer git or a writable state directory clears it.
- :material-minus-circle-outline: A flood of made-up sessions only adds small witness files, which age out after a week.

**Alternatives.**

- *Always compare the start config with the committed one:* catches the replay without a witness, but blocks every session that starts with an uncommitted config change, which is how users edit layers.
- *Read Claude Code's transcript and refuse a start recorded after the session's first tool use:* the Stop payload's `transcript_path` comes from Claude Code, but the transcript format isn't a public contract, the file can be large, it is just as writable by the agent, and OpenCode has none.
- *A PreToolUse marker outside the project on the first tool call:* the same Bash command that deletes the state can delete the marker before it replays.
- *Sign the start record:* the key would sit where the agent's user can read it.

## ADR-039: A hook daemon per project, separate from the language server

**Status:** Accepted · 2026-10-10 · [#59](https://github.com/SirCypkowskyy/inwards/issues/59)

**Context.** Three long-lived front ends are planned: a process that keeps the engine warm for the hooks ([#60](https://github.com/SirCypkowskyy/inwards/issues/60)), a language server inside the binary ([#63](https://github.com/SirCypkowskyy/inwards/issues/63), [ADR-008](#adr-008-language-server-on-node-inside-the-extension-for-now)) and an MCP server ([#65](https://github.com/SirCypkowskyy/inwards/issues/65)). Chapter 6 called the hook process `inwards server`, the name ADR-008 gives the language server, and the backlog called it `inwards daemon`. Whether one process could serve both the editor and the hooks was open.

Today the CLI runs one command per process. `main.ts` builds `AppDeps` once, `runCheck` reads the config and creates an `Engine` on every call, and the WASM runtime and grammar load once per process (a module-level promise in `python/parser.ts`). The VS Code language server is resident already: a Node process the extension starts over IPC, holding the engine, the module index and an in-memory extraction cache while the window is open.

The spike ([chapter 6](06-Constraints-and-Quality.md#spike-a-resident-process)) ran the real hook handler warm behind a Unix socket and compared it with the darwin-arm64 binary run one-shot, on macOS, under a load average of 5 to 7. It found:

- **The client's own start is the floor.** `inwards --version` takes 15.5 ms p50, and every hook call starts a process before it can ask anything.
- **PostToolUse is where a daemon pays.** One-shot, p50 / p95: 46.6 / 50.2 ms for a 13-line file, 119.9 / 151.6 ms for a 4,492-line file with two violations. The same handler warm, unchanged: 32.3 / 35.2 and 91.1 / 97.7 ms. With two in-memory caches: 17.2 / 19.8 and 18.2 / 19.7 ms, and 47.6 / 50.1 ms (one-shot 117.5 / 122.8) when the big file changes before every call.
- **One git call costs as much as starting the process.** One `git cat-file blob` that reads the file's session-start text for the old-violation split takes about 15 ms, and each PostToolUse checks the file twice, as it is now and as it was at session start: 30 ms each for the big file, warm.
- **The other events don't.** PreToolUse takes 16.8 ms one-shot, next to the 15.5 ms floor. Stop takes 141 ms, once per turn.

**Decision.**

- **Separate processes, one binary.** `inwards server` is the language server: LSP over stdio, started and stopped by the editor, one per workspace, checking the editor's unsaved text. `inwards daemon` serves the hooks: one per user and project, started by a hook, gone after 10 minutes without a request, checking what is on disk. `inwards mcp` is the MCP server over stdio, started by the MCP client. The three share one warm-engine module in the CLI and never talk to each other.
- **Only PostToolUse goes through the daemon.** SessionStart, PreToolUse and Stop always run in the hook's own process. PreToolUse loads no grammar, so it would save nothing. Stop is the enforcement and finds what a session changed from the start manifest, not only from the edits PostToolUse recorded. A daemon that answers wrong (a bug, a stale build, or a process the agent put at the endpoint) can delay a finding until Stop; it can't let one through.
- **The same handler, with a per-request platform.** The daemon runs today's `hookClaudeCode` with a `Runtime` built from the client's working directory and environment, and `Streams` that collect the output. The client writes stdout and stderr back and exits with the daemon's code. The hook E2E fixtures run both ways in the tests, and the outputs must match.
- **It keeps only what its content identifies.** Across requests the daemon keeps the grammar, an extraction cache keyed like [ADR-031](#adr-031-a-content-keyed-extraction-cache-that-the-hooks-never-read)'s (text hash, module name, package flag, extraction revision; several texts per module, since the start text and the edited text are both in use; at most 5,000 entries and about 32 MB, as in the language server), and session-start text read from git, keyed by repository, start commit and path. The config, the baseline, the file listing and the session state are read again for every request, as a one-shot run does, so no config edit, checkout or new baseline can leave it stale. A warm check of a 13-line file, config and module index included, took 0.8 ms in the spike. Nothing is written to disk: the hooks still read no cache the agent can write.
- **Transport.** `node:net` on both sides: a Unix domain socket on Linux and macOS, a named pipe on Windows. The socket goes in a directory only the user can open: `$XDG_RUNTIME_DIR/inwards/`, else `$TMPDIR/inwards-<uid>/`, else `/tmp/inwards-<uid>/`, created with mode 0700 and used only while it is a real directory the user owns with that mode. The name is 16 hex digits of the project's real path hash and 8 random ones, which keeps the path under macOS's 104-byte limit; the pipe is `\\.\pipe\inwards-<hash>-<random>`. After it listens, the daemon writes `daemons/<hash>.json` under the state directory of [ADR-038](#adr-038-a-witness-of-the-session-start-outside-the-project-against-a-replayed-sessionstart) (mode 0600, through a temporary file and a rename): the protocol, the Inwards version, the executable's identity, its pid and the endpoint. Windows pipe names share one namespace across users, so the random part keeps another user from taking the name first.
- **Framing.** One request per connection, one line of JSON each way. The request carries `protocol: "inwards-daemon/1"`, the version, the executable's identity (path, size and modification time), `argv` (only `hook claude-code` is served), the working directory, the environment variables `Runtime` reads, and the hook payload. The answer carries the exit code, stdout and stderr, or an `error` (`stale`, `protocol`, `too-large`). A payload over 16 MB isn't sent; the hook runs one-shot.
- **Staleness.** Any difference in protocol, version or executable identity gets `stale`: the daemon exits, and the client runs one-shot and starts a new one. The daemon also checks its own executable on every request, for an upgrade that replaced the file in place. Client and daemon are always the same build, so there is no compatibility across versions to keep.
- **Start-up, races and fallback.** A hook that finds no daemon, can't connect within 100 ms or gets `stale` runs one-shot, so it answers no later than today, and then starts `inwards daemon` detached. Two hooks starting one at once are settled by a lock file created exclusively next to the record, holding the pid; the loser exits, and a lock whose pid is gone is removed and retried once. Endpoints are random, so two daemons never contend for a path. Once the request is sent, the client waits for the answer as long as the hook's own timeout allows: running the hook again in parallel would record the edit twice. A connection that closes without an answer runs one-shot, and #60 keys recorded edits by `tool_use_id` so that this retry can't count an edit twice.
- **One request at a time.** The daemon handles requests in arrival order, as the language server serialises its reloads: parallel tool calls write the same session state.
- **Off switches.** `INWARDS_DAEMON=0` makes every hook run one-shot. The daemon is off when `CI` is set, and the test suite runs with it off except in the daemon's own tests. It isn't a `[tool.inwards]` key: it changes speed, never results.
- **Full runs stay one-shot.** `inwards check`, `inwards baseline` and the worker pool ([#61](https://github.com/SirCypkowskyy/inwards/issues/61)) run in their own process; the daemon serves one-file checks and hosts no workers.
- **Names.** `inwards server` (as `ruff server` and `ty server`), `inwards daemon` with `inwards daemon status` and `inwards daemon stop` for the current project, and `inwards mcp`. Chapter 6 and ADR-008 use these names.

**Consequences.**

- :material-plus-circle-outline: In the spike, PostToolUse p95 fell from 50.2 to 19.8 ms for a small file and from 122.8 to 50.1 ms for a 4,492-line file edited before every call. #60's target, p95 under 50 ms, is met for the small file and at the edge for the large one. On the Linux laptop of chapter 6's bytecode spike, `inwards --version` took 10.5 ms, not 15.5.
- :material-plus-circle-outline: Warm JIT comes with it: a one-shot check of the large file took 70.8 ms, the same check warm 30 ms.
- :material-plus-circle-outline: The Stop gate and the guards keep their trust model. A broken or impostor daemon costs latency and early feedback, not a missed violation at Stop.
- :material-plus-circle-outline: One warm-engine module serves three front ends, and the language server moves into the binary (#63, #64) with the cache code it has today.
- :material-minus-circle-outline: Each project with a daemon holds 150 to 210 MB of RSS (the spike's server, run from source) for up to 10 minutes after its last edit. Five agent sessions in five repositories hold five.
- :material-minus-circle-outline: Every hook call still starts a Bun process, about 15 ms here. Only a client written in another language could remove that.
- :material-minus-circle-outline: The user, and so the agent, can connect to the daemon, stop it, or point the record at its own process. Connecting gives nothing `inwards` itself doesn't; an impostor can only change what PostToolUse says before Stop checks again.
- :material-minus-circle-outline: Named pipes weren't measured: the spike ran on macOS. #60 has to show the Windows row passing (a manual run of the full matrix) before it merges.
- :material-minus-circle-outline: A second code path for PostToolUse. Running the E2E fixtures through both is what keeps them equal.

**Alternatives.**

- *One process for the editor and the hooks,* either the language server also listening for hooks or one daemon per project with `inwards server` as a stdio proxy to it. Lifetimes differ: an editor window against an agent session, and agents often run with no editor open, so the hooks can't rely on one. Inputs differ: unsaved buffers against the disk and the session state. A proxy puts a socket hop on every keystroke for a server that is resident anyway, a crash takes down both, and several windows on one repository would have to elect an owner.
- *Every hook event through the daemon:* PreToolUse would save about 1 ms, and the Stop gate's verdict would come from a process the agent can replace.
- *No daemon, a faster one-shot run:* bytecode already halved start-up ([#39](https://github.com/SirCypkowskyy/inwards/issues/39)). What remains is process start, WASM and grammar loading and cold JIT (27.7 ms one-shot against 0.8 ms warm for the small file), plus work that could only be reused between processes through files the agent can write.
- *An engine per config, kept up to date by file watchers:* saves rereading the config, which costs well under a millisecond, and makes staleness a correctness problem (a missed event, a network filesystem).
- *TCP on localhost:* any local user can connect, a port has to be chosen and published, and Windows may ask about the firewall.
- *LSP framing, JSON-RPC or HTTP over the socket:* they handle request ids, notifications and routing; one request per connection needs none of them.
- *A small native client for the hook command:* would remove most of the 15 ms floor, but adds a second toolchain and a second binary per platform, against [ADR-003](#adr-003-ship-a-bun-single-file-executable). Worth a look if the Linux benchmark misses 50 ms.
- *Other names:* `inwards serve` is one letter from `server` and reads like the docs preview; `inwards lsp` breaks with Ruff and ty, which users try first; one `inwards server` with `--stdio` and `--socket` modes hides that the two have different owners and lifetimes.

**Amendment · 2026-10-10 · [#60](https://github.com/SirCypkowskyy/inwards/issues/60).** The implementation settles details the decision left open:

- **`INWARDS_DAEMON=1` turns the daemon on even when `CI` is set,** for the daemon's own tests and the bench job, which run under CI. Unset, it is on unless `CI` is set; `0` turns it off.
- **A hook starts a daemon only in a project with Inwards session state** (`.inwards/state`, which only SessionStart creates, and only where `[tool.inwards]` exists). A hook installed for every project starts nothing in a project that doesn't use Inwards.
- **The hook waits 45 s for an answer,** under Claude Code's 60 s default timeout, so the one-shot retry still has time. Recorded edits carry the payload's `tool_use_id`, and an edit recorded twice under one id counts once, for the Stop gate's list and for escalation, so that retry can't count an edit twice.
- **The extraction cache keeps up to 4 texts per module** within the 5,000-entry and 32 MB bounds, and git answers are kept only for `cat-file blob <commit>:<path>` and `ls-tree <commit>` with a full commit id, bounded at 2,000 entries and 32 MB.
- **Run from source,** the executable's identity is Bun's and `main.ts`'s; an edit to another source file doesn't make the daemon stale. `inwards daemon stop` after such an edit; the compiled binary has no such gap.
- **The daemon refuses anything but a PostToolUse payload** for `hook claude-code`, so a process that connects to it can't get a Stop gate verdict from it either.
- **`inwards daemon --idle SECONDS`** sets the idle limit, 600 by default; the tests use short ones.

**Amendment · 2026-10-10 · [#276](https://github.com/SirCypkowskyy/inwards/issues/276).** A pid alone doesn't say who holds the lock: a daemon killed without cleaning up (SIGKILL, a crash, a reboot) leaves its lock behind, and once the OS gives that pid to another process, every later daemon stepped aside and every PostToolUse ran one-shot. The lock now holds the pid and 32 random hex digits, and `inwards daemon status`'s answer repeats them. A daemon that finds a lock takes it over when the pid is gone or is its own, and, once the lock is older than 10 seconds, when the daemon at the record's endpoint doesn't answer with that pid and token. A younger lock counts as held, because its daemon may still be starting to listen. The check uses only the socket and the file's age, so it works the same on Linux, macOS and Windows, and the Stop gate still doesn't depend on any of it.

**Amendment · 2026-10-10 · [#275](https://github.com/SirCypkowskyy/inwards/issues/275).** A daemon that can't listen (no socket directory is private to the user, every socket path would be over 104 bytes, or the listen fails) exits, and the next PostToolUse found no record and started another, so every edit paid for a process that exited at once. The daemon now writes `daemons/<hash>.failed` beside the record (owner-only, through a temporary file and a rename) with the time, the reason and its pid, before it releases the lock. A hook that would start a daemon starts none while that note is less than 5 minutes old, so a run of edits starts at most one daemon per 5 minutes. A daemon that listens removes the note, and `inwards daemon status` shows it when nothing runs. A note dated more than 5 minutes ahead (the clock was set back) doesn't hold hooks back.

**Amendment · 2026-10-10 · [#277](https://github.com/SirCypkowskyy/inwards/issues/277).** The hook's work is synchronous, and git ran through `spawnSync` with no limit, so one git call that hung (a network filesystem, a lock another git holds) held the daemon's queue: later PostToolUse hooks waited their 45 s before running one-shot, and `inwards daemon stop` waited behind them. Now all the git calls of one daemon request share a 5-second budget. A call that would run past it is killed with SIGKILL (SIGTERM can be ignored, and `spawnSync` returns only once the child exits), a call after it runs out isn't started, and both answer "not there", as a failed call does. A timed-out answer is never cached. The one-shot hook and the Stop gate keep running git without a limit. `status` and `stop` skip the queue: the daemon answers them as soon as it reads them, which a hook run delays by at most its git budget plus its own work, and the client waits 15 s for that answer instead of 5. Once stopping, the daemon drops the requests still queued, and their hooks run one-shot. A request that hits the budget doesn't retire the daemon: a new one would meet the same stuck git, and nothing it keeps came from the failed calls.

## ADR-040: Worker threads parse a large full check; the main thread keeps every decision

**Status:** Accepted · 2026-10-10 · [#61](https://github.com/SirCypkowskyy/inwards/issues/61)

**Context.** A cold `inwards check` runs on one core: 1.48 s for saleor's 4,324 files, 2.34 s for the synthetic legacy repo whose every module needs a confirming full parse (p50 on a 10-core laptop). CI runners have several cores. Profiles of a cold run show where the time goes on saleor: about a third in the prescan's skeleton parse and the text tests before it, a quarter in full parses that confirm findings, a quarter in walking the tree, resolving real paths and reading files, and the rest in the rules, the module index and start-up. Only the parsing depends on nothing but a file's text. [ADR-039](#adr-039-a-hook-daemon-per-project-separate-from-the-language-server) already put the pool in the full run's own process, never in the hook daemon.

**Decision.**

- **Threads, not processes.** The CLI starts Bun worker threads, each running the binary's own entry: `main.ts` sees it isn't the main thread and serves extraction jobs instead of parsing argv. The compiled executable needs no second entry point and nothing on disk. Each worker loads the grammar from the bytes the main thread sends it.
- **The unit of work is an extraction job.** `ExtractionJob` is a source file and what to extract: the skeleton (with the loader test that decides whether the skeleton is read at all) or the full parse's imports and suppression comments. The answer is the extraction cache's own record ([ADR-031](#adr-031-a-content-keyed-extraction-cache-that-the-hooks-never-read)), so it can't hold anything the cache couldn't. `createExtractionWorker` runs jobs with the code the engine uses itself.
- **The engine asks twice, then checks as before.** `Engine.checkWith` hands the batch the skeleton jobs of every file the scan reads, scans, works out which files the confirmations and suppression comments will parse, hands those over, and then checks every file in order exactly as `Engine.check` does, reading the preloaded answers before the cache. Rules, precedence, the baseline shortcut, dynamic imports (whose reading depends on other files), FastAPI's cross-file findings and import cycles stay on the main thread.
- **Answers are hints, never results.** A job the pool doesn't answer, a malformed answer or a batch that fails is computed by the engine as without the pool, so any error surfaces as it does today. A worker that dies or answers with an error is retired and its batch goes back in the queue.
- **The main thread parses too.** While the workers run, the main thread takes batches from the back of the queue, so a pool of N threads starts N-1 workers.
- **When.** Only `inwards check` and `inwards baseline` start workers, and only for 1,000 files or more, with one thread per 500 files up to the limit. The limit is `INWARDS_THREADS`, else half of the cores beyond two, at most 4: one thread on 4 cores, three on 8, four from 10. Each thread runs its own JavaScript VM, whose JIT compiler and garbage collector need cores of their own. `INWARDS_THREADS=1` keeps a check on one thread. It is an environment variable, not a `[tool.inwards]` key, because it changes speed, never results.

**Consequences.**

- :material-plus-circle-outline: Cold full checks, p50 with four threads against the base build: saleor 1.48 → 0.98 s, polar 0.80 → 0.55 s, the synthetic repo 0.52 → 0.44 s, the synthetic legacy repo 2.34 → 1.14 s ([chapter 6](06-Constraints-and-Quality.md#worker-threads-for-a-full-run)). The output is byte for byte the same; a test compares one thread with four through the CLI, and the engine's tests compare `checkWith` with `check` on every path through the engine.
- :material-plus-circle-outline: The engine stays pure. The port is a function from jobs to answers; the threads are the CLI's adapter.
- :material-minus-circle-outline: Short of the 3× [#61](https://github.com/SirCypkowskyy/inwards/issues/61) asked for. Walking the tree, resolving real paths, reading the files and the rules stay on the main thread: with four threads, saleor spends about a third of its time before the engine starts. Eight threads were slower than four on saleor and the synthetic repo.
- :material-minus-circle-outline: Each worker holds its own WASM runtime and grammar: saleor's peak RSS goes from about 360 MB to about 520 MB with four threads and 615 MB with eight.
- :material-minus-circle-outline: On Linux the gain is smaller. Pinned to four cores, a container on the same laptop ran the synthetic repo 60% slower with four threads, and about as fast with two as with one; with eight cores, the legacy repo took 1.23 s on four threads against 2.30 s on one ([chapter 6](06-Constraints-and-Quality.md#worker-threads-for-a-full-run)). On the bench job's 4-core Linux runner, four threads made the synthetic repo's full check 59% slower and two 19% slower, so a 4-core machine keeps one thread, and the 3× on 4 vCPU that #61 named isn't possible this way.
- :material-minus-circle-outline: A worker compiles the grammar and warms up its JIT on its own, so below about 1,000 files the threads cost more than they save. A repo that needs many confirming parses would gain earlier; the threshold counts files because the work isn't known until the scans run.

**Alternatives.**

- *Child processes of the binary:* each pays process start-up (about 15 ms) on top of the grammar, and the jobs would travel through pipes as JSON instead of a structured clone.
- *Each worker checks a slice of the files:* parallelises the rules too, but the baseline shortcut, FastAPI's cross-file findings, the unassigned-package warnings and import cycles need every file, and each worker would build its own module index from the disk. Keeping the decisions on one thread keeps the output order and the precedence rules where they are.
- *Workers read the files too:* would move the quarter spent reading into the pool, but the main thread needs every text for the rules anyway, and the module names come from real paths that the CLI's identity checks own.
- *More threads by default:* on a loaded 10-core laptop, eight threads were slower than four on saleor (1.04 against 0.98 s) and the synthetic repo, and faster only on the legacy repo (1.03 against 1.14 s).

**Amendment · 2026-10-10 · [#281](https://github.com/SirCypkowskyy/inwards/issues/281).** The serial part before the engine got cheaper without moving any decision off the main thread. The walk gives each file the real path it already resolved for the file's directory, so the check calls `realpath` once per directory and symlink instead of twice per file. A check of 1,000 files or more counts its files first, starts the pool, and then reads every file in one batch while the workers load the grammar. Each worker holds two batches, so it never waits for the main thread to finish one of its own before it gets the next. Saleor's cold check with four threads went from 1.09 to 0.87 s, against 1.48 s single-threaded before #61 ([chapter 6](06-Constraints-and-Quality.md#the-serial-part-of-a-full-run)). The alternative *Workers read the files too* stays rejected: a variant in which idle workers parsed each chunk of files as it was read, and the engine reused the answers to identical jobs, measured no faster. On Linux the change measured no faster on four cores and 5% faster on eight, since Linux resolves paths and reads files from its caches cheaply.

## ADR-041: `inwards server` runs `inwards check`'s own code; the extension's Node server stays until it switches

**Status:** Accepted · 2026-10-10 · [#63](https://github.com/SirCypkowskyy/inwards/issues/63) · supersedes [ADR-008](#adr-008-language-server-on-node-inside-the-extension-for-now)

**Context.** [ADR-008](#adr-008-language-server-on-node-inside-the-extension-for-now) kept a Node language server inside the VS Code extension until the binary had `inwards server`; [ADR-039](#adr-039-a-hook-daemon-per-project-separate-from-the-language-server) fixed that name, kept the server a process of its own, and gave the CLI the warm-engine module (`daemon/memory.ts`) that the extension's in-memory extraction cache had been. The extension's server is a second adapter around the engine: its own file walk (`workspace.ts`, kept equal to the CLI's by a parity test), its own config reader, a module index it rebuilds on file events, and only the first workspace folder's root `pyproject.toml`. For files nobody opened it shows INW007 and INW008 from a directory listing, so the editor and `inwards check` disagree about every other rule there. The binary runs on Bun; the extension runs on Node in VS Code's extension host, and the CLI's check path uses Bun's TOML parser and grammar files embedded in the executable.

**Decision.**

- **The server lives in the CLI and checks with `inwards check`'s code.** `src/cli/src/lsp/` decides when to check what and what each document shows, `adapters/lsp-connection.ts` speaks LSP over stdio with `vscode-languageserver` 10 (the version the extension uses), and `commands/server.ts` is the command. Every check goes through `planCheck` and `runCheck`, so the server has no walk, config reader or module index of its own.
- **Nothing is shared with the extension.** The extension keeps its Node server, frozen, until [#64](https://github.com/SirCypkowskyy/inwards/issues/64) makes it a thin client that starts `inwards server` and deletes `src/vscode-extension/src/server/`. Changes to what an editor shows go into the CLI's server.
- **A whole pass is `inwards check` in every workspace folder.** Each folder gets the configs `inwards check` would run there (its nearest `[tool.inwards]`, or each uv workspace member's), each config once, with the open documents' unsaved text in place of the disk's. Every finding is published on its file, so a file nobody opened shows everything `inwards check` reports, and `pyproject.toml` shows the whole-project INW006 findings. The pass runs at start, on a save, when a workspace folder comes or goes, and when the editor's file watchers report a change that can alter a finding: a module file or a directory created, changed or deleted, a `pyproject.toml`, or `inwards-baseline.json`, outside hidden directories and `__pycache__`. Events are collected for 100 ms, so a branch switch runs one pass.
- **A keystroke checks that document alone,** as the PostToolUse hook checks an edit (`edit: true`), with the config `inwards check` would route it to. The document shows that check plus what the last pass found in it that a check of one file can't find (an import cycle, a FastAPI router no app includes); those update on the next save.
- **Nothing is kept but extracted text.** As in the daemon, every check reads the config, the baseline and the file listing again, so a config edit, a checkout or a new baseline can't leave the server stale, and file events only decide when a pass runs. Across checks the server keeps the daemon's extraction cache (5,000 entries, about 32 MB, 4 texts per module). On a 10-core laptop, the synthetic repo of [chapter 6](06-Constraints-and-Quality.md) (2,100 files) took 504 ms for the first pass, 154 ms p50 for later ones, and 0.6 ms p50 for a keystroke, run from source.
- **One thread, one check at a time.** The server never starts worker threads ([ADR-040](#adr-040-worker-threads-parse-a-large-full-check-the-main-thread-keeps-every-decision)). Checks run in arrival order; a keystroke check that is still waiting reads the newest text when it runs, so typing queues at most one per document.
- **Stdout belongs to the protocol.** The connection gets stdin and stdout explicitly; the check's own streams write stdout's text to stderr, and Biome keeps `console` out of the CLI. `--stdio`, which editors pass by convention, is accepted and changes nothing; the library reads `--clientProcessId` itself. The server exits on `exit`, when stdin closes, or when the editor's process is gone.
- **Errors.** A broken config pops up once per config and message, and stays as an error on its `pyproject.toml` (on the line the TOML parser names, else the first) until a pass finds it fixed; its files show nothing meanwhile.

**Consequences.**

- :material-plus-circle-outline: Any editor with an LSP client (Neovim, Helix, and VS Code once #64 lands) gets Inwards from the one binary, with nothing else installed.
- :material-plus-circle-outline: Once every file is saved, the editor shows what `inwards check` reports in each folder; `src/cli/test/lsp/parity.test.ts` compares the two on examples/ as a two-folder workspace, against the compiled binary in CI.
- :material-plus-circle-outline: No module index or config to keep up to date, so the extension's watcher fallbacks and serialised reloads have no counterpart here; an editor without file watching gets a new pass on every save.
- :material-minus-circle-outline: Two language servers until #64: the extension's still shows only INW007 and INW008 for files nobody opened.
- :material-minus-circle-outline: Every save costs a whole-project check. Parsing is cached, but walking the tree, reading the files and the rules are not: 154 ms for 2,100 files.
- :material-minus-circle-outline: Unsaved edits to `pyproject.toml` or the baseline count only once saved, and findings in other files that depend on unsaved text (cycles through it, say) update only on the next pass.
- :material-minus-circle-outline: Two workspace folders whose configs both cover a file (a project nested in another that isn't a uv workspace member) show its findings twice, as running `inwards check` in both folders would.
- :material-minus-circle-outline: The binary carries `vscode-languageserver` and its protocol and JSON-RPC libraries.
- :material-minus-circle-outline: Paths become URIs with Node's `pathToFileURL` for files nobody opened; open documents keep the editor's own URI. Windows drive letters and their encoding weren't tried on Windows, so the full test matrix has to run before a release.

**Alternatives.**

- *A module both servers import now:* the extension would run the CLI's check path on Node, which means replacing Bun's TOML parser and embedded grammars there, for a server #64 deletes in the next release.
- *The extension starts the binary now:* the extension then needs a binary for each platform inside the VSIX or a download step, which is #64's work, with the Marketplace.
- *The extension server's design in the binary* (open files checked in full, the rest from a listing, a module index kept by watchers): moves the disagreement with `inwards check` into the binary, and keeps a cache whose staleness depends on every event arriving.
- *A whole pass on every keystroke:* always exact, but a pause in typing in a large project costs a whole check, against 0.6 ms for one file.
- *Worker threads for the pass:* each pass would start a pool of JavaScript VMs again or keep one alive per editor window; ADR-040's numbers show threads pay only from about 1,000 files, and a warm pass is already cached.

## ADR-042: `inwards mcp` answers with `inwards check`'s own check, on texts laid over the disk

**Status:** Accepted · 2026-10-10 · [#65](https://github.com/SirCypkowskyy/inwards/issues/65)

**Context.** [ADR-039](#adr-039-a-hook-daemon-per-project-separate-from-the-language-server) named `inwards mcp` as a third long-lived front end: an MCP server over stdio, started by the agent's MCP client, sharing the warm-engine module and talking to neither `inwards server` nor `inwards daemon`. The issue asked for three tools: `check_files`, `explain_rule` and `where_should_this_go`. The hooks see code only after an edit; an MCP tool can answer before the agent writes, but only when the agent asks. The MCP TypeScript SDK has two lines: v1 (`@modelcontextprotocol/sdk`), now on bug and security fixes only, and v2 (`@modelcontextprotocol/server` 2.3), which implements the 2026-07-28 revision and still serves clients that open with `initialize`. Claude Code and the v2 client itself still open with `initialize` (2025-11-25).

**Decision.**

- **One process per client session, in the CLI.** `src/cli/src/mcp/` holds the tools' policy, `adapters/mcp-connection.ts` speaks MCP over stdio with the SDK v2 (2.3.1) and its `serveStdio`, which serves both protocol eras from one server factory, and `commands/mcp.ts` is the command. Input schemas are Zod 4 (`zod` 4.6.5), which the SDK turns into the JSON Schema `tools/list` shows. The SDK, Zod and the rule pages load with dynamic imports, so the binary keeps them in chunks only `inwards mcp` reads; no hook call pays for them.
- **`check_files` is `inwards check`.** `planCheck` routes the targets from the working directory, `runPlan` runs and merges the configs, and `runCheck` checks, with the language server's warm I/O (in-memory extraction cache, one kept parse, no worker threads). Python source an agent passes in `contents` is laid over the disk for that call (`project/overlay.ts`): a file that doesn't exist yet, with any missing package directories, appears in the probe, the listings, the walk and so the module index, and reads as the given text. The answer is the `inwards/diagnostics@1` report. Nothing is written, and nothing is noted in the run log, since a call is a question rather than a run.
- **`explain_rule` serves the rule pages.** The English pages in `docs/chapters/rules/` are imported as text and built into the binary; the tool returns the registry's metadata and the page's What it does, Why is this bad, Example and How to fix sections (every section with `full`), with test markers dropped and relative links made absolute. A test fails when a registered rule has no embedded page.
- **`where_should_this_go` asks the check, not a second reading of the config.** For the module the agent names, and for a new module in each layer's first literal prefix, it checks a probe module that holds only the planned imports, in memory. An import is refused exactly when a real file there would get INW001, INW002, INW003, INW005 or INW010. The suggestion is the named module when its imports pass; else, among the layers where they all pass, the one the description points to, else the innermost; without imports, the layer the description names or a short list of role words points to.
- **Read-only and serial.** Every tool is annotated read-only and idempotent. Calls run one at a time, like the language server's checks, so two never share the kept parse. Each call reads the config, the baseline and the listing again.
- **Stdout belongs to the protocol.** The checks get streams whose stdout writes to stderr, as `inwards server`'s do. The server ends when the client closes stdin.

**Consequences.**

- :material-plus-circle-outline: Any MCP client gets the three tools from the one binary; Claude Code and Codex CLI were tried by hand, and the tests drive the compiled binary over stdio with the SDK's client in both eras.
- :material-plus-circle-outline: An agent can check code before writing it, in a package that doesn't exist yet, and get the same findings and fix steps the PostToolUse hook would give after the edit.
- :material-plus-circle-outline: `where_should_this_go` follows every rule that judges imports, including contexts and library rules, with no code of its own that could drift from them.
- :material-minus-circle-outline: The binary carries the SDK and Zod (about 0.5 MB minified) and the rule pages (about 0.2 MB), loaded only by `inwards mcp`.
- :material-minus-circle-outline: `explain_rule` serves English only; the Polish pages stay on the site.
- :material-minus-circle-outline: Each probe is a check: one per layer, plus the named module. A config with many layers makes the call slower, though each is a one-file check on warm caches.
- :material-minus-circle-outline: The description hint is a word list. It knows English role words and the configured names, nothing else.
- :material-minus-circle-outline: A probe can't tell a lowercase name in a module (`shop.domain.order.total`) from a submodule; the tool reads it as a module, so INW010 may report it. Capitalised names (`Order`) are imported as names.

**Alternatives.**

- *SDK v1:* the same API shape, but maintenance only, and it doesn't serve the 2026-07-28 revision.
- *JSON-RPC written by hand:* no dependency, but two protocol eras, schema validation and the handshake would be ours to keep up with the spec.
- *`where_should_this_go` from the config alone* (layer order and prefixes): simpler, but it would miss contexts, library rules and modules that don't exist, and repeat the rules' logic outside the engine.
- *A model to read the description:* Inwards has no network and no model, and an answer should be the same every time.
- *Rule pages as MCP resources:* clients surface tools to the model more reliably than resources, and the issue asked for a tool. Resources can come later.
- *Serving `explain_rule` from the published site:* needs the network, and the page could describe another version than the binary's.

## ADR-043: The VS Code extension bundles the binary, one VSIX per platform

**Status:** Accepted · 2026-10-10 · [#64](https://github.com/SirCypkowskyy/inwards/issues/64) · completes [ADR-041](#adr-041-inwards-server-runs-inwards-checks-own-code-the-extensions-node-server-stays-until-it-switches)

**Context.** [ADR-041](#adr-041-inwards-server-runs-inwards-checks-own-code-the-extensions-node-server-stays-until-it-switches) moved the language server into the binary and left the extension's Node server frozen until the extension could start `inwards server`. To do that, the extension needs an `inwards` executable for the user's platform. `cd.yml` already cross-compiles six binaries on one runner, runs each on its own OS, and attaches them with `SHA256SUMS` to a draft GitHub Release ([#14](https://github.com/SirCypkowskyy/inwards/issues/14)). The repository is private, so downloading a release asset takes a GitHub login. Since VS Code 1.61 the Marketplace serves the package built for the user's platform, `vsce package --target` builds one, and Open VSX serves them too.

**Decision.**

- **One VSIX per platform, with that platform's binary inside.** `src/vscode-extension/scripts/package-target.ts` copies each release binary into `bin/` (`bin/inwards.exe` on Windows) and runs `vsce package --target` for `linux-x64`, `linux-arm64`, `alpine-x64` (the musl binary), `darwin-x64`, `darwin-arm64` and `win32-x64`. A seventh, universal VSIX has no binary; the registries serve it to every other platform (Windows on Arm, 32-bit Arm Linux, Alpine on arm64), where the extension needs `inwards` on `PATH` or the `inwards.path` setting. `package.json`'s `files` lists what ships, so nothing else gets in.
- **Which binary runs.** `inwards.path` if set, else the bundled binary, else `inwards` on `PATH`. A set path that points at nothing is an error, never replaced by another binary of a different version. A bare name in the setting is looked up on `PATH`, a relative path resolves against the first workspace folder, and `~` and `${workspaceFolder}` are expanded. On Windows only an `.exe` counts, since Node can't start a `.cmd` or `.bat` without a shell.
- **`inwards.path` is a restricted setting.** In an untrusted workspace VS Code hands the extension only the user's own value, so a cloned repository can't choose the program the extension starts.
- **No binary is a message, not a crash.** The extension says what it looked for, offers the setting and the install guide, and stays idle until a setting changes or **Inwards: Restart Server** runs. `inwards.enable` turns the server off.
- **Publishing is its own workflow.** `vscode-publish.yml` starts when a full release is published (once the owner sets the `VSCODE_PUBLISH` variable), downloads the release's seven VSIX files, checks them against `SHA256SUMS` and the tag's version, and uploads them with `vsce publish` and `ovsx publish`, each job holding one token from its own environment, on GitHub-hosted runners. Pre-releases never go to the registries: both take only `X.Y.Z`, and a release candidate's VSIX already carries the final version.
- **The extension's Node server is gone,** with its tests, its fallow zone and the CLI test that compared its file walk with the CLI's. The extension depends on `vscode-languageclient` alone.

**Consequences.**

- :material-plus-circle-outline: An install from the Marketplace or Open VSX works with nothing else installed and no network at start-up, and the server is always the extension's own version.
- :material-plus-circle-outline: The extension carries no download or checksum code. The bundled binary is the release binary: `cd.yml`'s verify matrix compares the two byte for byte on each OS and runs the bundled one, and `SHA256SUMS` covers every VSIX.
- :material-plus-circle-outline: VS Code, Neovim and Helix run the same server, so the old server's limits (the first workspace folder's config only, INW007 and INW008 alone for unopened files) are gone.
- :material-minus-circle-outline: A platform VSIX is about 27 MB (a 65 MB binary, compressed), against 139 KB for the client alone, and each release carries seven VSIX files, about 165 MB.
- :material-minus-circle-outline: The bundled binary follows the extension's version. A project that pins another version with `uv add --dev inwards` sets `inwards.path` to its virtualenv's binary.
- :material-minus-circle-outline: The Windows rules for paths (`.exe`, backslashes, spaces, quoted `PATH` entries) are unit-tested with Windows path semantics on any OS; the extension itself hasn't started on Windows yet, so the full test matrix and a manual install run before the first release.
- :material-minus-circle-outline: The Marketplace upload uses a personal access token, and Azure DevOps retires global tokens on 1 December 2026; switching to Microsoft Entra ID (`vsce publish --azure-credential`) is follow-up work.

**Alternatives.**

- *Download the binary at first start from the GitHub Release that matches the extension's version, checked against `SHA256SUMS`:* one small VSIX, but a private repository's assets need a token, every first start needs the network (proxies, offline machines), and the extension would carry download, checksum and storage code. The checksums would also come from the same place as the binary.
- *One VSIX with all six binaries:* every user downloads about 160 MB to use one of them.
- *Only `inwards` from `PATH` or the project's virtualenv:* the extension would do nothing after install until the user also installs the binary. It stays as the fallback.
- *Keep the Node server as a fallback:* two servers that disagree, which is what ADR-041 set out to end.

## ADR-044: Copilot through an `inwards hook copilot` entry point and a committed hooks file

**Status:** Proposed · 2026-10-11 · [#316](https://github.com/SirCypkowskyy/inwards/issues/316) · waits for the owner's acceptance and for the payloads [#320](https://github.com/SirCypkowskyy/inwards/issues/320) records

**Context.** The [Copilot guide](guides/copilot.md) wires Copilot to Inwards through `AGENTS.md`, the editor extension, `inwards mcp` and CI, so Copilot gets no config guard and no Stop gate. Copilot now runs agent hooks on four surfaces. What follows comes from the docs read on 2026-10-11: GitHub's [hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference), [About hooks](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-hooks), [Using hooks with the Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks) and [Customize the cloud agent with hooks](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/use-hooks) (none of the four shows a date), and VS Code's [hooks guide](https://code.visualstudio.com/docs/agent-customization/hooks) and [hooks reference](https://code.visualstudio.com/docs/agents/reference/hooks-reference) (both dated 2026-10-07). No Copilot session ran: neither the Copilot CLI nor VS Code is installed on the machine the spike ran on, and nothing was signed in to.

| | Copilot CLI | Cloud agent | VS Code, Copilot harness | VS Code, Local harness (preview) |
|---|---|---|---|---|
| Hook files | `.github/hooks/*.json`, `.github/copilot/settings*.json`, `.claude/settings*.json`, `~/.copilot/hooks/`, policy directories, plugins; every entry runs | `.github/hooks/*.json` on the default branch only; only the `bash` command runs | Copilot's own implementation (the Copilot SDK), Copilot's format | `.github/hooks/*.json` (Copilot files mapped), `~/.copilot/hooks/`, `.claude/settings*.json` with `chat.useClaudeHooks` (matchers ignored), custom agents' front matter; workspace trust applies |
| Payload | camelCase (`sessionId`, `toolName`, `toolArgs`) with Copilot's tool names (`edit`, `create`, `bash`, `apply_patch`); a PascalCase event key switches to snake_case with Claude's tool names | as the CLI | as the CLI | snake_case with `hook_event_name`, `tool_name`, `tool_input`; the Local tool names aren't documented |
| Deny an edit | `permissionDecision: "deny"`, or exit 2; another non-zero exit denies too (fail-closed); a timeout allows (fail-open, 30 s default) | as the CLI; `ask` becomes `deny` | as the CLI | `hookSpecificOutput.permissionDecision`, or exit 2 with the reason on stderr |
| After an edit | `additionalContext` appended to the tool result, at most 10 KB; no block | as the CLI | as the CLI | `additionalContext`, or `decision: "block"` |
| End of a turn | `agentStop`: `decision: "block"` and `reason` start another turn; `stop_hook_active` is set; the CLI ends the turn after 8 blocks in a row | as the CLI; a block counts against the job's timeout | as the CLI | `Stop`: `decision: "block"` and `reason`, or exit 2 |
| Session start | `sessionStart`, `additionalContext` only, `source` is `startup`, `resume` or `new` | once per job | as the CLI | `SessionStart`, `source` always `new` |

So every surface can deny a tool call and keep a turn going, which is what the config guard and the Stop gate need. Two things the docs leave out decide the details: the argument names of `edit`, `create` and `apply_patch` (and whether `toolArgs` arrives as an object or as a JSON string; the CLI how-to shows a string), and the Local harness's tool names.

`inwards hook claude-code` can't serve these surfaces as it is, even where Copilot reads Claude Code's files. The Copilot CLI reads `.claude/settings.local.json`, which `inwards init --agent claude-code` writes, so it already runs the hook in a project wired for Claude Code. There the hook misbehaves in three ways:

- the Stop gate and the per-edit check answer with exit 2 and stderr, which Copilot treats as a warning shown to the user, so the turn ends and the model never sees the finding;
- the reference documents flat outputs only, so a deny wrapped in `hookSpecificOutput` may be ignored;
- the config guard reads `tool_input.file_path` and lets a call through when it isn't there (`config-guard.ts`), so if Copilot's `edit` names its file `path`, a `[tool.inwards]` edit passes unchecked.

In VS Code's Local harness the exit codes mean what they mean to Claude Code, but the tool names differ, so the guard sees calls it doesn't recognise and lets them through.

**Decision (proposed).**

- **Record first.** A logging hook on each of the four surfaces records `sessionStart`, `preToolUse` and `postToolUse` for `edit`, `create`, `bash` and `apply_patch`, and `agentStop`, and the recordings become test fixtures ([#320](https://github.com/SirCypkowskyy/inwards/issues/320)). The Claude Code adapter was built the same way, against recorded payloads.
- **One entry point for Copilot's dialects, in the CLI.** `inwards hook copilot` ([#321](https://github.com/SirCypkowskyy/inwards/issues/321)) reads the camelCase payload, the PascalCase one and the Local harness's, telling them apart by the payload: only the snake_case ones carry `hook_event_name`. Copilot's PascalCase variant and the Local harness's payload look alike, and #320 finds what tells them apart. Until then the hooks file uses camelCase event names, so Copilot sends camelCase and only the Local harness sends snake_case. It turns each into the call the handlers take now (Claude's tool names and argument names) and answers in the caller's dialect: a deny as exit 2 with `permissionDecision` on stdout and the reason on stderr, which both Copilot and the Local harness read as a deny; a finding after an edit as `additionalContext`; a Stop gate block as `decision: "block"` with the gate's reasons, or exit 2 and stderr for the Local harness. The handlers keep their policy and return their answer instead of printing it, and each host's entry point prints it.
- **A committed hooks file.** `inwards init --agent copilot` ([#322](https://github.com/SirCypkowskyy/inwards/issues/322)) writes `.github/hooks/inwards.json` in Copilot's camelCase format, with `bash` and `powershell` commands, `timeoutSec: 60` and `INWARDS_HOOK_HOST=copilot` in `env`. The cloud agent reads only committed files on the default branch, so this file holds no machine's path: it starts `inwards` from `PATH`, or the launcher `--launcher` names (`uv run`). The cloud agent gets Inwards from `copilot-setup-steps.yml`, as the guide shows. A tool the adapter doesn't recognise passes, as in Claude Code.
- **The Stop gate checks the hooks file** when `INWARDS_HOOK_HOST=copilot`: the gate blocks when `.github/hooks/inwards.json` is gone or no longer runs `inwards hook copilot` for the four events, as it does for OpenCode's plugin.
- **What the guard can't read, the adapter refuses.** An `apply_patch` call that touches `pyproject.toml`, `.github/hooks/`, `.inwards/` or the baseline is denied, as the OpenCode plugin does, because the guard judges an edit by its old and new text.
- **`inwards hook claude-code` stops pretending under Copilot** ([#323](https://github.com/SirCypkowskyy/inwards/issues/323)): when a recorded Copilot payload shows the caller isn't Claude Code, it passes and says once, at session start, to run `inwards init --agent copilot`, so a project wired for both doesn't run two hooks with one of them half working.

**Consequences.**

- :material-plus-circle-outline: The per-edit check, the config guard and the Stop gate reach the Copilot CLI and the cloud agent with the one implementation the Claude Code and OpenCode hooks use. Unlike OpenCode, Copilot can refuse the end of a turn, so the Stop gate keeps the agent working as it does on Claude Code, in a non-interactive run too.
- :material-plus-circle-outline: One committed file serves the cloud agent, every contributor's Copilot CLI and both VS Code harnesses.
- :material-minus-circle-outline: The file runs on every contributor's machine. Where `inwards` isn't installed, the shell exits 127, and Copilot denies every tool call (fail-closed). The command checks for the binary first and passes when it's missing, so the guard is gone on that machine, and CI stays the gate there.
- :material-minus-circle-outline: A timeout lets the call through. The default is 30 s; the file sets 60 s, as on OpenCode, and the hook daemon ([ADR-039](#adr-039-a-hook-daemon-per-project-separate-from-the-language-server)) keeps a warm per-edit check well under it.
- :material-minus-circle-outline: Copilot can't block after an edit. A violation goes back as context on the tool result, at most 10 KB, so a long report is cut to the first findings and a pointer to `inwards check`.
- :material-minus-circle-outline: On the cloud agent a Stop gate block spends the job's time, and `sessionStart` fires once per job, so the session record covers the whole job. The CLI's limit of 8 blocks in a row ends a turn that `escalate-after` hasn't ended first.
- :material-minus-circle-outline: VS Code's hooks are in preview and the Local harness's tool names are undocumented. Until #320 records them, the Local harness gets the per-edit check only for the tool names it records, and CI stays the gate.
- :material-minus-circle-outline: A second payload contract to keep, in three dialects, against an API that changed between the Copilot CLI's [general availability](https://github.blog/changelog/2026-02-25-github-copilot-cli-is-now-generally-available/) (2026-02-25, `preToolUse` and `postToolUse` only) and the reference of October 2026.

**Alternatives.**

- *Keep `AGENTS.md`, `inwards mcp` and CI only:* nothing to build, but no guard and no gate, on the surfaces that now can have both. It stays the setup for Copilot surfaces without hooks.
- *Rely on Copilot reading Claude Code's settings:* no new code, but the exit codes mean something else, the outputs may be ignored, the cloud agent doesn't read `.claude/`, and the guard would let edits through without a sign.
- *A shell script that translates Copilot's payloads into Claude Code's and runs `inwards hook claude-code`, as the OpenCode plugin does ([ADR-033](#adr-033-opencode-through-a-plugin-that-runs-the-claude-code-hook)):* the translation would need `jq` or PowerShell on every machine, and the answers would still need translating back. OpenCode had a JavaScript runtime for it; a Copilot hook is a plain command.
- *Hooks with PascalCase event names, so Copilot sends Claude's tool names:* closer to what the handlers read, but the docs don't say the arguments are renamed too, and the cloud agent's docs show only camelCase. #320 decides whether this is simpler.
- *HTTP hooks to the hook daemon:* no process per event, but `preToolUse` needs `https`, a local `http` URL needs `COPILOT_HOOK_ALLOW_LOCALHOST=1` on every machine, and the cloud agent has no daemon to talk to.
