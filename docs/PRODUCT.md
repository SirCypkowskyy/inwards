# Product

<!-- impeccable:product-schema 1 -->

Product record for the Inwards docs site (issue #177). It holds product
truth only; the visual system lives in `docs/DESIGN.md`. Facts marked
"inferred" come from the repository and the issue, not from an interview:
the owner delegated the design decisions on 2026-09-29.

## Platform

web

## Users

Python backend teams whose code has a declared shape (layered, Clean
Architecture, hexagonal / ports and adapters, DDD bounded contexts) and who
let AI coding agents (Claude Code, Codex, Cursor, Aider, OpenCode, Copilot)
write a large share of that code. The reader is usually the engineer who
owns the architecture and sets up the agent's tooling: they arrive from a
link, a search or a package page, decide within a minute whether Inwards is
worth trying, and later come back to look up a rule (`rules/INWxxx/` is
printed in every diagnostic) or a setup guide.

A second audience is the agent itself: diagnostics link to the rule pages,
and agents read them.

## Product Purpose

Inwards is an architecture linter for Python. Layers are declared in
`[tool.inwards]` in `pyproject.toml`; `inwards check` fails when an import
points the wrong way and prints numbered fix steps written for the agent
that probably wrote the import. `inwards init --agent claude` puts the check
into the agent loop as hooks. Success: an agent that breaks a layer boundary
is told within one edit, fixes it, and cannot talk its way around the rule.

## Positioning

Fast enough to run after every single edit an agent makes (the hook budget
is p95 under 100 ms per file, process start included), and built against
the ways agents dodge a check: imports moved into a function or behind
`TYPE_CHECKING`, dynamic imports (INW011), hallucinated first-party modules
(INW010), suppressions without a reason (INW009), edits to the rules
themselves (config guard), and giving up mid-turn (Stop gate over every file
the session changed). import-linter checks contracts; it has no agent loop
and no fix steps. Chapter 2 names speed as the moat against import-linter.

## Operating Context

- Install: `uv add --dev inwards` or `pip install inwards` (on PyPI since
  0.2.0, 2026-09-26; the latest is 0.5.0, 2026-10-10), `uvx inwards` with
  no project, or a binary from GitHub Releases. The repository is public.
- Setup: `inwards init --agent claude|opencode|aider|agents-md`; on a new
  project `uvx inwards init --style <preset> --scaffold`
  (`inwards init --list-styles` names the presets).
- Daily use: the PostToolUse hook runs `inwards check <file>` after each
  edit; the Stop gate checks the session's changes; CI runs `inwards check`.
- Docs are read on desktop next to an editor and a terminal, and on a phone
  from a link. Both English and Polish are published (`/` and `/pl/`).

## Capabilities and Constraints

- Rules INW000 to INW017 and FAPI001 to FAPI009 (FAPI004 is unused), each
  with a page at `rules/<CODE>/`. Those URLs are printed by the CLI and are a contract.
- The docs site is Zensical (0.0.65), extended only through `custom_dir`
  overrides, `extra_css` and `extra_javascript`; no JS framework, no build
  step beyond Zensical.
- Pre-alpha. The status line on the home page names the latest release.

## Brand Commitments

- The name is **Inwards**, one word, capital I; the command is `inwards`.
- Voice (AGENTS.md "Writing"): plain and specific, numbers over adjectives,
  no filler, no em dashes, no hype. Polish copy follows
  `docs/GLOSSARY.pl.md`.
- The tagline to start from: "Architecture rules for Python, fast enough to
  run after every edit an AI agent makes."
- No existing logo; the old header used the stock `material/layers-triple`
  icon (inferred: not a brand asset).

## Evidence on Hand

- Real terminal runs, rendered to SVG: `docs/chapters/assets/screens/`
  (`check-violation.svg`, `check-clean.svg`, `claude-code-hook.svg`,
  `json-for-agents.svg`, `benchmark.svg`, `prescan-diff.svg`,
  `bun-test.svg`).
- A real `inwards check` run of 0.4.0 on the scaffold's example app with
  one bad import added (recorded 2026-09-29, quoted on the home page).
- Measured numbers in `docs/chapters/06-Constraints-and-Quality.md`: the
  one-file check against the 100 ms p95 budget, cold full checks (2,100
  files / 496,000 lines in about 0.4 s; saleor's 848,000 lines in about
  1.8 s on one core), and 0 prescan-missed imports across 6,543 files of
  five open-source services. Measured 2026-09-26.
- The real-repo corpus: `bench/corpus.json`, five pinned open-source
  services.
- The agent eval: `eval/README.md` and chapter 2's "First data" (22 runs).

**Absent, so never invent them:** testimonials, quotes, customers, logos of
companies using Inwards, download counts, stars, and any benchmark against
import-linter, Tach or other tools (none has been measured). No machine
names or hardware models in published docs (issue #177, part C).

## Product Principles

1. Show the mechanism, not a claim: a real bad import and the real output.
2. Every number links to where it was measured.
3. The rule pages are a reference an agent and a person both read; they
   stay fast, stable and plain.
4. English and Polish are equal: layouts never depend on string length.

## Accessibility & Inclusion

WCAG 2.2 AA in both colour schemes: 4.5:1 for body text and code tokens,
3:1 for large text, UI components and focus indicators; keyboard operable;
`prefers-reduced-motion` respected; no horizontal page scroll at 320 px or
200% zoom; correct `lang` on both sites.
