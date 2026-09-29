---
name: Inwards docs
description: Architecture rules for Python, documented as a code review on white paper with one cyan-blue accent.
colors:
  hunk: "rgb(11 103 132)"
  hunk-dark: "rgb(94 194 223)"
  hunk-strong: "rgb(8 78 101)"
  hunk-strong-dark: "rgb(147 216 236)"
  on-hunk: "rgb(255 255 255)"
  on-hunk-dark: "rgb(12 26 32)"
  paper: "rgb(255 255 255)"
  paper-dark: "rgb(21 25 30)"
  paper-2: "rgb(243 245 247)"
  paper-2-dark: "rgb(28 33 39)"
  ink: "rgb(27 34 41)"
  ink-dark: "rgb(226 230 234)"
  graphite: "rgb(86 97 108)"
  graphite-dark: "rgb(155 166 177)"
  rule: "rgb(223 227 232)"
  rule-dark: "rgb(46 53 61)"
  removed: "rgb(179 38 30)"
  removed-dark: "rgb(255 139 128)"
  removed-tint: "rgb(253 236 235)"
  removed-tint-dark: "rgb(58 31 34)"
  added: "rgb(29 122 62)"
  added-dark: "rgb(108 212 143)"
  added-tint: "rgb(232 245 236)"
  added-tint-dark: "rgb(23 48 37)"
typography:
  display:
    fontFamily: "Atkinson Hyperlegible Next, Inwards Text Fallback, system-ui, sans-serif"
    fontSize: "clamp(1.55rem, 1rem + 3.2vw, 3.2rem)"
    fontWeight: 800
    lineHeight: 1.06
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Atkinson Hyperlegible Next, Inwards Text Fallback, system-ui, sans-serif"
    fontSize: "1.469rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  headline-sm:
    fontFamily: "Atkinson Hyperlegible Next, Inwards Text Fallback, system-ui, sans-serif"
    fontSize: "1.224rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Atkinson Hyperlegible Next, Inwards Text Fallback, system-ui, sans-serif"
    fontSize: "1.02rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Atkinson Hyperlegible Next, Inwards Text Fallback, system-ui, sans-serif"
    fontSize: "0.85rem"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "0"
    fontFeature: "\"kern\""
  body-sm:
    fontFamily: "Atkinson Hyperlegible Next, Inwards Text Fallback, system-ui, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 400
  label:
    fontFamily: "Atkinson Hyperlegible Next, Inwards Text Fallback, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0"
  code:
    fontFamily: "Atkinson Hyperlegible Mono, Inwards Code Fallback, ui-monospace, monospace"
    fontSize: "0.748rem"
    fontWeight: 400
    lineHeight: 1.55
rounded:
  hairline: "2px"
  sm: "4px"
  md: "6px"
  full: "50%"
spacing:
  xs: "0.4rem"
  sm: "0.6rem"
  md: "1.4rem"
  lg: "2rem"
  section-mobile: "3rem"
  section: "4.5rem"
components:
  button-primary:
    backgroundColor: "{colors.hunk}"
    textColor: "{colors.on-hunk}"
    rounded: "{rounded.md}"
    padding: "0.55em 1.3em"
  button-primary-hover:
    backgroundColor: "{colors.hunk-strong}"
    textColor: "{colors.on-hunk}"
  button-primary-dark:
    backgroundColor: "{colors.hunk-dark}"
    textColor: "{colors.on-hunk-dark}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.55em 1.3em"
  button-outline-hover:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
  admonition:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
  admonition-dark:
    backgroundColor: "{colors.paper-2-dark}"
    textColor: "{colors.ink-dark}"
  tab-label:
    textColor: "{colors.graphite}"
    typography: "{typography.body-sm}"
  tab-label-hover:
    textColor: "{colors.ink}"
  tab-label-active:
    textColor: "{colors.hunk}"
  table:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "0.6em 1em"
  table-header:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
  code-block:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    typography: "{typography.code}"
    rounded: "{rounded.md}"
  code-block-dark:
    backgroundColor: "{colors.paper-2-dark}"
    textColor: "{colors.ink-dark}"
  code-inline:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    typography: "{typography.code}"
    rounded: "{rounded.sm}"
  nav-item:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
  nav-item-active:
    backgroundColor: "rgb(11 103 132 / 10%)"
    textColor: "{colors.hunk}"
  nav-tab:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.graphite}"
    typography: "{typography.label}"
  nav-tab-hover:
    textColor: "{colors.ink}"
  nav-tab-active:
    textColor: "{colors.hunk}"
---

# Design System: Inwards docs

## Overview

**Creative North Star: "The Code Review"**

The site reads like a review of one agent edit: white paper, slate ink, a gutter of real line numbers, 1px rules and one cyan-blue accent that marks where to look. Red and green keep the meaning they have in a diff. Nothing on the page is decoration that a reviewer would not see in a pull request.

Two modes share one identity. The home page (`docs/chapters/index.md` through `overrides/home.html`) is in **persuade mode**: a display-size value proposition, two actions, then the review pane that shows a real `inwards check` run against a flagged line. Every other page is in **read mode**: a 17px body at about 72 characters a line, headings on a 1.2 ratio, code and tables at full column width, and colour only where it carries a state. Density is that of a reference manual: an engineer comes back to `rules/INWxxx/` from a diagnostic and has to find the fix in seconds.

The system was built against these anti-references, and each stays out:

- stock Material or Zensical deep purple, amber and Inter;
- warm cream paper with a serif and a terracotta accent;
- near-black with one neon accent;
- purple-to-blue gradients, or gradient text;
- glassmorphism as decoration;
- a grid of same-size cards, each an icon, a heading and a line of text;
- the big-number three-stats hero;
- ALL-CAPS eyebrow labels over headings;
- section numbers that are not a sequence;
- monospace as costume, on text that is not code, a path or a command;
- hard offset shadows;
- arrows appended to every link.

**Key Characteristics:**

- One accent (Hunk) for links, the current nav item, focus and the primary action; nothing else is coloured for emphasis.
- Red (Removed) and green (Added) are diff law: violations and passes, never decoration.
- Flat surfaces separated by 1px rules and a second paper tone; the only soft shadow belongs to the header and floating panels.
- One type family in two cuts: Atkinson Hyperlegible Next for text and display, Atkinson Hyperlegible Mono for code.
- 6px corners on every block, 4px on inline code and keys.
- Motion only where it explains the product: the agent-loop diagram plays one cycle once.

## Colors

A cool, near-neutral slate palette on white (dark: slate paper, pale ink) with one cyan-blue accent and a red and green that belong to diffs. Six named colours, each with a light and a dark value; every other value is a written-out tone of them, not a mix, so every contrast ratio below is exact. `docs/chapters/stylesheets/theme.css` is the source and writes them as `rgb()`; the front matter mirrors it. The hex values in the tables are the same colours.

### Primary

- **Hunk** (light `#0b6784`, dark `#5ec2df`): the one accent, named for a diff hunk. Links, the current sidebar item and top tab, the focus ring, the primary button fill, the active content-tab indicator, text caret, keyword and number tokens in code, the Inwards node in diagrams and the bars of the home page chart. Selection is Hunk at 28% alpha, `<mark>` at 22%, the current nav item's tint at 10%.
- **Hunk strong** (light `#084e65`, dark `#93d8ec`): hover and focus state of links and the primary button. Never a resting colour.
- **On Hunk** (light `#ffffff`, dark `#0c1a20`): text and marks placed on a Hunk fill.

### Semantic (diff law)

- **Removed** (light `#b3261e`, dark `#ff8b80`): a violation. The flagged line number and wavy underline in the review pane, the rule code in quoted output, deleted lines in diffs, the violation edge of the agent loop, and the icon of danger, failure and bug admonitions.
- **Removed tint** (light `#fdeceb`, dark `#3a1f22`): background of a flagged line and of `<del>` and diff-deleted lines.
- **Added** (light `#1d7a3e`, dark `#6cd48f`): a pass. The clean edge and end node of the agent loop, strings in code, inserted diff lines, and the icon of tip and success admonitions.
- **Added tint** (light `#e8f5ec`, dark `#173025`): background of `<ins>` and diff-inserted lines.

### Neutral

- **Paper** (light `#ffffff`, dark `#15191e`): page, header, tabs bar, footer, buttons at rest, tooltip and menu surfaces.
- **Paper 2** (light `#f3f5f7`, dark `#1c2127`): the second surface. Code blocks, admonitions, table headers, the review pane's path bar, diagram nodes, footer meta row, outline-button hover.
- **Ink** (light `#1b2229`, dark `#e2e6ea`): body text, headings in both schemes, code identifiers, diagram labels.
- **Graphite** (light `#56616c`, dark `#9ba6b1`): secondary text (captions, line numbers, tab labels at rest, copyright), the outline-button border, comments, operators and punctuation in code, diagram edges.
- **Rule** (light `#dfe3e8`, dark `#2e353d`): every hairline. Header and tab-bar bottom edges, block borders, table borders, the gutter divider, section dividers on the home page, the track of the home chart.

### The `--md-*` mapping

Zensical is themed only through its custom properties; both schemes share one mapping and only the `--inw-*` tokens change. `theme.palette` sets `primary = "custom"` and `accent = "custom"` in both configs so the theme's named palettes never load.

| Zensical property | Token |
|---|---|
| `--md-default-fg-color` / `--light` | Ink / Graphite |
| `--md-default-fg-color--lighter` / `--lightest` | Graphite at 55% / 14% |
| `--md-default-bg-color` | Paper (with 92%, 30%, 12% alpha steps) |
| `--md-primary-fg-color`, `--md-accent-fg-color` | Hunk |
| `--md-primary-fg-color--light` / `--dark` | Hunk strong |
| `--md-primary-bg-color`, `--md-accent-bg-color` | On Hunk |
| `--md-accent-fg-color--transparent` | Hunk at 10% |
| `--md-typeset-color`, `--md-typeset-a-color` | Ink, Hunk |
| `--md-typeset-mark-color` | Hunk at 22% |
| `--md-typeset-del-color` / `--ins-color` | Removed tint / Added tint |
| `--md-typeset-table-color` | Rule |
| `--md-admonition-*`, `--md-warning-*` | Ink on Paper 2 |
| `--md-footer-*` | Ink, Graphite, Paper 2 |
| `--md-code-fg-color` / `--bg-color` | Ink / Paper 2 |
| `--md-code-hl-keyword`, `constant`, `number`, `special` | Hunk |
| `--md-code-hl-string-color` | Added |
| `--md-code-hl-function`, `name`, `variable` | Ink |
| `--md-code-hl-operator`, `punctuation`, `comment`, `generic` | Graphite |
| `--md-mermaid-edge-color` | Graphite |
| `--md-mermaid-node-bg` / `-fg-color` | Paper 2 / Ink |
| `--md-mermaid-label-bg` / `-fg-color` | Paper / Ink |
| `--md-shadow-z1` to `z3` | Ink at 8%, 12%, 16% |
| `--color-foreground`, `--color-background`, `--color-background-subtle`, `--color-backdrop` | RGB triplets of Ink, Paper, Paper 2, Paper (the modern variant's search and dialogs) |

### Contrast

Measured WCAG ratios, light / dark. Body text and code tokens need 4.5:1; large text, UI parts and focus indicators 3:1.

| Pair | Light | Dark |
|---|---|---|
| Ink on Paper (body) | 16.06 | 14.07 |
| Ink on Paper 2 (code, admonitions, diagram nodes) | 14.70 | 12.91 |
| Graphite on Paper (secondary text) | 6.32 | 7.13 |
| Hunk on Paper (links, focus ring) | 6.39 | 8.62 |
| Hunk strong on Paper (hover) | 9.18 | 11.16 |
| Hunk on Paper 2 (keywords, numbers) | 5.84 | 7.91 |
| Added on Paper 2 (strings) | 4.92 | 8.83 |
| Graphite on Paper 2 (comments) | 5.78 | 6.54 |
| On Hunk on Hunk (primary button, Inwards diagram node) | 6.39 | 8.66 |
| Removed on Removed tint | 5.72 | 6.62 |
| Added on Added tint | 4.79 | 7.71 |
| Graphite outline-button border on Paper | 6.32 | 7.13 |
| Chapter 6 pie title `#6b7580` on Paper (large text) | 4.69 | 3.77 |

### Named Rules

**The One Accent Rule.** Hunk is the only colour that means "look here or act here". If a new element wants attention and is not a link, the current location, focus or the primary action, it stays ink.

**The Diff Law Rule.** Removed means a violation and Added means a pass. Neither appears as a brand colour, a highlight or a decorative fill, and a red or green element must be explainable as one or the other.

**The Written-Out Tone Rule.** A new tone is added to `theme.css` as a literal value in both schemes with its contrast ratio recorded here, never as a runtime `color-mix()` of text that needs to pass contrast. Alpha mixes are for tints behind ink only.

## Typography

**Display Font:** Atkinson Hyperlegible Next, weight 800 (with "Inwards Text Fallback", then system-ui)
**Body Font:** Atkinson Hyperlegible Next (with "Inwards Text Fallback", then system-ui)
**Label/Mono Font:** Atkinson Hyperlegible Mono (with "Inwards Code Fallback", then ui-monospace)

**Character:** One legibility-first family from the Braille Institute in two cuts. The text face tells I, l and 1 apart and the mono face slashes its zero, which is what a rule code such as INW001 or a module path needs.

### Faces, licence and files

Both faces are SIL OFL 1.1 (licences in `docs/chapters/assets/fonts/`), taken from the google/fonts variable TTFs (weight axis 200 to 800) and subset with `pyftsubset` to Latin-1, Latin Extended-A and general punctuation. Polish ą ć ę ł ń ó ś ź ż, upper and lower case, are covered and were checked with fontTools. One WOFF2 per style, so a Polish page costs the same requests as an English one:

| File | Size | Loaded |
|---|---|---|
| `atkinson-next-normal.woff2` | 40.8 KB | every page, preloaded in `overrides/main.html` |
| `atkinson-mono-normal.woff2` | 21.3 KB | pages with code (the home page has code) |
| `atkinson-next-italic.woff2` | 44.8 KB | only where italic text appears; the home page has none |

`theme.font = false` in both configs, so the theme makes no Google Fonts request. The `@font-face` rules and two metric-matched fallbacks live in `theme.css`: "Inwards Text Fallback" is Arial, Helvetica or Liberation Sans at `size-adjust: 100%`, and "Inwards Code Fallback" is Courier New or Liberation Mono at `size-adjust: 105.3%`, both with ascent and descent overrides from the web fonts' metrics (984 and 316 per 1000), so the swap does not shift the layout. The English home page weighs 162.6 KB compressed, of which fonts are 60.7 KB in 2 files, with no third-party requests.

### Hierarchy

The theme's root is 20px, so 1rem = 20px throughout this file.

- **Display** (800, `clamp(1.55rem, 1rem + 3.2vw, 3.2rem)`, 31px to 64px, line-height 1.06, -0.025em): the home page value proposition only, capped at 17em wide and balanced.
- **Headline** (700, 1.728em of body = 29.4px, line-height 1.2, -0.01em): page `h1`.
- **Headline small** (700, 1.44em = 24.5px, line-height 1.3): `h2`, and the premise headings on the home page.
- **Title** (700, 1.2em = 20.4px, line-height 1.3): `h3`. `h4` is body size at 700.
- **Body** (400, 0.85rem = 17px, line-height 1.65, no tracking, kerning on): all prose. Paragraphs, lists, definition lists and blockquotes stop at 34em, about 72 characters; the home page allows 36em. Inside admonitions, details, tabs and table cells the measure is the container's.
- **Body small** (0.8rem = 16px): admonitions, tables and content-tab labels. Tables use tabular figures.
- **Label** (600 to 700, 0.75rem = 15px): sidebar, top tabs; the header title is 0.8rem at 700; the repository name and footer direction labels are 0.65rem = 13px.
- **Code** (Mono, 0.88em of its context, line-height 1.55 in blocks): inline code, blocks, `<kbd>`, and the review pane's file path.

Headings are all weight 700, tracked -0.01em and balanced; they are Ink in both schemes (the theme would paint them white on slate).

### Named Rules

**The 1.2 Ladder Rule.** Heading sizes come from body × 1.2ⁿ (1.2, 1.44, 1.728). The display clamp is the only size outside the ladder, and it belongs to the home page hero.

**The Mono Means Machine Rule.** Monospace sets only what a machine reads or prints: code, commands, file paths, rule codes, keys. Labels, captions and headings stay in the text face.

## Layout

Read pages keep Zensical's own grid: a left sidebar, the content column and a right table of contents, with `navigation.tabs` adding a top tab bar at wide screens and `navigation.sections` grouping the sidebar. The tabs are **Guides**, **Rules**, **How it works** (chapters 4, 3 and 6) and **Project** (chapters 1, 2, 5, 7, 8 and Design partners). Page URLs never change with the grouping: `rules/INWxxx/` is printed by the CLI and is a contract.

Prose sits at 34em inside the column while tables, code and diagrams take the full column width; a page therefore has a ragged right edge by design.

**Home page structure** (`hide: navigation, toc, footer`, content wrapped in `.inw-home`):

1. Hero, left-aligned: the product name as visually hidden text at the start of the `h1` (the header already shows it), the value proposition at display size, one supporting sentence in Graphite at 1.1em, then the two buttons 0.6rem apart.
2. The review pane at full content width, 2rem below the actions.
3. Three premises, each a two-column row (5fr words, 7fr artifact, 2.4rem column gap, 2rem vertical padding) opened by a 1px rule: the TOML config, the agent-loop diagram, the concise output of three dodges.
4. "Fast enough for every edit": a bar chart of three measured p95 times against the 100 ms budget, max 44rem.
5. Quickstart: three numbered steps with uv and pip tabs, max 44rem.
6. Four entry links on one rule in four columns, not cards.
7. A one-line status in Graphite.

Sections 3 to 6 are 4.5rem apart (3rem below 960px).

**Breakpoints.** The home page changes at two of the theme's own breakpoints: below 60em (960px) the premises and the entry links collapse to one column and the section gap drops to 3rem; below 45em (720px) the hero loses its top padding, the supporting sentence drops to body size, and the review pane hides lines 3 and 4 so line 5, the flagged line 6 and the first diagnostic line stay in the first viewport at 390px. Nothing may scroll the page sideways at 320px or 200% zoom; wide diagrams scroll inside their own wrapper.

**Spacing rhythm.** A short set of steps recurs: 0.4rem (grid row gaps), 0.6rem (button gap, table cell padding in em), 1.4rem (actions margin, chart margin, step spacing, entry-row padding), 2rem (premise padding, review-pane margin, entry column gap), 3rem and 4.5rem (home sections).

## Elevation & Depth

The system is flat. Depth comes from the second paper tone and 1px rules, not from shadows. One soft shadow family exists, mapped onto the theme's `--md-shadow-z*` in Ink at 8%, 12% and 16%, and it is used for things that float over content: the header once the page scrolls, and the language menu and tooltips.

### Shadow Vocabulary

- **Header rule** (`box-shadow: 0 1px 0 var(--inw-rule)`): the header's bottom edge at rest; the tab bar uses the same line inset.
- **Header scrolled** (`0 1px 0 var(--inw-rule), 0 0.05rem 0.4rem color-mix(in srgb, var(--inw-ink) 8%, transparent)`): after the page scrolls under it.
- **Floating panel** (`0 0.1rem 0.6rem color-mix(in srgb, var(--inw-ink) 12%, transparent)`): the language menu and tooltips, both on Paper with a 1px Rule border.
- **Keycap** (`0 0 0 1px var(--inw-rule), 0 0.1rem 0 var(--inw-graphite)`): `<kbd>` only, drawing the edge of a physical key. It is the one zero-blur shadow and is not to be reused elsewhere.

`--md-shadow-z3` is mapped only so the theme's own uses stay in palette. Admonitions, tables, code blocks, the review pane and buttons carry no shadow.

### Named Rules

**The Rule Over Shadow Rule.** A new surface is separated by a 1px Rule border or a Paper 2 fill. A shadow is allowed only when the element floats above the page and disappears again (a menu, a tooltip, the scrolled header).

## Shapes

Rectangles with small, even corners and 1px borders. Every block (code block, admonition, details, table, button, review pane, menu, tooltip, diagram node with `rx="6"`) uses 6px. Inline code and keys use 4px, `<mark>` 2px. The only circle is the Hunk-outlined step counter of the home page quickstart, because it numbers a real sequence. There are no coloured side borders, no pills and no cut corners.

The mark (`overrides/partials/logo.html`) is two nested squares, the outer one open on the right where an arrow points in, drawn at a 2px stroke in `currentColor`: a dependency may only point inwards. Beside the site name it forms the wordmark.

## Components

### Buttons

- **Shape:** gently squared (6px), 1px border, 0.55em × 1.3em padding, 0.9em text at 700.
- **Primary:** On Hunk text on a Hunk fill with a Hunk border. One per view, for the action the page exists for (Get started, Home page on the 404).
- **Outline:** Ink text, transparent fill, 1px Graphite border (6.32:1, so the edge itself passes 3:1).
- **Hover / Focus:** primary goes to Hunk strong; outline gains a Paper 2 fill and an Ink border. Colour transitions take 150ms; `:active` moves the button down 1px. The focus ring is the global 2px Hunk outline at a 2px offset.
- **Disabled:** 50% opacity, no pointer events.

### Admonitions and details

Paper 2 with a 1px Rule border all round, 6px corners, no shadow and no coloured side border. The title is weight 700 on a transparent background; the icon alone carries the kind: Hunk for note, info, abstract and question; Added for tip and success; Removed for danger, failure and bug; Graphite for everything else, warnings included. Text is 0.8rem. The deploy's "Tłumaczenie może być nieaktualne" banner is a warning admonition and takes the same shape.

### Content tabs

Labels in 0.8rem at 700, Graphite at rest, Ink on hover (150ms). The active indicator is a Hunk bar. Tabs are linked across the page (`content.tabs.link`), so choosing pip once switches every uv/pip set.

### Tables

A 1px Rule border with 6px corners, header row on Paper 2, cells padded 0.6em × 1em, 0.8rem text with tabular figures.

### Code blocks

Ink on Paper 2 in Atkinson Hyperlegible Mono, 1px Rule border, 6px corners, line-height 1.55. Syntax colours come from the palette only: keywords, constants and numbers in Hunk, strings in Added, names and functions in Ink, comments, operators and punctuation in Graphite. Highlighted lines take Hunk at 12%. Diff lines use Removed on Removed tint and Added on Added tint. `console` blocks show the prompt in Graphite and output in Ink, so they read like the diagnostics they quote. Inline code is 0.88em with 4px corners.

### Navigation

- **Header:** Paper with a 1px Rule bottom edge; the mark at 1.1rem high and the site name at 0.8rem, 700, as the wordmark; the repository link without star or fork counts.
- **Top tabs:** 0.75rem at 600 on Paper, Graphite at rest, Ink on hover, Hunk for the current section.
- **Sidebar:** 0.75rem. The current page is Hunk at 700 on a 10% Hunk tint, the only colour in the sidebar. Section headings are Ink at 700.
- **Language menu:** a Paper panel with a Rule border, 6px corners and the floating-panel shadow; items turn Hunk on hover. It keeps the current page when switching language.
- **Footer:** Paper with a 1px Rule top, the meta row on Paper 2, copyright in Graphite.

### Review pane (signature, home page)

A figure on Paper with a 1px Rule border and 6px corners, clipped. A path bar on Paper 2 in mono shows the file (Ink, 700) and the change summary (Graphite). The hunk shows real line numbers in a Graphite gutter divided by a Rule; wrapped lines continue after the gutter. The flagged line has a Removed tint background, a bold Removed line number, and a wavy Removed underline (1.5px) under the imported name at the reported column. Under it the real command output: prompt in Graphite, the rule code in Removed. The caption, in the text face, says when and on what the run was recorded. Copy buttons are hidden because it is a picture of a run; the quickstart holds the commands.

### Bar chart (home page)

A real `<table>` drawn as bars: each track is the 0 to 100 ms budget on a Rule fill ending in a 2px Ink tick, each bar the measured p95 in Hunk, the value in 700 beside the bar, or inside it in On Hunk when the bar is too long. Row labels link to where the number was measured.

### Diagrams and charts

**Hand-built SVG** (the model: `#homepage-loop` and `#quadrant-chart` in `stylesheets/extra.css`). Give the SVG an id, classes on its parts and colour them in CSS only with `var(--md-*)` or `var(--inw-*)`, never literal colours in the markup, so both schemes work. Nodes are Paper 2 with a 1px Graphite stroke and Ink labels (14.70 / 12.91), the one subject node is a Hunk fill with On Hunk text at 700 (6.39 / 8.66), edges and edge labels are Graphite at a 2px stroke, a pass is outlined in Added and a violation edge turns Removed. Set text in `var(--md-text-font-family)` at 14 to 15px and draw at the size it will be shown (the loop is 380 units wide and never scaled up). Focusable nodes get `tabindex="0"`, a visible focus state (2.5px Ink stroke) and the SVG an `aria-label` or `role="img"` with a description. Put diagram styles in `@layer inwards-diagrams`: the theme never styles SVG internals, so a layer loses nothing, and only a size the theme's unlayered `svg` rules would override goes in `home.css`.

**Mermaid** renders inside a closed shadow root, so CSS selectors never reach it. Theme it only through the `--md-mermaid-*` properties (mapped above) or, per diagram, through `themeVariables` in the diagram's front matter. Chapter 6's pie chart does the latter with a fixed six-step ramp of white-labelled slices: `#084e65` (9.18), `#0b6784` (6.39), `#2f7f99` (4.55), `#3e4852` (9.32), `#56616c` (6.32), `#6b7580` (4.69), and a `#6b7580` title. A Mermaid type that ignores both routes (quadrantChart did) is redrawn as a hand-built SVG.

**Motion.** The agent loop plays one review cycle once on load: edit to hook, violation back to the agent in Removed, hook again, clean in Added, over 5s after a 0.8s delay on `cubic-bezier(0.16, 1, 0.3, 1)`, with no fill mode so hover takes over. Hovering or focusing a node recolours its edges in Hunk and, with motion allowed, runs a dash flow (0.6s linear). UI transitions are 150ms. Under `prefers-reduced-motion: reduce`, `theme.css` sets every transition and animation to 0s; nothing else on the site moves.

### Zensical overrides

Checked against Zensical 0.0.65. After an upgrade, diff each template's upstream counterpart and check every item here.

| Override | Why |
|---|---|
| `overrides/main.html` | Extends `base.html` at `extrahead` only, to preload the upright text font; derives the `../` prefix of the Polish site from `extra_css`. |
| `overrides/home.html` | Home layout (front matter `template: home.html`): wraps the content in `.inw-home` and ships the direction contract as an HTML comment. |
| `overrides/404.html` | Says what happened, in English or Polish by `theme.language`, and links to the home page and the rules index. |
| `overrides/partials/logo.html` | The Inwards mark, replacing `material/layers-triple`. |
| `overrides/partials/source.html` | The theme's repository link without `data-md-component="source"`, which would fetch star and fork counts from api.github.com: a third-party request, and one that fails while the repository is private. |
| `overrides/partials/alternate.html` | Language selector that links to the same page in the other language (issue #149), paired with `javascripts/language-switch.mjs`. |
| `theme.font = false`, `palette primary/accent = "custom"` | No Google Fonts request; no stock palette. |
| `stylesheets/theme.css` (unlayered) | Tokens, the `--md-*` mapping and restyles of theme classes: `.md-typeset` type and its code, admonition, tab, table, button, `kbd` and `mark` styles, `.md-header`, `.md-tabs`, `.md-nav`, `.md-select`, `.md-tooltip`/`.md-tooltip2`, `.md-footer`, `.md-source__repository`, `.md-copyright`, and the modern variant's `--color-*` triplets. |
| `stylesheets/home.css` (unlayered) | Home page only, scoped to `.inw-home`, plus `.inw-actions`, which the 404 page reuses. |
| `stylesheets/extra.css` (`@layer inwards-diagrams`) | The two hand-built SVGs. |

`theme.css` and `home.css` are unlayered on purpose: Zensical's CSS is unlayered, and unlayered rules beat every cascade layer whatever their specificity, so a layered token or restyle would lose. `biome.jsonc` scopes that exception. The diagrams stay layered because the theme never styles SVG internals.

### Named Rules

**The Theme-Through-Tokens Rule.** Colour a new component, chart or diagram through `var(--inw-*)` or `var(--md-*)`; a literal colour is allowed only where the renderer cannot read a custom property (Mermaid `themeVariables`), and then it is a value from this file.

## Do's and Don'ts

### Do:

- **Do** use Hunk for exactly four jobs: links, the current nav item, focus and the primary action (plus the subject node or bar of a diagram).
- **Do** keep red and green for violations and passes; a flagged line gets the Removed tint, a pass the Added colour.
- **Do** separate surfaces with a 1px Rule or a Paper 2 fill, with 6px corners on blocks and 4px on inline code.
- **Do** keep prose at 34em (about 72 characters) and let code, tables and diagrams take the full column.
- **Do** take heading sizes from the 1.2 ladder and reserve the display clamp for the home hero.
- **Do** show real output: real line numbers, real diagnostics, measured numbers linked to where they were measured.
- **Do** add every new tone to `theme.css` in both schemes and record its contrast ratio here.
- **Do** stop all motion under `prefers-reduced-motion` and keep UI transitions at 150ms.
- **Do** check the Zensical overrides table after every Zensical upgrade.

### Don't:

- **Don't** use stock Material or Zensical deep purple, amber or Inter.
- **Don't** use warm cream paper with a serif and a terracotta accent.
- **Don't** use near-black with one neon accent.
- **Don't** use purple-to-blue gradients or gradient text.
- **Don't** use glassmorphism as decoration.
- **Don't** lay out a grid of same-size cards, each an icon, a heading and a line of text; the home page's entry links sit on one rule for this reason.
- **Don't** build a big-number three-stats hero; numbers go in a chart or a sentence with a link.
- **Don't** put ALL-CAPS eyebrow labels over headings.
- **Don't** number sections that are not a sequence; the quickstart's counters are the one real sequence.
- **Don't** set monospace on text that is not code, a path, a command or a key.
- **Don't** use hard offset shadows; the `<kbd>` keycap edge is the one zero-blur shadow and stays on `<kbd>`.
- **Don't** append arrows to links.
- **Don't** add a coloured side border to admonitions or any other block.
- **Don't** put a cascade layer around rules that restyle theme classes; they would lose to Zensical's unlayered CSS.
- **Don't** style Mermaid with CSS selectors; use `--md-mermaid-*` or `themeVariables`.
- **Don't** change a page URL to fit the navigation; `rules/INWxxx/` is a CLI contract.
