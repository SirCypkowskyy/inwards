// fallow-ignore-file unused-file
// Loaded via docs/zensical.toml's extra_javascript, a TOML config
// fallow's JS import graph can't trace.

/**
 * Wires tap-to-highlight on the homepage loop's nodes.
 *
 * `:hover` + `:has()` (see extra.css) covers mouse/keyboard users. Touch
 * devices never fire `:hover`, so this listens for taps on the two nodes
 * and toggles the same highlight via a plain class instead. Highlighted
 * edges are recomputed from every currently-tapped node on each click,
 * not toggled per-node, so an edge shared between two nodes (like
 * hl-edge-to-hook and hl-edge-violation, shared by hl-agent and hl-hook)
 * stays highlighted as long as at least one of its nodes is still tapped.
 */
function wireHomepageLoop() {
  const svg = document.querySelector("#homepage-loop");
  if (!svg) {
    return; // not on this page
  }

  const edgesByNode = {
    "hl-agent": ["hl-edge-to-hook", "hl-edge-violation"],
    "hl-hook": ["hl-edge-to-hook", "hl-edge-clean", "hl-edge-violation"],
  };
  const nodeIds = Object.keys(edgesByNode);
  const allEdgeIds = new Set(Object.values(edgesByNode).flat());

  /** Re-derives which edges are highlighted from every currently-tapped node. */
  function recomputeEdgeHighlights() {
    const activeEdges = new Set();
    for (const nodeId of nodeIds) {
      const node = document.querySelector(`#${nodeId}`);
      if (!node?.classList.contains("is-tapped")) {
        continue;
      }
      for (const edgeId of edgesByNode[nodeId]) {
        activeEdges.add(edgeId);
      }
    }
    for (const edgeId of allEdgeIds) {
      document.querySelector(`#${edgeId}`)?.classList.toggle("is-active", activeEdges.has(edgeId));
    }
  }

  for (const nodeId of nodeIds) {
    const node = document.querySelector(`#${nodeId}`);
    if (!node) {
      continue;
    }
    node.addEventListener("click", () => {
      node.classList.toggle("is-tapped");
      recomputeEdgeHighlights();
    });
  }
}

// `document$` (Material/Zensical's instant-navigation observable) is a
// ReplaySubject: it already fires once for the very first page load, so
// calling wireHomepageLoop() both immediately AND from this subscription
// would bind every click listener twice, canceling each tap's toggle.
// Only fall back to an immediate call when `document$` isn't there at all.
if (globalThis.document$ && typeof globalThis.document$.subscribe === "function") {
  globalThis.document$.subscribe(wireHomepageLoop);
} else {
  wireHomepageLoop();
}
