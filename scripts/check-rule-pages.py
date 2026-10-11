"""Check every rule page against the page contract and write the rule index data.

Each rule has a page in docs/chapters/rules/ and its Polish translation in
docs/pl/rules/ (issue #49). This script (issue #145) checks both languages
against that contract and, in the same pass, writes the data the filterable
rule browser on rules/index.md reads, so the pages are parsed only once:

    uv run scripts/check-rule-pages.py           # check; fail if rules.json is out of date
    uv run scripts/check-rule-pages.py --write   # check, then rewrite both rules.json files

The contract, per page:

- front matter in the OKF format: `type: rule` (OKF's one required key),
  `title` and `description`;
- the Inwards keys: `code` (the file name), `name`, `severity`, `suppressible`
  and `autofix` (booleans), `status` (stable, in-development, in-review or
  backlog), `tags` (the category path, parent first, whose first tag is one
  of CATEGORIES), `resource` (the rule's
  source file under src/core/src/, which must exist), `timestamp` or a
  `sources[].last_modified`, and `related_issues`;
- an h1 with the code, then the sections What it does, Why is this bad,
  Example and Fix safety, each with text. Sections are found by their anchor
  (`what-it-does`, ...), which Polish headings keep with `{ #id }`. The
  Example section holds at least one flagged and one fixed code block;
- a seven-cell row in its language's rules/index.md, in the table under the
  h2 whose anchor is the page's category (issue #337), with the sections in
  CATEGORIES order. Its name, severity and inline suppression cells agree
  with the front matter, and its on cell says "by default" or "opt-in"
  (rule-pages.test.ts checks that cell, and the presets cell, against the
  registry and the `inwards init` presets);
- a row in its category's page, rules/<category>/index.md (issue #381), whose
  code, name, what-it-flags and on cells match the index row, and no row in
  another category's page;
- an entry in its category's group of the Rules section in both Zensical
  configs' nav (issue #381). The section holds the index, then one group per
  category in CATEGORIES order, each opening with its category page, so the
  sidebar draws the rules as a tree. scripts/check-docs-nav.py runs the same
  nav check through `nav_problems`.

A Polish page also carries the English page's metadata, apart from its
translated `description` (src/cli/test/integration/rule-pages.test.ts checks
the same against the rule registry). Every problem is printed, one per line,
as a GitHub annotation in Actions; the exit code is 1 if there was any.
"""

import argparse
import datetime
import json
import os
import re
import sys
import tomllib
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
SITES = {"en": REPO / "docs/chapters/rules", "pl": REPO / "docs/pl/rules"}
# Each site's Zensical config, whose nav holds the rules tree (issue #381).
CONFIGS = {"en": REPO / "docs/zensical.toml", "pl": REPO / "docs/zensical.pl.toml"}
DATA_FILE = "rules.json"
SOURCE_PREFIX = "https://github.com/SirCypkowskyy/inwards/blob/develop/"

FRONT_MATTER = re.compile(r"\A---\n(?P<body>.*?\n)---\n", re.DOTALL)
CODE = re.compile(r"[A-Z]+[0-9]{3}")
KEBAB = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
STATUSES = ("stable", "in-review", "in-development", "backlog")
SEVERITIES = ("error", "warning")
REQUIRED_SECTIONS = ("what-it-does", "why-is-this-bad", "example", "fix-safety")
# The rule categories (issue #337), in the order the index and chapter 3 list
# them. A rule's first tag is one of these, and a new rule picks one; add a
# category here, to the index (both languages) and to chapter 3 together.
CATEGORIES = ("imports", "layout", "roles", "integrity", "diagrams", "fastapi")
# What the index's on cell says for a rule that reports without being selected, and for one that doesn't.
ON_OFF = {"en": ("by default", "opt-in"), "pl": ("domyślnie", "opt-in")}
# The word the index's severity cell starts with, per front matter severity.
SEVERITY_WORDS = {"en": {"error": "error", "warning": "warning"}, "pl": {"error": "błąd", "warning": "ostrzeżenie"}}
# What the index's inline suppression column says, per language.
YES_NO = {"en": ("yes", "no"), "pl": ("tak", "nie")}
# Keys a translation changes or adds; every other key must equal the English page's.
TRANSLATED_KEYS = {"description", "source", "source_hash"}

FENCE = re.compile(r"^\s*(?P<mark>`{3,}|~{3,})")
HEADING = re.compile(r"^(?P<hashes>#{1,6})\s+(?P<text>.*?)\s*$")
ATTR_ID = re.compile(r"\s*\{[^}]*#(?P<id>[\w-]+)[^}]*\}\s*$")
COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
INDEX_ROW = re.compile(r"^\|\s*\[(?P<code>[A-Z]+[0-9]{3})\]\((?P=code)\.md\)\s*\|")
CATEGORY_ROW = re.compile(r"^\|\s*\[(?P<code>[A-Z]+[0-9]{3})\]\(\.\./(?P=code)\.md\)\s*\|")
RULE_PAGE = re.compile(r"rules/(?P<code>[A-Z]+[0-9]{3})\.md")


class Page:
    """One rule page, read once: its front matter, headings and body lines."""

    def __init__(self, path: Path) -> None:
        """Read and split the page; parse problems are kept in `problems`."""
        self.path = path
        self.problems: list[str] = []
        self.meta: dict = {}
        text = path.read_text(encoding="utf-8")
        match = FRONT_MATTER.match(text)
        if not match:
            self.problems.append("no front matter: the page must start with a '---' block")
            self.lines = text.splitlines()
            return
        try:
            loaded = yaml.safe_load(match["body"])
        except yaml.YAMLError as error:
            self.problems.append(f"front matter is not valid YAML: {error}")
            loaded = {}
        if isinstance(loaded, dict):
            self.meta = loaded
        else:
            self.problems.append("front matter must be a mapping of keys to values")
        self.lines = text[match.end() :].splitlines()

    def headings(self) -> list[tuple[int, int, str, str]]:
        """List the page's ATX headings outside code blocks as (line, level, id, text)."""
        found = []
        fence = ""
        for number, line in enumerate(self.lines):
            mark = FENCE.match(line)
            if mark:
                if not fence:
                    fence = mark["mark"]
                elif mark["mark"][0] == fence[0] and len(mark["mark"]) >= len(fence) and not line.strip()[len(mark["mark"]) :].strip():
                    fence = ""
                continue
            heading = HEADING.match(line) if not fence else None
            if heading:
                text = heading["text"]
                explicit = ATTR_ID.search(text)
                if explicit:
                    text = text[: explicit.start()]
                anchor = explicit["id"] if explicit else slugify(text)
                found.append((number, len(heading["hashes"]), anchor, text))
        return found

    def section(self, anchor: str) -> tuple[int, list[str]] | None:
        """Return a section's level and body lines (subsections included), or None."""
        headings = self.headings()
        for index, (line, level, found, _text) in enumerate(headings):
            if found != anchor:
                continue
            end = next((h[0] for h in headings[index + 1 :] if h[1] <= level), len(self.lines))
            return level, self.lines[line + 1 : end]
        return None


def slugify(text: str) -> str:
    """Make the anchor Python-Markdown's toc gives a heading: 'Fix safety' -> 'fix-safety'."""
    text = re.sub(r"<[^>]+>", "", text).replace("`", "")
    text = re.sub(r"[^\w\s-]", "", text).strip().lower()
    return re.sub(r"[-\s]+", "-", text)


def split_row(line: str) -> list[str]:
    """Split a Markdown table row into trimmed cells, keeping pipes inside code spans."""
    cells, cell, in_code = [], "", False
    for char in line.strip().strip("|"):
        if char == "`":
            in_code = not in_code
        if char == "|" and not in_code:
            cells.append(cell.strip())
            cell = ""
        else:
            cell += char
    cells.append(cell.strip())
    return cells


def plain(value: object) -> object:
    """Turn YAML dates into ISO strings, so front matter compares and serialises as text."""
    if isinstance(value, (datetime.date, datetime.datetime)):
        return value.isoformat().replace("+00:00", "Z")
    if isinstance(value, list):
        return [plain(item) for item in value]
    if isinstance(value, dict):
        return {key: plain(item) for key, item in value.items()}
    return value


def check_meta(page: Page) -> list[str]:
    """Check a page's front matter against the contract; return the problems."""
    meta, problems = page.meta, []

    def need(key: str, test: bool, what: str) -> None:
        """Record a problem when `key` is missing or fails `test`."""
        if key not in meta:
            problems.append(f"front matter: missing '{key}' ({what})")
        elif not test:
            problems.append(f"front matter: '{key}' must be {what}, got {meta[key]!r}")

    def text(key: str) -> bool:
        """Whether a key holds a non-empty string."""
        return isinstance(meta.get(key), str) and bool(meta[key].strip())

    need("type", meta.get("type") == "rule", "'rule', the OKF type of a rule page")
    need("code", meta.get("code") == page.path.stem and bool(CODE.fullmatch(str(meta.get("code")))), f"the file name, {page.path.stem}")
    need("title", text("title") and str(meta.get("title")).startswith(f"{meta.get('code')} "), "the code, a space and the name")
    need("description", text("description"), "a one to three sentence summary")
    need("name", isinstance(meta.get("name"), str) and bool(KEBAB.fullmatch(meta["name"])), "the rule's kebab-case name")
    need("severity", meta.get("severity") in SEVERITIES, f"one of {', '.join(SEVERITIES)}")
    need("suppressible", isinstance(meta.get("suppressible"), bool), "true or false")
    need("autofix", isinstance(meta.get("autofix"), bool), "true or false: does a fix apply unattended")
    need("status", meta.get("status") in STATUSES, f"one of {', '.join(STATUSES)}")
    tags = meta.get("tags")
    need(
        "tags",
        isinstance(tags, list) and bool(tags) and all(isinstance(t, str) and KEBAB.fullmatch(t) for t in tags),
        "the category path, parent first, as a list of kebab-case names",
    )
    if isinstance(tags, list) and tags and tags[0] not in CATEGORIES:
        problems.append(f"front matter: the first tag must be the rule's category, one of {', '.join(CATEGORIES)}; got {tags[0]!r}")
    resource = meta.get("resource")
    source = resource.removeprefix(SOURCE_PREFIX) if isinstance(resource, str) else ""
    need(
        "resource",
        isinstance(resource, str) and resource.startswith(f"{SOURCE_PREFIX}src/core/src/") and (REPO / source).is_file(),
        f"a link to the rule's source file that exists, {SOURCE_PREFIX}src/core/src/...",
    )
    sources = meta.get("sources")
    shipped = "timestamp" in meta or (
        isinstance(sources, list) and any(isinstance(s, dict) and "last_modified" in s for s in sources)
    )
    if not shipped:
        problems.append("front matter: missing 'timestamp' (or a 'sources' entry with 'last_modified'): when the rule shipped")
    issues = meta.get("related_issues")
    need(
        "related_issues",
        isinstance(issues, list) and all(isinstance(n, int) and not isinstance(n, bool) for n in issues),
        "a list of issue numbers",
    )
    return problems


def check_body(page: Page) -> list[str]:
    """Check a page's h1 and required sections; return the problems."""
    problems = []
    code = str(page.meta.get("code", page.path.stem))
    titles = [h for h in page.headings() if h[1] == 1]
    if not titles or code not in titles[0][3]:
        problems.append(f"body: needs an h1 with the rule code, '# {code} ...'")
    for anchor in REQUIRED_SECTIONS:
        found = page.section(anchor)
        if found is None:
            problems.append(f"body: missing the '{anchor}' section (an h2 with that anchor)")
            continue
        level, lines = found
        body = COMMENT.sub("", "\n".join(lines)).strip()
        if level != 2:
            problems.append(f"body: the '{anchor}' section must be an h2, not an h{level}")
        if not body:
            problems.append(f"body: the '{anchor}' section is empty")
        if anchor == "example":
            fences = sum(1 for line in lines if FENCE.match(line)) // 2
            if fences < 2:
                problems.append("body: the 'example' section needs a flagged and a fixed code block, found " f"{fences}")
    return problems


def index_rows(site: str, path: Path) -> dict[str, tuple[str, list[str]]]:
    """Read the rule tables of a site's rules/index.md: code -> (the h2 anchor above it, its cells), in page order."""
    rows: dict[str, tuple[str, list[str]]] = {}
    section = ""
    for line in path.read_text(encoding="utf-8").splitlines():
        heading = HEADING.match(line)
        if heading and len(heading["hashes"]) == 2:
            explicit = ATTR_ID.search(heading["text"])
            section = explicit["id"] if explicit else slugify(heading["text"])
        match = INDEX_ROW.match(line)
        if match:
            rows[match["code"]] = (section, split_row(line))
    return rows


def check_sections(rows: dict[str, tuple[str, list[str]]]) -> list[str]:
    """Check that the index lists its category sections in CATEGORIES order, each once."""
    order = [section for section, _cells in rows.values()]
    seen = [s for i, s in enumerate(order) if i == 0 or order[i - 1] != s]
    problems = [f"rules/index.md: a rule table sits under '#{s}', which is no category" for s in seen if s not in CATEGORIES]
    known = [s for s in seen if s in CATEGORIES]
    if known != sorted(set(known), key=CATEGORIES.index):
        problems.append(f"rules/index.md: the category sections must come once each, in the order {', '.join(CATEGORIES)}; found {', '.join(seen)}")
    return problems


def category_rows(path: Path) -> dict[str, list[str]]:
    """Read a category page's rule table: code -> its cells (code, name, what it flags, on)."""
    if not path.is_file():
        return {}
    rows = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        match = CATEGORY_ROW.match(line)
        if match:
            rows[match["code"]] = split_row(line)
    return rows


def check_category_pages(site: str, categories: dict[str, str], rows: dict[str, tuple[str, list[str]]]) -> list[tuple[Path, str]]:
    """Check each category page of a site: it exists and lists exactly its category's rules, as the index does."""
    problems = []
    for category in CATEGORIES:
        path = SITES[site] / category / "index.md"
        if not path.is_file():
            problems.append((path, f"missing: the page of the '{category}' category, which the nav opens its group with"))
            continue
        listed = category_rows(path)
        for code, cells in listed.items():
            if categories.get(code) != category:
                problems.append((path, f"lists {code}, whose category is {categories.get(code)!r}, not '{category}'"))
                continue
            index_cells = rows.get(code, ("", []))[1]
            if len(index_cells) == 7 and cells != [f"[{code}](../{code}.md)", *index_cells[1:4]]:
                problems.append((path, f"the row of {code} must repeat the index row's code, name, what-it-flags and on cells"))
        for code in sorted(c for c, cat in categories.items() if cat == category and c not in listed):
            problems.append((path, f"no row for {code}: a rule's category page lists it (| [{code}](../{code}.md) | ...)"))
    return problems


def rules_section(nav: list) -> list | None:
    """Find the nav section that holds rules/index.md, the Rules tab, and return its entries."""
    for entry in nav:
        if isinstance(entry, dict):
            for value in entry.values():
                if isinstance(value, list) and any(item == "rules/index.md" or (isinstance(item, dict) and "rules/index.md" in item.values()) for item in value):
                    return value
    return None


def nav_pages_in(entry: object) -> list[str]:
    """List the page paths in a nav entry, at any depth, in order."""
    if isinstance(entry, str):
        return [entry]
    if isinstance(entry, list):
        return [page for item in entry for page in nav_pages_in(item)]
    if isinstance(entry, dict):
        return nav_pages_in(list(entry.values()))
    return []


def nav_problems(site: str, categories: dict[str, str]) -> list[str]:
    """Check a site's nav draws the rules as a tree: one group per category, in order, each holding its rules.

    `categories` maps a rule code to its category (the page's first tag). The
    Rules section must hold rules/index.md and then exactly one group per
    category, in CATEGORIES order; a group opens with rules/<category>/index.md
    (its title links there, through navigation.indexes) and lists the pages of
    that category's rules, and only those. A rule page anywhere else in the nav
    is a problem too, so a new rule can't land outside its group.
    """
    nav = tomllib.loads(CONFIGS[site].read_text(encoding="utf-8"))["project"].get("nav", [])
    section = rules_section(nav)
    if section is None:
        return ["nav: no section holds rules/index.md"]
    problems = []
    groups: dict[str, list[str]] = {}
    order = []
    for entry in section:
        pages = nav_pages_in(entry)
        if not isinstance(entry, dict) or not any(isinstance(v, list) for v in entry.values()):
            if pages != ["rules/index.md"]:
                problems.append(f"the Rules section holds {', '.join(pages)} outside a category group")
            continue
        first = pages[0] if pages else ""
        match = re.fullmatch(r"rules/(?P<category>[a-z-]+)/index\.md", first)
        if not match or match["category"] not in CATEGORIES:
            problems.append(f"the Rules group {', '.join(entry)} must open with rules/<category>/index.md for one of {', '.join(CATEGORIES)}")
            continue
        order.append(match["category"])
        groups[match["category"]] = pages[1:]
    if order != list(CATEGORIES):
        problems.append(f"the Rules groups must be {', '.join(CATEGORIES)}, in that order; found {', '.join(order) or 'none'}")
    for category, pages in groups.items():
        for page in pages:
            found = RULE_PAGE.fullmatch(page)
            if not found:
                problems.append(f"the {category} group holds {page}, which is no rule page")
            elif categories.get(found["code"]) != category:
                problems.append(f"{page} sits in the {category} group, but its category is {categories.get(found['code'])!r}")
    placed = {RULE_PAGE.fullmatch(p)["code"] for pages in groups.values() for p in pages if RULE_PAGE.fullmatch(p)}
    elsewhere = {m["code"] for p in nav_pages_in(nav) if (m := RULE_PAGE.fullmatch(p))} - placed
    for code in sorted(set(categories) - placed):
        where = "outside its group" if code in elsewhere else "missing"
        problems.append(f"rules/{code}.md is {where}: list it in the {categories[code]} group of the Rules section")
    return problems


def category_of(page: Page) -> str:
    """A rule page's category, the first tag of its front matter, or "" when it has none."""
    tags = page.meta.get("tags")
    return tags[0] if isinstance(tags, list) and tags and isinstance(tags[0], str) else ""


def site_categories(site: str) -> dict[str, str]:
    """Map each rule page of a site to its category (pages without one are left out)."""
    pages = (Page(path) for path in sorted(SITES[site].glob("*.md")) if path.name != "index.md")
    return {page.path.stem: category_of(page) for page in pages if category_of(page)}


def rule_entry(site: str, page: Page, row: list[str]) -> dict:
    """The rule browser's record of one rule: front matter plus its index row's text."""
    meta = page.meta
    on_by_default = row[3] == ON_OFF[site][0]
    return {
        "code": meta["code"],
        "name": meta["name"],
        "title": meta["title"],
        "summary": row[2],
        "description": meta["description"].strip(),
        "category": meta["tags"],
        "status": meta["status"],
        "autofix": meta["autofix"],
        "severity": meta["severity"],
        "suppressible": meta["suppressible"],
        "default": row[4] if on_by_default else f"{row[3]}, {row[4]}",
        "presets": row[5],
        "url": f"{meta['code']}/",
    }


def render(value: object, indent: str = "") -> str:
    """Serialise JSON the way Biome formats it: objects expanded, short arrays on one line."""
    if isinstance(value, dict):
        inner = indent + "  "
        items = [f"{inner}{json.dumps(k)}: {render(v, inner)}" for k, v in value.items()]
        return "{\n" + ",\n".join(items) + f"\n{indent}}}" if items else "{}"
    if isinstance(value, list):
        flat = "[" + ", ".join(render(v, indent) for v in value) + "]"
        if all(not isinstance(v, (dict, list)) for v in value) and len(indent) + len(flat) < 80:
            return flat
        inner = indent + "  "
        return "[\n" + ",\n".join(inner + render(v, inner) for v in value) + f"\n{indent}]"
    return json.dumps(value, ensure_ascii=False)


def report(path: Path, message: str) -> None:
    """Print one problem, as a GitHub annotation when running in Actions."""
    rel = path.relative_to(REPO).as_posix()
    if os.environ.get("GITHUB_ACTIONS") == "true":
        print(f"::error file={rel}::{message}")
    else:
        print(f"error: {rel}: {message}", file=sys.stderr)


def main() -> int:
    """Check every rule page in both languages, then check or write rules.json."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--write", action="store_true", help=f"rewrite each site's rules/{DATA_FILE}")
    args = parser.parse_args()

    errors = 0
    failed: set[Path] = set()
    pages: dict[str, dict[str, Page]] = {}
    for site, directory in SITES.items():
        pages[site] = {}
        rows = index_rows(site, directory / "index.md")
        for path in sorted(directory.glob("*.md")):
            if path.name == "index.md":
                continue
            page = Page(path)
            pages[site][path.stem] = page
            problems = page.problems or check_meta(page) + check_body(page)
            section, row = rows.get(path.stem, ("", []))
            yes, no = YES_NO[site]
            category = category_of(page) or None
            if len(row) != 7:
                problems.append(f"no seven-cell row for {path.stem} in a table of rules/index.md")
            elif not page.problems:
                if section != category:
                    problems.append(f"rules/index.md: the row sits under '#{section}', but the page's category is {category!r}")
                if row[1] != f"`{page.meta.get('name')}`":
                    problems.append(f"rules/index.md: the name cell says {row[1]}, the front matter `{page.meta.get('name')}`")
                if row[3] not in ON_OFF[site]:
                    problems.append(f"rules/index.md: the on cell says '{row[3]}', not one of {', '.join(ON_OFF[site])}")
                word = SEVERITY_WORDS[site].get(str(page.meta.get("severity")), "")
                if not word or not row[4].startswith(word):
                    problems.append(f"rules/index.md: the severity cell says '{row[4]}', but severity is {page.meta.get('severity')}")
                if not row[5]:
                    problems.append("rules/index.md: the presets cell is empty")
                if row[6] != (yes if page.meta.get("suppressible") else no):
                    problems.append(f"rules/index.md: the inline suppression cell says '{row[6]}', but suppressible is {page.meta.get('suppressible')}")
            for problem in problems:
                report(path, problem)
            errors += len(problems)
            if problems:
                failed.add(path)
        for code in sorted(set(rows) - set(pages[site])):
            report(directory / "index.md", f"the table lists {code}, which has no page")
            errors += 1
        for problem in check_sections(rows):
            report(directory / "index.md", problem)
            errors += 1
        categories = {code: category_of(page) for code, page in pages[site].items() if category_of(page)}
        for path, problem in check_category_pages(site, categories, rows):
            report(path, problem)
            errors += 1
        for problem in nav_problems(site, categories):
            report(CONFIGS[site], problem)
            errors += 1

    for code, page in pages["pl"].items():
        english = pages["en"].get(code)
        if english is None or {page.path, english.path} & failed:
            continue  # its own problems are reported already
        en_meta = {k: plain(v) for k, v in english.meta.items() if k not in TRANSLATED_KEYS}
        pl_meta = {k: plain(v) for k, v in page.meta.items() if k not in TRANSLATED_KEYS}
        for key in sorted(set(en_meta) | set(pl_meta)):
            if en_meta.get(key) != pl_meta.get(key):
                report(page.path, f"front matter: '{key}' differs from the English page; only 'description' is translated")
                errors += 1

    if errors:
        print(f"{errors} problem(s) in the rule pages; the contract is in this script's docstring", file=sys.stderr)
        return 1

    stale = 0
    for site, directory in SITES.items():
        rows = index_rows(site, directory / "index.md")
        rules = [rule_entry(site, pages[site][code], row) for code, (_section, row) in rows.items()]
        content = render(plain({"rules": rules})) + "\n"
        target = directory / DATA_FILE
        if args.write:
            if not target.exists() or target.read_text(encoding="utf-8") != content:
                target.write_text(content, encoding="utf-8")
                print(f"{target.relative_to(REPO).as_posix()}: written", file=sys.stderr)
        elif not target.exists() or target.read_text(encoding="utf-8") != content:
            report(target, "out of date with the rule pages: run uv run scripts/check-rule-pages.py --write")
            stale += 1
    total = sum(len(site) for site in pages.values())
    if not stale:
        print(f"{total} rule pages match the contract", file=sys.stderr)
    return 1 if stale else 0


if __name__ == "__main__":
    sys.exit(main())
