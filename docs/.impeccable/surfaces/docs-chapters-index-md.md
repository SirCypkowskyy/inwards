---
version: 1
slug: "docs-chapters-index-md"
primary_target: "docs/chapters/index.md"
related_targets: ["docs/pl/index.md"]
---

## Scope

The docs home page, `docs/chapters/index.md` and its Polish mirror `docs/pl/index.md`, rendered through `docs/overrides/home.html`. Visitor mode: **persuade**. Every other docs page is a read surface and inherits the site identity only.

## Audience, job, action

A Python engineer who owns a layered, clean, hexagonal or DDD codebase and lets AI agents write much of it. Job: decide within one screen whether Inwards is worth trying. Action: Get started (install guide) or Browse the rules.

## Proof and content

Real runs only: the `inwards check` run of 0.4.0 on the scaffold with one bad import (2026-09-29), the concise run of three dodges, the generated `[tool.inwards]` table, and chapter 6's numbers (2026-09-26) with links to their rows. No testimonials, customers or tool comparisons (see PRODUCT.md).

## Constraints

At most 250 words of English prose, at most 5 sections below the hero, copy in index.md so Polish translates it, no layout that depends on string length, motion only in the agent-loop diagram, and at most 5 KB of new JS (none added).

## Direction contract

THESIS: The home page is a code review of one agent edit: a comment anchored to the exact line and column that broke the architecture, with the fix steps under it. It refuses the dev-tool default of a dark hero, a slogan and a terminal screenshot beside it.
OWN-WORLD: White paper and slate ink (dark: slate paper, pale ink), one cyan-blue Hunk accent for links, the current nav item, focus and primary actions. Red and green are diff law: red marks a violation, green a pass, never decoration. Atkinson Hyperlegible Next for text, Atkinson Hyperlegible Mono for code. Gutters with real line numbers, 1px rules, 6px radii, no cards, no shadow outside the header and floating menus.
STORY: A Python engineer sees an agent's bad import flagged at 6:50 with four fix steps, believes the check is fast (chapter 6's numbers against the 100 ms budget) and hard to dodge (real INW010, INW001 and INW011 lines), and copies three commands.
FIRST VIEWPORT: Left-aligned. The 15-word value proposition as the h1 at display size ("Inwards" kept for screen readers), one supporting sentence, Get started (filled Hunk) and Browse the rules (outlined) side by side. Below them at full content width, the review pane: a path bar, lines 3 to 6 of shop/domain/order.py with line 6 in the Removed tint and column 50 underlined, then the real `inwards check` output. At 390 px the pane starts at line 5 and the first diagnostic line is above the fold.
FORM: Unified diff and code review, candidate 6 of 7 on the grounded list; seed key 23558c32. Signature motion: the agent-loop diagram plays one review cycle (edit, check, violation, check, clean) once, and stops under reduced motion.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Memorable moment

The flagged line 6 in the Removed tint, its imported name underlined at the reported column, with the real diagnostic directly under it.

## Unresolved

The status line names 0.4.0 by hand; it goes stale at the next release. The owner confirms the nav grouping (Guides, Rules, How it works, Project).
