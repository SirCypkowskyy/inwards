// Loaded via extra_javascript in docs/zensical.toml and docs/zensical.pl.toml;
// docs/test/language-switch.test.ts imports counterpart().

/**
 * Works out where a language link should go from the current page.
 *
 * `alternate` is the other language's root relative to this site's root
 * ("pl/" or "../"). The target is the current page's path under that root,
 * with the same anchor: Polish headings keep the English ids. The path comes
 * from the address bar, which anyone can craft (GitHub Pages serves 404.html,
 * and this script, for any path), so it is always resolved as a relative path
 * ("./" first, so `javascript:` or `//host` can't become a scheme or a host),
 * and anything that still leaves this origin or isn't http(s) falls back to
 * the language root.
 *
 * @param {string} alternate - the link's `data-inwards-alternate` value.
 * @param {URL} root - this site's root, ending in a slash.
 * @param {{ pathname: string, hash: string }} here - the current location.
 * @returns the other language's root and the current page under it.
 */
export function counterpart(alternate, root, here) {
  const other = new URL(alternate || "./", root);
  const path = here.pathname.startsWith(root.pathname)
    ? here.pathname.slice(root.pathname.length)
    : "";
  const page = new URL(`./${path}${here.hash}`, other);
  const safe =
    page.origin === root.origin && (page.protocol === "https:" || page.protocol === "http:");
  return { root: other, page: safe ? page : other };
}

/**
 * Finds this site's root URL, resolved once from the first page loaded.
 *
 * The theme's `#__config` holds `base`, the path from the page to the site
 * root. Instant navigation never reruns this module, so resolving it here,
 * against the page it was loaded on, stays correct on every later page.
 *
 * @returns the site root, ending in a slash.
 */
function siteRoot() {
  const config = document.querySelector("#__config");
  const base = config ? JSON.parse(config.textContent || "{}").base : ".";
  return new URL(`${base || "."}/`, globalThis.location.href);
}

/**
 * Wires the language links: keeps their hrefs current and handles clicks.
 *
 * Runs only in a browser; tests import `counterpart` alone.
 */
function wire() {
  const root = siteRoot();

  /**
   * Points every language link's href at the current page's counterpart.
   *
   * Instant navigation swaps the content but not the header, so the href the
   * server rendered still names the first page loaded. Ctrl-click,
   * middle-click and "copy link" read the href, so it is refreshed after every
   * navigation.
   */
  function syncLinks() {
    for (const link of document.querySelectorAll("a[data-inwards-alternate]")) {
      if (link instanceof HTMLAnchorElement) {
        link.href = counterpart(
          link.dataset.inwardsAlternate || "",
          root,
          globalThis.location,
        ).page.href;
      }
    }
  }

  /**
   * Opens the current page in the other language, or that language's root.
   *
   * Runs in the capture phase and stops the click there, so neither instant
   * navigation nor the theme's sitemap-based switcher (which assumes sibling
   * language roots, not /pl/ inside the English site) acts on it as well.
   *
   * @param {MouseEvent} event - a click anywhere in the document.
   */
  async function onClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    const link = target?.closest("a[data-inwards-alternate]");
    const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (!(link instanceof HTMLAnchorElement) || modified) {
      return; // a new tab or window uses the href, which syncLinks keeps current
    }
    event.preventDefault();
    event.stopPropagation();
    const { root: other, page } = counterpart(
      link.dataset.inwardsAlternate || "",
      root,
      globalThis.location,
    );
    let destination = page;
    try {
      const response = await fetch(page, { method: "HEAD" });
      destination = response.ok ? page : other;
    } catch (error) {
      // Offline or blocked: let the browser try the page and show its own error.
      console.warn("inwards: could not check the translated page", error);
    }
    globalThis.location.assign(destination);
  }

  document.addEventListener("click", onClick, true);
  // `document$` (the theme's instant-navigation observable) replays the first
  // page load, so subscribing covers it; without the theme's script, run once.
  if (globalThis.document$ && typeof globalThis.document$.subscribe === "function") {
    globalThis.document$.subscribe(syncLinks);
  } else {
    syncLinks();
  }
}

if (typeof document !== "undefined") {
  wire();
}
