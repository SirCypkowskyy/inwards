// fallow-ignore-file unused-file
// Loaded via extra_javascript in docs/zensical.toml and docs/zensical.pl.toml,
// a TOML config fallow's JS import graph can't trace; docs/test/nav-tree.test.ts
// imports toggleAttributes().

/**
 * Names the sidebar's expand toggles and reports whether each is open.
 *
 * With `navigation.indexes`, a section with an index page (each rule category,
 * issue #381) renders as a link to that page plus a focusable `<label>` that
 * flips a hidden checkbox. The theme gives that label only an icon, so a
 * screen reader announces an unnamed control with no state. This names it
 * after its section, makes it a button and keeps `aria-expanded` in step with
 * the checkbox; `onKeydown` adds Space, which a button answers. The section's
 * link and the theme's markup are left as they are.
 *
 * @param {string} name - the section's title, as its link shows it.
 * @param {boolean} expanded - whether the section's checkbox is checked.
 * @returns the attributes the toggle label gets.
 */
export function toggleAttributes(name, expanded) {
  return {
    role: "button",
    "aria-label": name.replace(/\s+/gu, " ").trim(),
    "aria-expanded": expanded ? "true" : "false",
  };
}

/**
 * Applies `toggleAttributes` to every section toggle in the primary sidebar.
 *
 * Instant navigation replaces the sidebar on each page, so this runs after
 * every navigation, not once.
 */
function label() {
  for (const container of document.querySelectorAll(".md-nav--primary .md-nav__container")) {
    const toggle = container.querySelector(":scope > label.md-nav__link[for]");
    const link = container.querySelector(":scope > a");
    const target = toggle?.getAttribute("for");
    const input = target ? document.querySelector(`#${CSS.escape(target)}`) : null;
    if (!(toggle && link && input instanceof HTMLInputElement)) {
      continue;
    }
    for (const [key, value] of Object.entries(
      toggleAttributes(link.textContent || "", input.checked),
    )) {
      toggle.setAttribute(key, value);
    }
  }
}

/**
 * Keeps a toggle's `aria-expanded` current when its checkbox changes.
 *
 * @param {Event} event - a change anywhere in the document.
 */
function onChange(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement && input.classList.contains("md-nav__toggle"))) {
    return;
  }
  const toggle = document.querySelector(
    `label.md-nav__link[for="${CSS.escape(input.id)}"][role="button"]`,
  );
  toggle?.setAttribute("aria-expanded", input.checked ? "true" : "false");
}

/**
 * Opens or closes a section when Space is pressed on its toggle.
 *
 * The theme answers Enter on a focused label; a button also answers Space, and
 * the label is announced as one, so Space clicks it too (a click on a label
 * flips its checkbox) instead of scrolling the page.
 *
 * @param {KeyboardEvent} event - a key press anywhere in the document.
 */
function onKeydown(event) {
  const toggle = event.target;
  if (event.key !== " " || !(toggle instanceof HTMLLabelElement && toggle.role === "button")) {
    return;
  }
  event.preventDefault();
  toggle.click();
}

if (typeof document !== "undefined") {
  document.addEventListener("change", onChange);
  document.addEventListener("keydown", onKeydown);
  // `document$` (the theme's instant-navigation observable) replays the first
  // page load, so subscribing covers it; without the theme's script, run once.
  if (globalThis.document$ && typeof globalThis.document$.subscribe === "function") {
    globalThis.document$.subscribe(label);
  } else {
    label();
  }
}
