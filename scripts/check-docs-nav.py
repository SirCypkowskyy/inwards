"""Fail when a Markdown page in the docs is missing from its site's nav.

`zensical build --strict` still builds such a page, but no menu links to it,
so readers never find it (issue #26). Checks both sites: English
(docs/zensical.toml, docs/chapters/) and Polish (docs/zensical.pl.toml,
docs/pl/). It also checks that each site's Rules section is the category
tree of issue #381: one group per rule category, in the index's order, each
holding the pages of its rules and nothing else, so a new rule page can't land
outside its group. That check lives in scripts/check-rule-pages.py
(`nav_problems`), which knows the categories; this script runs it too. CI
runs this before the docs build:

    uv run scripts/check-docs-nav.py
"""

import posixpath
import runpy
import sys
import tomllib
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs"
# The rule page checker, loaded for its nav tree check; its main() doesn't run.
RULE_PAGES = runpy.run_path(str(Path(__file__).resolve().parent / "check-rule-pages.py"))


def nav_pages(entry: object) -> set[str]:
    """Collect the page paths in a nav entry, at any depth of sections."""
    if isinstance(entry, str):
        return {posixpath.normpath(entry)}
    if isinstance(entry, list):
        return set().union(*map(nav_pages, entry))
    if isinstance(entry, dict):
        return nav_pages(list(entry.values()))
    return set()


missing = []
for config in ("zensical.toml", "zensical.pl.toml"):
    project = tomllib.loads((DOCS / config).read_text())["project"]
    pages_dir = DOCS / project.get("docs_dir", "docs")
    # Zensical doesn't build dotfiles or files in dot-directories, so they need no nav entry.
    pages = {
        rel.as_posix()
        for rel in (page.relative_to(pages_dir) for page in pages_dir.rglob("*.md"))
        if not any(part.startswith(".") for part in rel.parts)
    }
    for page in sorted(pages - nav_pages(project.get("nav", []))):
        missing.append(page)
        print(
            f"{pages_dir.relative_to(DOCS.parent)}/{page} is not in the nav of docs/{config}",
            file=sys.stderr,
        )
for site, config in (("en", "zensical.toml"), ("pl", "zensical.pl.toml")):
    for problem in RULE_PAGES["nav_problems"](site, RULE_PAGES["site_categories"](site)):
        missing.append(problem)
        print(f"docs/{config}: {problem}", file=sys.stderr)
sys.exit(1 if missing else 0)
