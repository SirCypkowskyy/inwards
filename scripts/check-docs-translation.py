"""Check that every English docs page has an up-to-date Polish translation.

English (docs/chapters/) is the source of truth; docs/pl/ mirrors every page
in the English nav at the same path (issue #149). Each Polish page starts
with front matter naming its source and the SHA-256 of the English file it
was translated from:

    ---
    source: docs/chapters/guides/install.md
    source_hash: 3f5c...
    ---

    uv run scripts/check-docs-translation.py                # report
    uv run scripts/check-docs-translation.py --fix-hashes docs/pl/guides/install.md
    uv run scripts/check-docs-translation.py --mark-stale   # CI, before the Polish build

Fails (exit 1) on a missing Polish page, a Polish page with no English page,
bad front matter, or theme features and Markdown extensions that differ
between the two configs. A stale page (its English source changed since the
hash was taken) is only a warning: the English change may not have needed a
new translation yet. `--mark-stale` puts a banner on each stale page, in the
working tree only; CI runs it before building so the published page says so.
`--fix-hashes` records the current English hash, after re-translating: pass
the Polish pages you updated, or nothing for every stale page.
"""

import argparse
import hashlib
import os
import re
import sys
import tomllib
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DOCS = REPO / "docs"
FRONT_MATTER = re.compile(r"\A---\n(?P<body>.*?\n)---\n", re.DOTALL)
FIELD = re.compile(r"^(?P<key>source|source_hash):[ \t]*(?P<value>\S*)[ \t]*$", re.MULTILINE)
STALE_MARKER = "<!-- inwards:stale -->"


def load(config: str) -> dict:
    """Read the [project] table of a Zensical config in docs/."""
    return tomllib.loads((DOCS / config).read_text())["project"]


def nav_pages(entry: object) -> list[str]:
    """Collect the page paths in a nav entry, in nav order, at any depth."""
    if isinstance(entry, str):
        return [entry]
    if isinstance(entry, list):
        return [page for item in entry for page in nav_pages(item)]
    if isinstance(entry, dict):
        return nav_pages(list(entry.values()))
    return []


def sha256(path: Path) -> str:
    """Hash a file's bytes, the way source_hash records it."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fields(text: str) -> dict[str, str]:
    """Read source and source_hash from a page's front matter."""
    match = FRONT_MATTER.match(text)
    return {m["key"]: m["value"] for m in FIELD.finditer(match["body"])} if match else {}


def page_url(page: str) -> str:
    """The URL of a page relative to its site root: guides/install.md -> guides/install/."""
    stem = page.removesuffix(".md")
    if stem == "index":
        return ""
    return f"{stem.removesuffix('/index')}/"


def banner(page: str) -> str:
    """The admonition a stale Polish page gets, linking to its English page."""
    # From docs/site/pl/<url> up to docs/site/, then down to the English page.
    up = "../" * (page_url(page).count("/") + 1)
    return (
        f"{STALE_MARKER}\n"
        '!!! warning "Tłumaczenie może być nieaktualne"\n'
        "    Angielska wersja tej strony zmieniła się od ostatniego tłumaczenia. "
        f'Aktualną treść znajdziesz w <a href="{up}{page_url(page)}">wersji angielskiej</a>.\n\n'
    )


def mark_stale(path: Path, page: str) -> None:
    """Insert the stale banner after the page's first heading, once."""
    text = path.read_text()
    if STALE_MARKER in text:
        return
    heading = re.search(r"^# .*\n", text, re.MULTILINE)
    front = FRONT_MATTER.match(text)
    at = heading.end() if heading else front.end() if front else 0
    path.write_text(f"{text[:at]}\n{banner(page)}{text[at:]}")


def set_hash(path: Path, digest: str) -> None:
    """Replace the source_hash in a page's front matter."""
    text = path.read_text()
    path.write_text(re.sub(r"^source_hash:.*$", f"source_hash: {digest}", text, count=1, flags=re.MULTILINE))


def report(kind: str, path: Path, message: str) -> None:
    """Print one finding, as a GitHub annotation when running in Actions."""
    rel = path.relative_to(REPO).as_posix()
    if os.environ.get("GITHUB_ACTIONS") == "true":
        print(f"::{kind} file={rel}::{message}")
    else:
        print(f"{kind}: {rel}: {message}", file=sys.stderr)


def main() -> int:
    """Run the check, and the fixes asked for; return the exit code."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "--fix-hashes",
        nargs="*",
        metavar="PAGE",
        help="record the current English hash for these Polish pages (none given: every stale page)",
    )
    parser.add_argument(
        "--mark-stale",
        action="store_true",
        help="add the 'may be out of date' banner to stale pages (working tree only)",
    )
    args = parser.parse_args()

    en, pl = load("zensical.toml"), load("zensical.pl.toml")
    en_dir, pl_dir = DOCS / en["docs_dir"], DOCS / pl["docs_dir"]
    errors = 0
    # The two sites should render the same Markdown the same way.
    for name, a, b in (
        ("markdown_extensions", en.get("markdown_extensions"), pl.get("markdown_extensions")),
        ("theme.features", en["theme"].get("features"), pl["theme"].get("features")),
    ):
        if a != b:
            report("error", DOCS / "zensical.pl.toml", f"{name} differs from docs/zensical.toml")
            errors += 1

    pages = nav_pages(en.get("nav", []))
    fix = None if args.fix_hashes is None else {(REPO / p).resolve() for p in args.fix_hashes}
    stale = []
    for page in pages:
        source, target = en_dir / page, pl_dir / page
        if not target.exists():
            report("error", target, f"missing: translate {source.relative_to(REPO).as_posix()}")
            errors += 1
            continue
        meta = fields(target.read_text())
        expected = source.relative_to(REPO).as_posix()
        if meta.get("source") != expected or not re.fullmatch(r"[0-9a-f]{64}", meta.get("source_hash", "")):
            report("error", target, f"front matter needs 'source: {expected}' and a 64-hex 'source_hash'")
            errors += 1
            continue
        digest = sha256(source)
        if meta["source_hash"] == digest:
            continue
        if fix is not None and (not fix or target.resolve() in fix):
            set_hash(target, digest)
            print(f"{target.relative_to(REPO).as_posix()}: source_hash updated", file=sys.stderr)
            continue
        stale.append(page)
        report("warning", target, f"stale: {expected} changed since the translation; update it, then --fix-hashes")
        if args.mark_stale:
            mark_stale(target, page)

    listed = set(pages)
    for extra in sorted(pl_dir.rglob("*.md")):
        rel = extra.relative_to(pl_dir)
        if rel.as_posix() not in listed and not any(part.startswith(".") for part in rel.parts):
            report("error", extra, "no English page in docs/zensical.toml's nav: delete it or add the English page")
            errors += 1

    print(
        f"Polish docs: {len(pages)} pages, {errors} errors, {len(stale)} stale.",
        file=sys.stderr,
    )
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
