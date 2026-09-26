# Diagram theming, animation and rich tooltips (#109)

**Status:** approved by owner in chat 2026-09-26, pending written-spec review.
**Epic:** #3 (M2 · Design-partner ready). **Issue:** #109. **Base branch:**
`develop`. **Coordinates with:** #100 / PR #104 (content-accuracy pass on the
same files) by touching styling/interaction only, never diagram labels or
structure.

## Why

Every diagram in `docs/chapters/` is a Mermaid block. Two independent defects
make several of them look broken or inconsistent in dark mode:

1. `quadrantChart` ("Where the tools sit", `02-Business-Context.md`) is not
   one of the diagram types Zensical auto-themes (flowchart, sequence, class,
   state, ER only — confirmed in Zensical's own docs). It keeps Mermaid's
   hardcoded default colors regardless of the site's palette.
2. The C1–C4 flowcharts (`03-Architecture-C4.md`) declare hardcoded hex
   colors in `classDef` (e.g. `classDef ext fill:#eceff1,color:#263238`) for
   the "external system" boxes. Explicit classDef colors override Zensical's
   auto-theming, so those boxes stay light-grey in dark mode.

Separately, the owner wants the highest-value diagrams to feel alive
(animated arrows, hover/expand interactions) rather than static pictures,
and wants richer tooltips across the docs (multi-line text, images, small
markdown blocks) instead of today's plain-text-only tooltips.

## Fact-finding that shapes every decision below

Verified directly against the built site (`docs/site/assets/javascripts/bundle.c04ba553.min.js`)
and against Zensical's own docs (fetched via Context7, `/zensical/docs`):

- **Zensical renders each Mermaid diagram inside a closed shadow root**
  (`r.attachShadow({mode:"closed"})`, found verbatim in the built bundle) —
  the same architecture as Material for MkDocs. External stylesheets and
  scripts cannot reach inside a closed shadow root by DOM APIs.
- **CSS custom properties are the one thing that crosses that boundary.**
  Custom properties are inherited values, not selectors, so `var(--md-mermaid-node-bg-color)`
  set on `:root` resolves correctly for CSS written *inside* the shadow
  tree. This is exactly how Zensical's existing auto-theming already works
  for the five supported diagram types — the bundle's embedded Mermaid CSS
  reads `var(--md-mermaid-node-bg-color)`, `var(--md-mermaid-edge-color)`,
  `var(--md-mermaid-label-fg-color)`, etc.
- **JS that runs before `mermaid.render()` is unaffected by the shadow
  boundary**, because it executes outside the shadow root entirely and only
  its *output* (the SVG string) gets attached inside. Zensical's documented,
  sanctioned customization path is exactly this: override the Mermaid module
  via `extra_javascript`, call `mermaid.initialize({...})` with custom
  `theme`/`themeVariables`, and assign `window.mermaid = mermaid`.
- **JS that tries to reach back out of the shadow root (Mermaid's
  `click nodeId call callback()`) is the documented failure mode** in
  Material for MkDocs (maintainer-confirmed in a GitHub discussion): the
  callback can't access the outer document scope. `click nodeId href "url"`
  (a plain anchor, no JS bridge needed) is unaffected. Not independently
  confirmed for Zensical's own shadow-root implementation, but the mechanism
  is identical, so treat it as true and verify empirically on the first
  diagram that uses it.
- **`content.code.annotate`'s popover mechanism may not be limited to code
  fences.** In Material for MkDocs, the same annotation mechanism (`{ .annotate }`
  via attr_list, or `<div class="annotate" markdown>`) works on arbitrary
  Markdown content, not just code blocks, and renders full Markdown (images,
  formatting) inside the popover. Zensical's own docs describe the feature
  narrowly (code-block scoped) but that may just be under-documented, since
  Zensical's stated goal is Material-for-MkDocs compatibility. Unverified —
  first thing to test in implementation.
- **`content.tooltips` is confirmed plain-text-only in Zensical's own docs**
  — no path to rich content through it, in any of its trigger forms.
- **Arbitrary third-party mkdocs plugins are not safe to assume working.**
  Zensical reimplements a fixed list of plugins natively; a plugin absent
  from that list (e.g. `neoteroi.mkdocs`, `mkdocs-panzoom-plugin`) should be
  treated as unsupported until proven otherwise.

## Decision 1: fix theming for every diagram (required, no alternative considered)

Two different mechanisms for two different root causes, both zero-dependency:

- **Flowcharts with hardcoded classDef colors (C1–C4 and any other diagram
  using `classDef ... fill:#hex`):** replace the literal hex values with CSS
  custom properties. Reuse Zensical's existing `--md-mermaid-*` variables
  where the semantics match (e.g. person/system nodes can likely just drop
  their classDef entirely and let auto-theming apply); for the "external
  system" grey-box look that has no existing equivalent variable, define new
  custom properties (e.g. `--diagram-ext-bg`, `--diagram-ext-fg`,
  `--diagram-ext-border`) in a new `docs/stylesheets/extra.css`, with light
  and dark values scoped by `[data-md-color-scheme="default"]` /
  `[data-md-color-scheme="slate"]`, and reference them from `classDef` in
  the Mermaid source (`classDef ext fill:var(--diagram-ext-bg),color:var(--diagram-ext-fg),stroke:var(--diagram-ext-border)`).
  Register the stylesheet via `extra_css` in `docs/zensical.toml`.
  **Verify first:** confirm Mermaid emits `fill:var(...)` as literal CSS
  (not as an SVG presentation attribute, which wouldn't support `var()`) by
  building one diagram and inspecting the shadow-root contents in a browser.
- **`quadrantChart`:** add `docs/javascripts/mermaid.mjs`, importing Mermaid
  from the same CDN pattern Zensical's own docs use, calling
  `mermaid.initialize({ theme: "base", themeVariables: {...} })` with the
  quadrant-specific keys (`quadrant1Fill`..`quadrant4Fill`,
  `quadrant1TextFill`..`quadrant4TextFill`, `quadrantPointFill`,
  `quadrantPointTextFill`, `quadrantXAxisTextFill`, `quadrantYAxisTextFill`,
  `quadrantInternalBorderStrokeFill`, `quadrantExternalBorderStrokeFill`,
  `quadrantTitleFill`) computed from `getComputedStyle(document.documentElement)`
  reading the same `--md-mermaid-*`/`--md-primary-fg-color` variables, and
  re-running on `data-md-color-scheme` change via a `MutationObserver` on
  `document.body`, then calling `mermaid.run()` to re-render. Register via
  `extra_javascript`.

## Decision 2: animate/interact — CSS/native Mermaid everywhere, one custom component for the two flagship diagrams

- **Everywhere (zero cost, applies to every diagram):** native Mermaid
  `click nodeId href "url"` where a node should link somewhere, plus plain
  CSS `:hover` rules on `.edgePath path` using `stroke-dasharray` /
  `stroke-dashoffset` animation for a "flow" effect on hover. No JS beyond
  what Decision 1 already adds. Avoid `click ... call callback()` given the
  shadow-root caveat above.
- **Two flagship diagrams get a hand-built component instead of Mermaid**
  (owner's call, my pick for "most representative"):
  1. **The homepage loop** (`index.md`, `agent → hook → agent/continue`) —
     small, three-node, the first thing a visitor sees. Becomes a plain
     inline SVG + a small `docs/javascripts/homepage-loop.mjs` (no
     framework, no build step) that animates the loop continuously (or on
     hover/in-view) to sell the "runs after every edit" pitch at a glance.
  2. **The quadrant chart** ("Where the tools sit") — already being rebuilt
     as a custom `theme: "base"` Mermaid render per Decision 1; extending it
     with hover interactivity (reveal a tool's one-line description on
     hover/focus over its point) is a natural continuation of the same code
     path rather than a second rewrite. If the quadrant-specific
     `themeVariables` bridge from Decision 1 proves fragile in testing, fall
     back to a hand-built SVG scatter component here too, same as the
     homepage loop.
  Both stay dependency-free: inline SVG, vanilla JS, registered through
  `extra_javascript`/`extra_css` like everything else in this design.
- **Out of scope, flagged not decided:** a full homepage content/layout
  refresh beyond its diagram. Raise as a separate conversation/issue if
  wanted — not bundled into #109.

## Decision 3: rich tooltips — try the free option first, fall back to Tippy

1. Spend up to 30 minutes verifying whether Zensical's annotation mechanism
   (`{ .annotate }` / `<div class="annotate" markdown>`) works outside code
   fences, by building the docs locally and trying it on one glossary term
   or diagram caption. If it renders full Markdown (image + formatted text)
   in a popover: use it everywhere a rich tooltip is wanted. Zero JS, zero
   dependency, uses extensions already enabled (`attr_list`, `md_in_html`).
2. If step 1 fails (mechanism really is code-fence-only in Zensical): add
   Tippy.js via two `<script>` tags in `extra_javascript`
   (`@popperjs/core@2`, `tippy.js@6`, both from a CDN, no npm/build step),
   `tippy('[data-tooltip-html]', { content: el => el.dataset.tooltipHtml, allowHTML: true })`.
   Pre-render the rich content to HTML by hand per tooltip (small, finite
   number of uses) rather than adding a Markdown pipeline for it.
3. Not now: the native HTML Popover API. Genuinely viable (Baseline Widely
   Available since April 2025) but newer and less battle-tested; revisit in
   a future pass once it's had more field time. Not needed if step 1 or 2
   already satisfies the ask.

## Rollout order

1. Spike: verify the two open technical assumptions before committing to
   the full diagram set — (a) `classDef ... fill:var(...)` renders
   correctly inside the closed shadow root, (b) the annotation mechanism
   works outside code fences. Both are cheap (one diagram / one tooltip) and
   both gate which of the above paths is actually available.
2. Audit every Mermaid diagram in `docs/chapters/` (and `guides/`) in light
   and dark mode against a local `zensical serve`; record every
   contrast/readability failure, not just the four already screenshotted.
3. Apply the Decision 1 fix to every diagram found broken in step 2.
4. Apply Decision 2's CSS/native-Mermaid layer to every diagram; build the
   two flagship components.
5. Apply Decision 3's tooltip fix wherever the docs currently use a
   plain-text tooltip that would benefit from richer content (owner picks
   the concrete spots from a short list presented after step 1's spike).

## Testing / acceptance mapping

- Manual: `uv run zensical serve -f docs/zensical.toml`, check every diagram
  in both palettes (toggle in the page header) and at mobile width.
- `act pull_request -W .github/workflows/ci.yml -j docs` (strict docs build)
  before handing back, per AGENTS.md.
- No automated visual-regression test exists for this project and adding
  one is out of scope — acceptance is the manual check above, recorded in
  the issue's closing comment per AGENTS.md "Finishing a piece of work".
- Maps to #109's acceptance checkboxes directly (audit recorded, styling
  approved before implementation — this document — contrast check, flagship
  diagrams animated, strict build green, tooltip options presented and a
  direction picked or deferred).

## Risks / open questions carried into implementation

- Both shadow-root-crossing techniques (CSS custom properties into classDef,
  annotation popovers outside code fences) are informed guesses from how
  Material for MkDocs behaves, not confirmed for Zensical specifically.
  Step 1 of the rollout order exists precisely to fail fast on either if
  they don't hold, before the design's cost estimate is wrong.
- If `classDef ... fill:var(...)` does NOT render correctly, the fallback is
  the same `extra_javascript`-based Mermaid override used for the quadrant
  chart (Decision 1's second bullet), applied to the affected flowcharts too
  — more JS, same zero-new-dependency budget.
