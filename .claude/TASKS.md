# Stratum: bootstrap tasks

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

## Phase 1: Research and hypothesis
- [x] Competitor research (Ruff, ty, Biome, pytest-archon, React Doctor, import-linter, Tach) via background agent
- [x] Business and technical hypothesis (in `02-Business-Context.md`, with metrics and kill criteria)

## Phase 2: Monorepo scaffold and CI/CD
- [x] Root: `pyproject.toml`, `package.json` (Bun workspaces), `tsconfig.base.json`, `biome.json`, `.gitignore`, `README.md`
- [x] `src/core/`: engine package (tree-sitter import extraction, layer rule, diagnostics)
- [x] `src/cli/`: `stratum check` entry point
- [x] `src/vscode-extension/`: LSP client/server stub sharing core
- [x] `.github/workflows/ci.yml`: lint, typecheck, tests, docs build
- [x] `.github/workflows/cd.yml`: on `v*` tag, Bun cross-compile binaries, upload as GitHub Artifacts
- [x] `.github/workflows/docs.yml`: Zensical build, deploy to Cloudflare Workers (static assets)
- [x] `docs/zensical.toml`, `docs/wrangler.jsonc`

## Phase 3 + 4: Chapters (draft, then Astra review, then fixes)
| Chapter | Draft | Astra review | Fixes applied |
|---|---|---|---|
| `index.md` | [x] | [x] | [x] |
| `01-Introduction.md` | [x] | [x] | [x] |
| `02-Business-Context.md` | [x] | [x] | [x] |
| `03-Architecture-C4.md` | [x] | [x] | [x] |
| `04-AI-Integration.md` | [x] | [x] | [x] |
| `05-ADR.md` | [x] | [x] | [x] |
| `06-Constraints-and-Quality.md` | [x] | [x] | [x] |
| `07-Glossary.md` | [x] | [x] | [x] |

## Verification
- [x] Mermaid diagrams validated (19/19 via Mermaid Chart; one reserved-id bug fixed)
- [x] `zensical build --strict` passes; all cross-chapter anchors resolve; icons render
- [x] Workflow YAML parses
- [x] Engine tests pass locally (13/13, Bun 1.4.2 from scratchpad)
- [x] Typecheck (tsc 7) and Biome clean
- [x] Linux binary compiled, WASM embedding verified, benchmarked (see 06 chapter)
- [x] .vsix packages
- [x] Prescan differential test: CPython 3.14 stdlib, 1,921 files, 0 missed (now a CI step)
- [x] Full CI engine job reproduced locally, all green

## Round 2 (user feedback 2026-09-25)
- [x] MIT license (LICENSE, pyproject, package.json files, .vsix)
- [x] Bun 1.4.2 installed globally (~/.bun, PATH added to ~/.zshrc)
- [x] Coloured CLI output (TTY / FORCE_COLOR / NO_COLOR) + tests
- [x] Console screenshots: scripts/screenshots.py -> docs/chapters/assets/screens/*.svg, embedded in 5 chapters
- [x] Private repo SirCypkowskyy/stratum, secrets set, pushed; CI green
- [!] Docs deploy: token from ~/qv-cloudflare.env is Tunnel-scoped, Cloudflare answers "No access" on Workers deploy
- [!] Update DOCS_BASE to the real workers.dev URL (needs a working token), then regenerate screenshots

## Blocked on the user
- Cloudflare API token with Account > Workers Scripts > Edit (template "Edit Cloudflare Workers"); then DOCS_BASE in src/core/src/meta.ts
- Name decision (see recommendation in chat)
- Design partners for the business-hypothesis metrics
