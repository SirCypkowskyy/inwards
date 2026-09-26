// fallow-ignore-file unused-file
// Loaded via extra_javascript in docs/zensical.toml and docs/zensical.pl.toml,
// TOML configs fallow's JS import graph can't trace.

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

const ROOT = siteRoot();

/**
 * Works out where a language link should go from the current page.
 *
 * `data-inwards-alternate` is the other language's root relative to this
 * site's root ("pl/" or "../"). The target is the current page's path under
 * that root, with the same anchor: Polish headings keep the English ids.
 *
 * @param {HTMLAnchorElement} link - a language link from the header selector.
 * @returns the other language's root and the current page under it.
 */
function counterpart(link) {
  const root = new URL(link.dataset.inwardsAlternate || "./", ROOT);
  const here = globalThis.location;
  const path = here.pathname.startsWith(ROOT.pathname)
    ? here.pathname.slice(ROOT.pathname.length)
    : "";
  return { root, page: new URL(`${path}${here.hash}`, root) };
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
  if (!(link instanceof HTMLAnchorElement) || event.metaKey || event.ctrlKey) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const { root, page } = counterpart(link);
  let destination = page;
  try {
    const response = await fetch(page, { method: "HEAD" });
    destination = response.ok ? page : root;
  } catch (error) {
    // Offline or blocked: let the browser try the page and show its own error.
    console.warn("inwards: could not check the translated page", error);
  }
  globalThis.location.assign(destination);
}

document.addEventListener("click", onClick, true);
