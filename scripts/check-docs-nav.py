"""Fail when a Markdown page in the docs is missing from the zensical.toml nav.

`zensical build --strict` still builds such a page, but no menu links to it,
so readers never find it (issue #26). CI runs this before the docs build:

    uv run scripts/check-docs-nav.py
"""

import posixpath
import sys
import tomllib
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs"


def nav_pages(entry: object) -> set[str]:
    """Collect the page paths in a nav entry, at any depth of sections."""
    if isinstance(entry, str):
        return {posixpath.normpath(entry)}
    if isinstance(entry, list):
        return set().union(*map(nav_pages, entry))
    if isinstance(entry, dict):
        return nav_pages(list(entry.values()))
    return set()


project = tomllib.loads((DOCS / "zensical.toml").read_text())["project"]
pages_dir = DOCS / project.get("docs_dir", "docs")
# Zensical doesn't build dotfiles or files in dot-directories, so they need no nav entry.
pages = {
    rel.as_posix()
    for rel in (page.relative_to(pages_dir) for page in pages_dir.rglob("*.md"))
    if not any(part.startswith(".") for part in rel.parts)
}
missing = sorted(pages - nav_pages(project.get("nav", [])))
for page in missing:
    print(
        f"{pages_dir.relative_to(DOCS.parent)}/{page} is not in the nav of docs/zensical.toml",
        file=sys.stderr,
    )
sys.exit(1 if missing else 0)
