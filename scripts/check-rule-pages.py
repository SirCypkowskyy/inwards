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
  backlog), `tags` (the category path, parent first), `resource` (the rule's
  source file under src/core/src/, which must exist), `timestamp` or a
  `sources[].last_modified`, and `related_issues`;
- an h1 with the code, then the sections What it does, Why is this bad,
  Example and Fix safety, each with text. Sections are found by their anchor
  (`what-it-does`, ...), which Polish headings keep with `{ #id }`. The
  Example section holds at least one flagged and one fixed code block;
- a row in its language's rules/index.md table, whose name and inline
  suppression cells agree with the front matter.

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
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
SITES = {"en": REPO / "docs/chapters/rules", "pl": REPO / "docs/pl/rules"}
DATA_FILE = "rules.json"
SOURCE_PREFIX = "https://github.com/SirCypkowskyy/inwards/blob/develop/"

FRONT_MATTER = re.compile(r"\A---\n(?P<body>.*?\n)---\n", re.DOTALL)
CODE = re.compile(r"[A-Z]+[0-9]{3}")
KEBAB = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
STATUSES = ("stable", "in-review", "in-development", "backlog")
SEVERITIES = ("error", "warning")
REQUIRED_SECTIONS = ("what-it-does", "why-is-this-bad", "example", "fix-safety")
# What the index's inline suppression column says, per language.
YES_NO = {"en": ("yes", "no"), "pl": ("tak", "nie")}
# Keys a translation changes or adds; every other key must equal the English page's.
TRANSLATED_KEYS = {"description", "source", "source_hash"}

FENCE = re.compile(r"^\s*(?P<mark>`{3,}|~{3,})")
HEADING = re.compile(r"^(?P<hashes>#{1,6})\s+(?P<text>.*?)\s*$")
ATTR_ID = re.compile(r"\s*\{[^}]*#(?P<id>[\w-]+)[^}]*\}\s*$")
COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
INDEX_ROW = re.compile(r"^\|\s*\[(?P<code>[A-Z]+[0-9]{3})\]\((?P=code)\.md\)\s*\|")


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


def index_rows(site: str, path: Path) -> dict[str, list[str]]:
    """Read the rule tables of a site's rules/index.md: code -> its cells, in page order."""
    rows: dict[str, list[str]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        match = INDEX_ROW.match(line)
        if match:
            rows[match["code"]] = split_row(line)
    return rows


def rule_entry(page: Page, row: list[str]) -> dict:
    """The rule browser's record of one rule: front matter plus its index row's text."""
    meta = page.meta
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
        "default": row[3],
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
            row = rows.get(path.stem)
            yes, no = YES_NO[site]
            if row is None or len(row) != 5:
                problems.append(f"no five-cell row for {path.stem} in the table of rules/index.md")
            elif not page.problems:
                if row[1] != f"`{page.meta.get('name')}`":
                    problems.append(f"rules/index.md: the name cell says {row[1]}, the front matter `{page.meta.get('name')}`")
                if row[4] != (yes if page.meta.get("suppressible") else no):
                    problems.append(f"rules/index.md: the inline suppression cell says '{row[4]}', but suppressible is {page.meta.get('suppressible')}")
            for problem in problems:
                report(path, problem)
            errors += len(problems)
            if problems:
                failed.add(path)
        for code in sorted(set(rows) - set(pages[site])):
            report(directory / "index.md", f"the table lists {code}, which has no page")
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
        rules = [rule_entry(pages[site][code], row) for code, row in rows.items()]
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
