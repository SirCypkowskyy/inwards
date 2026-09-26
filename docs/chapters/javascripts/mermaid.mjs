// Zensical auto-themes flowchart/sequence/class/state/ER diagrams but not
// quadrantChart or pie charts (confirmed in Zensical's own docs, "Other
// diagram types"). This module fills that gap by computing Mermaid
// themeVariables from the site's own CSS custom properties and
// re-applying them whenever the palette or the page changes.
//
// Zensical calls mermaid.initialize() itself once, lazily, with
// { startOnLoad:false, themeCSS, sequence:{...} } (confirmed by reading
// the built bundle) and no `theme` or `themeVariables` keys — so this
// module's own initialize() call, made from a separately-loaded
// extra_javascript module, is not fought over by Zensical's own call as
// long as it runs first. Both calls target the same global Mermaid
// config object and mermaid merges rather than replaces on each call.
//
// The import is dynamic (not a static top-level `import`) specifically so
// a blocked/failed CDN request (offline dev, ad-blocker, corporate proxy)
// can be caught: Zensical's own bundle still renders every diagram with
// its default, un-themed colors in that case, instead of this module
// throwing an uncaught error that could interrupt other page scripts.
let mermaid;
try {
  ({ default: mermaid } = await import(
    "https://unpkg.com/mermaid@11/dist/mermaid.esm.min.mjs"
  ));
} catch (err) {
  console.warn(
    "inwards docs: could not load Mermaid from the CDN, quadrant/pie charts will use default (un-themed) colors.",
    err,
  );
}

/** Reads one CSS custom property's current computed value from :root. */
function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

/** Builds Mermaid themeVariables from the site's current palette. */
function buildThemeVariables() {
  const nodeBg = cssVar("--md-mermaid-node-bg-color", "#7e57c2");
  const edge = cssVar("--md-mermaid-edge-color", "#7e57c2");
  const labelFg = cssVar("--md-mermaid-label-fg-color", "#000");
  const labelBg = cssVar("--md-mermaid-label-bg-color", "#fff");
  const primary = cssVar("--md-primary-fg-color", "#7e57c2");

  return {
    // Generic keys, used by pie charts.
    pieOuterStrokeWidth: "2px",
    pieSectionTextColor: labelFg,
    pieLegendTextColor: labelFg,
    pieStrokeColor: labelBg,
    pieOpacity: "0.9",
    pie1: primary,

    // Quadrant-chart-specific keys (ignored by other diagram types).
    quadrant1Fill: nodeBg,
    quadrant2Fill: nodeBg,
    quadrant3Fill: nodeBg,
    quadrant4Fill: nodeBg,
    quadrant1TextFill: labelFg,
    quadrant2TextFill: labelFg,
    quadrant3TextFill: labelFg,
    quadrant4TextFill: labelFg,
    quadrantPointFill: primary,
    quadrantPointTextFill: labelFg,
    quadrantXAxisTextFill: labelFg,
    quadrantYAxisTextFill: labelFg,
    quadrantInternalBorderStrokeFill: edge,
    quadrantExternalBorderStrokeFill: edge,
    quadrantTitleFill: labelFg,
  };
}

/** (Re-)initializes Mermaid with theme variables for the current palette.
 *  No-ops if the CDN import above failed. */
function applyTheme() {
  if (!mermaid) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    themeVariables: buildThemeVariables(),
  });
}

/** Re-renders every mermaid block already on the page under the new theme.
 *  No-ops if the CDN import above failed. */
async function rerenderAll() {
  if (!mermaid) return;
  applyTheme();
  const blocks = document.querySelectorAll(".mermaid, pre.mermaid");
  if (blocks.length > 0) {
    await mermaid.run({ nodes: blocks });
  }
}

if (mermaid) {
  applyTheme();
  window.mermaid = mermaid;

  // Re-render on palette toggle (the attribute Zensical/Material sets on
  // <body> when the user switches light/dark, no page reload).
  new MutationObserver((mutations) => {
    if (mutations.some((m) => m.attributeName === "data-md-color-scheme")) {
      rerenderAll();
    }
  }).observe(document.body, { attributes: true });

  // Re-apply on Zensical's instant navigation if it exposes the Material
  // convention of a global `document$` observable; fall back to nothing
  // extra if it doesn't, since a full navigation already re-runs this
  // module's top-level `applyTheme()` call on the next page load.
  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(() => rerenderAll());
  }
}
