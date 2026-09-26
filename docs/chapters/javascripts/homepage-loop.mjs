// :hover + :has() (see extra.css) covers mouse/keyboard users. Touch
// devices never fire :hover, so this listens for taps on the two nodes
// and toggles the same highlight via a plain class instead.
function wireHomepageLoop() {
  const svg = document.getElementById("homepage-loop");
  if (!svg) return; // not on this page

  const edgesByNode = {
    "hl-agent": ["hl-edge-to-hook", "hl-edge-violation"],
    "hl-hook": ["hl-edge-to-hook", "hl-edge-clean", "hl-edge-violation"],
  };

  for (const [nodeId, edgeIds] of Object.entries(edgesByNode)) {
    const node = document.getElementById(nodeId);
    if (!node) continue;
    node.addEventListener("click", () => {
      const active = node.classList.toggle("is-tapped");
      for (const edgeId of edgeIds) {
        document.getElementById(edgeId)?.classList.toggle("is-active", active);
      }
    });
  }
}

wireHomepageLoop();
if (window.document$ && typeof window.document$.subscribe === "function") {
  window.document$.subscribe(wireHomepageLoop);
}
