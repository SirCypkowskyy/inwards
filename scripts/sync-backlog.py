"""Sync .claude/plan/backlog.yaml to GitHub: labels, milestones, epics, issues.

RETIRED (2026-09-25): kept for history only. GitHub issues are the source of
truth for the plan now. Don't run this script or edit the YAML to change the
plan; a run would fight edits made on GitHub. See "Source of truth" in CLAUDE.md.

    python3 scripts/sync-backlog.py --check     # offline validation only
    python3 scripts/sync-backlog.py --dry-run   # validation + what would change on GitHub
    python3 scripts/sync-backlog.py             # apply

Idempotent and conservative:
- Every issue and milestone carries a hidden `backlog-key` marker; re-runs update
  in place and never duplicate. Duplicate markers abort the run.
- Unchanged issues aren't touched. Ticked acceptance checkboxes survive re-runs.
- The marker holds a hash of the last rendered body; if a human edited the body
  since, the body is left alone (and reported) unless --force is given.
- Only managed labels (type:, priority:, size:, area:) are added or removed;
  other labels and existing assignees are left alone.
- Epics link their issues as native sub-issues; `blocked_by` becomes native issue
  dependencies, including removal of edges dropped from the YAML.
- Issues whose key vanished from the YAML are reported; with --close-orphans (at
  most 3 per run) they are closed as not planned and labelled backlog:orphaned.
"""

import argparse
import hashlib
import json
import re
import subprocess
import sys
import time
from pathlib import Path

import yaml

REPO = "SirCypkowskyy/inwards"
ROOT = Path(__file__).resolve().parent.parent
PLAN = ROOT / ".claude" / "plan" / "backlog.yaml"
MARK = "<!-- backlog-key: {} -->"
MARK_RE = re.compile(r"<!-- backlog-key: ([\w-]+)(?: sha=([0-9a-f]+))? -->")
KEY_TOKEN = re.compile(r"\bE\d-[a-z0-9-]+")
ORPHAN_LABEL = "backlog:orphaned"
MAX_ORPHANS = 3
MANAGED = ("type:", "priority:", "size:", "area:")
DAYS = {"S": 1, "M": 2.5, "L": 5}


# ---------------------------------------------------------------- validation

def validate(plan: dict) -> list[str]:
    errors = []
    labels = {l["name"] for l in plan["labels"]}
    order = {e["key"]: n for n, e in enumerate(plan["epics"])}
    owner = {}
    for e in plan["epics"]:
        if e["key"] in owner:
            errors.append(f"duplicate key {e['key']}")
        owner[e["key"]] = e["key"]
        for i in e["issues"]:
            if i["key"] in owner:
                errors.append(f"duplicate key {i['key']}")
            owner[i["key"]] = e["key"]
            if not i["key"].startswith(e["key"] + "-"):
                errors.append(f"{i['key']} lives in {e['key']} but its prefix says otherwise")
            for l in labels_for(i):
                if l not in labels:
                    errors.append(f"{i['key']}: unknown label {l}")
            for field in ("why", "scope", "acceptance"):
                if not i.get(field):
                    errors.append(f"{i['key']}: missing {field}")
    for e in plan["epics"]:
        for i in e["issues"]:
            for b in i.get("blocked_by", []):
                if b not in owner:
                    errors.append(f"{i['key']}: blocked_by unknown {b}")
                elif order[owner[b]] > order[e["key"]]:
                    errors.append(f"{i['key']}: blocked_by {b} from a later milestone")
    def strings(node):
        if isinstance(node, str):
            yield node
        elif isinstance(node, list):
            for x in node:
                yield from strings(x)
        elif isinstance(node, dict):
            for k, v in node.items():
                if k not in ("key", "blocked_by"):
                    yield from strings(v)

    for e in plan["epics"]:
        for text in strings(e):
            for token in KEY_TOKEN.findall(text):
                if token not in owner:
                    errors.append(f"{e['key']}: prose mentions unknown key {token}")
    graph = {i["key"]: i.get("blocked_by", []) for e in plan["epics"] for i in e["issues"]}
    state: dict[str, int] = {}

    def visit(k, path):
        if state.get(k) == 1:
            errors.append("cycle: " + " -> ".join(path + [k]))
            return
        if state.get(k) == 2:
            return
        state[k] = 1
        for b in graph.get(k, []):
            visit(b, path + [k])
        state[k] = 2

    for k in graph:
        visit(k, [])
    return errors


# ---------------------------------------------------------------- rendering

def cell(text: str) -> str:
    return text.replace("|", "\\|")


def labels_for(item: dict) -> list[str]:
    return [f"type:{item['type']}", f"priority:{item['priority']}", f"size:{item['size']}", *[f"area:{a}" for a in item["area"]]]


def doc_links(plan, refs):
    return [f"- [{r}]({plan['docs']}/{r})" for r in refs]


def issue_body(plan, epic, item, numbers, titles) -> str:
    lines = [MARK.format(item["key"]), f"**Epic:** #{numbers.get(epic['key'], '?')} · **Milestone:** {epic['milestone']}", ""]
    lines += ["## Why", item["why"], "", "## Scope", *[f"- {s}" for s in item["scope"]], ""]
    lines += ["## Acceptance criteria", *[f"- [ ] {a}" for a in item["acceptance"]], ""]
    if item.get("blocked_by"):
        lines += ["## Blocked by", *[f"- #{numbers.get(b, '?')} {titles[b]}" for b in item["blocked_by"]], ""]
    if item.get("docs"):
        lines += ["## References", *doc_links(plan, item["docs"]), ""]
    return "\n".join(lines).rstrip() + "\n"


def epic_body(plan, epic, numbers) -> str:
    total = sum(DAYS[i["size"]] for i in epic["issues"])
    lines = [MARK.format(epic["key"]), f"**Milestone:** {epic['milestone']} · **Estimate:** ~{total:g} days (S=1, M=2.5, L=5)", ""]
    if epic.get("tentative"):
        lines += ["> [!NOTE]", "> Tentative. Scope depends on the go/no-go decision at the end of M2.", ""]
    lines += ["## Goal", epic["goal"], "", "## Exit criteria", *[f"- [ ] {c}" for c in epic["exit_criteria"]], ""]
    lines += ["## Issues", "", "| # | Issue | Priority | Size | Blocked by |", "|---|---|---|---|---|"]
    for i in epic["issues"]:
        deps = ", ".join(f"#{numbers.get(b, '?')}" for b in i.get("blocked_by", [])) or "-"
        lines.append(f"| #{numbers.get(i['key'], '?')} | {cell(i['title'])} | {i['priority']} | {i['size']} | {deps} |")
    lines += ["", "Progress is tracked through the sub-issues of this epic."]
    if epic.get("docs"):
        lines += ["", "## References", *doc_links(plan, epic["docs"])]
    return "\n".join(lines).rstrip() + "\n"


def normalise(body: str) -> str:
    return (body or "").replace("\r\n", "\n").strip()


def content_hash(body: str) -> str:
    """Hash of a body without its marker line and with every checkbox unticked."""
    text = MARK_RE.sub("", normalise(body))
    text = re.sub(r"^- \[[xX]\] ", "- [ ] ", text, flags=re.M)
    return hashlib.sha256(text.strip().encode()).hexdigest()[:12]


def stamp(body: str, key: str) -> str:
    return body.replace(MARK.format(key), f"<!-- backlog-key: {key} sha={content_hash(body)} -->", 1)


def keep_ticks(new: str, old: str) -> str:
    """Carry `[x]` from the current body to identical checklist lines in the new one."""
    ticked = {m.group(1) for m in re.finditer(r"^- \[[xX]\] (.+)$", normalise(old), re.M)}
    return re.sub(r"^- \[ \] (.+)$", lambda m: f"- [x] {m.group(1)}" if m.group(1) in ticked else m.group(0), new, flags=re.M)


# ---------------------------------------------------------------- GitHub

class GitHub:
    def __init__(self, dry: bool):
        self.dry = dry
        self.mutations = 0
        self.failures = 0
        self.fake = -1

    def call(self, method: str, path: str, body=None, ok404=False):
        mutating = method != "GET"
        if mutating and self.dry:
            print(f"  would {method} {path}")
            if method == "POST" and path in ("issues", "milestones"):
                self.fake -= 1  # placeholder so dry runs don't report the same creation twice
                return {"number": self.fake, "id": self.fake, "title": (body or {}).get("title", ""), "body": (body or {}).get("body", ""),
                        "labels": [{"name": n} for n in (body or {}).get("labels", [])], "milestone": None, "assignees": [1], "state": "open"}
            return None
        cmd = ["gh", "api", "-X", method, f"repos/{REPO}/{path}", "-H", "X-GitHub-Api-Version: 2022-11-28"]
        if body is not None:
            cmd += ["--input", "-"]
        for attempt in range(5):
            run = subprocess.run(cmd, input=json.dumps(body) if body is not None else None, text=True, capture_output=True)
            if run.returncode == 0:
                if mutating:
                    self.mutations += 1
                    time.sleep(1.0)  # stay well under GitHub's secondary rate limits
                return json.loads(run.stdout) if run.stdout.strip() else None
            out = run.stdout + run.stderr
            if ok404 and "404" in out:
                return None
            if any(code in out for code in ("429", "secondary rate limit", "abuse")) or ("403" in out and "rate" in out.lower()):
                wait = 30 * (attempt + 1)
                print(f"  rate limited, sleeping {wait}s", file=sys.stderr)
                time.sleep(wait)
                continue
            raise RuntimeError(f"{method} {path}: {out.strip()[:400]}")
        raise RuntimeError(f"{method} {path}: gave up after retries")

    def all(self, path: str) -> list:
        for attempt in range(5):
            run = subprocess.run(["gh", "api", "--paginate", "--slurp", f"repos/{REPO}/{path}"], text=True, capture_output=True)
            if run.returncode == 0:
                return [item for page in json.loads(run.stdout) for item in page]
            print(f"  GET {path} failed, retrying: {run.stderr.strip()[:200]}", file=sys.stderr)
            time.sleep(15 * (attempt + 1))
        raise RuntimeError(f"GET {path}: gave up after retries")

    def fail(self, what: str, err: Exception) -> None:
        self.failures += 1
        print(f"FAILED {what}: {err}", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="validate the YAML offline and exit")
    ap.add_argument("--dry-run", action="store_true", help="show intended mutations without making them")
    ap.add_argument("--force", action="store_true", help="overwrite bodies that were edited by hand")
    ap.add_argument("--close-orphans", action="store_true", help=f"close issues whose key left the YAML (max {MAX_ORPHANS})")
    args = ap.parse_args()

    plan = yaml.safe_load(PLAN.read_text())
    errors = validate(plan)
    if errors:
        sys.exit("backlog.yaml is invalid:\n  " + "\n  ".join(errors))
    for e in plan["epics"]:
        total = sum(DAYS[i["size"]] for i in e["issues"])
        print(f"{e['milestone']:<44} {len(e['issues']):2} issues ~{total:g}d")
    if args.check:
        return

    gh = GitHub(args.dry_run)
    me = json.loads(subprocess.run(["gh", "api", "user"], text=True, capture_output=True, check=True).stdout)["login"]
    items = [(e, i) for e in plan["epics"] for i in e["issues"]]
    titles = {i["key"]: i["title"] for _, i in items} | {e["key"]: e["title"] for e in plan["epics"]}
    wanted = set(titles)

    # Labels
    existing_labels = {l["name"]: l for l in gh.all("labels")}
    for l in plan["labels"]:
        cur = existing_labels.get(l["name"])
        if not cur:
            gh.call("POST", "labels", l)
        elif cur["color"] != l["color"] or (cur.get("description") or "") != l["description"]:
            gh.call("PATCH", f"labels/{l['name'].replace(':', '%3A')}", {"color": l["color"], "description": l["description"]})

    if ORPHAN_LABEL not in existing_labels:
        gh.call("POST", "labels", {"name": ORPHAN_LABEL, "color": "ededed", "description": "Closed by sync-backlog.py because its key left the plan"})

    # Milestones, matched by marker in the description (title as fallback)
    ms_by_key = {}
    for m in gh.all("milestones?state=all"):
        found = MARK_RE.search(m.get("description") or "")
        ms_by_key[found.group(1) if found else f"title:{m['title']}"] = m
    ms_number = {}
    for e in plan["epics"]:
        desc = ("Tentative: depends on the M2 go/no-go decision.\n\n" if e.get("tentative") else "") + f"{e['goal']}\n\nExit criteria:\n" + "\n".join(f"- {c}" for c in e["exit_criteria"]) + "\n\n" + MARK.format(e["key"])
        cur = ms_by_key.get(e["key"]) or ms_by_key.get(f"title:{e['milestone']}")
        if not cur:
            cur = gh.call("POST", "milestones", {"title": e["milestone"], "description": desc}) or {"number": 0}
        elif cur["title"] != e["milestone"] or cur.get("description") != desc:
            gh.call("PATCH", f"milestones/{cur['number']}", {"title": e["milestone"], "description": desc})
        ms_number[e["key"]] = cur["number"]

    # Existing managed issues (pull requests filtered out)
    found: dict[str, dict] = {}
    for iss in gh.all("issues?state=all&per_page=100"):
        if "pull_request" in iss:
            continue
        m = MARK_RE.search(iss.get("body") or "")
        if not m:
            continue
        if m.group(1) in found:
            sys.exit(f"duplicate marker {m.group(1)}: #{found[m.group(1)]['number']} and #{iss['number']}; fix by hand first")
        found[m.group(1)] = iss
    numbers = {k: v["number"] for k, v in found.items()}
    ids = {k: v["id"] for k, v in found.items()}

    def upsert(key, title, body, labels, milestone):
        cur = found.get(key)
        if not cur:
            new = gh.call("POST", "issues", {"title": title, "body": stamp(body, key), "labels": labels, "milestone": milestone, "assignees": [me]})
            if new:
                found[key], numbers[key], ids[key] = new, new["number"], new["id"]
            return
        old = normalise(cur.get("body") or "")
        stored = MARK_RE.search(old)
        edited = stored and stored.group(2) and stored.group(2) != content_hash(old)
        body = stamp(keep_ticks(body, old), key)
        have = [l["name"] for l in cur["labels"]]
        merged = sorted({l for l in have if not l.startswith(MANAGED)} | set(labels))
        patch = {}
        if cur["title"] != title:
            patch["title"] = title
        if old != normalise(body) and content_hash(old) != content_hash(body):
            if edited and not args.force:
                print(f"#{cur['number']} ({key}) was edited by hand; body left as is (use --force to overwrite)")
            else:
                patch["body"] = body
        if sorted(have) != merged:
            patch["labels"] = merged
        if (cur.get("milestone") or {}).get("number") != milestone:
            patch["milestone"] = milestone
        if not cur.get("assignees"):
            patch["assignees"] = [me]
        if cur["state"] == "closed" and ORPHAN_LABEL in have:
            patch["state"] = "open"  # key came back into the plan
            patch["labels"] = [l for l in patch.get("labels", merged) if l != ORPHAN_LABEL]
        if patch:
            updated = gh.call("PATCH", f"issues/{cur['number']}", patch)
            if updated:
                found[key] = updated

    def render_all():
        for e in plan["epics"]:
            upsert(e["key"], f"[Epic] {e['title']}", epic_body(plan, e, numbers), ["type:epic"], ms_number[e["key"]])
        for e, i in items:
            upsert(i["key"], i["title"], issue_body(plan, e, i, numbers, titles), labels_for(i), ms_number[e["key"]])

    render_all()  # creates what's missing (bodies may hold '?' for new numbers)
    render_all()  # fills in numbers; unchanged issues are skipped

    # Orphans: managed issues whose key left the plan
    orphans = [(k, iss) for k, iss in sorted(found.items()) if k not in wanted and iss["state"] == "open"]
    for key, iss in orphans:
        print(f"orphan {key} (#{iss['number']})")
    if orphans and args.close_orphans:
        if len(orphans) > MAX_ORPHANS:
            sys.exit(f"{len(orphans)} orphans is more than {MAX_ORPHANS}; is the YAML truncated? Close them by hand.")
        for key, iss in orphans:
            labels = sorted({l["name"] for l in iss["labels"]} | {ORPHAN_LABEL})
            gh.call("PATCH", f"issues/{iss['number']}", {"state": "closed", "state_reason": "not_planned", "labels": labels})

    (ROOT / ".claude" / "plan" / "issue-map.json").write_text(json.dumps(dict(sorted(numbers.items())), indent=2) + "\n")

    if args.dry_run:
        print("dry run: sub-issues and dependencies not computed")
        return

    # Sub-issues (epic -> issue), moving between epics with replace_parent
    for e, i in items:
        try:
            children = {s["number"] for s in gh.call("GET", f"issues/{numbers[e['key']]}/sub_issues?per_page=100") or []}
            if numbers[i["key"]] not in children:
                gh.call("POST", f"issues/{numbers[e['key']]}/sub_issues", {"sub_issue_id": ids[i["key"]], "replace_parent": True})
        except RuntimeError as err:
            gh.fail(f"sub-issue {i['key']}", err)

    # Dependencies: add missing, remove stale (only between managed issues)
    managed_numbers = {n: k for k, n in numbers.items()}
    for _, i in items:
        want = {numbers[b] for b in i.get("blocked_by", [])}
        try:
            have = {d["number"]: d["id"] for d in gh.call("GET", f"issues/{numbers[i['key']]}/dependencies/blocked_by?per_page=100", ok404=True) or []}
        except RuntimeError as err:
            gh.fail(f"dependencies {i['key']}", err)
            continue
        for b in i.get("blocked_by", []):
            if numbers[b] not in have:
                try:
                    gh.call("POST", f"issues/{numbers[i['key']]}/dependencies/blocked_by", {"issue_id": ids[b]})
                except RuntimeError as err:
                    gh.fail(f"dependency {i['key']} <- {b}", err)
        for n, dep_id in have.items():
            if n in managed_numbers and n not in want:
                try:
                    gh.call("DELETE", f"issues/{numbers[i['key']]}/dependencies/blocked_by/{dep_id}")
                except RuntimeError as err:
                    gh.fail(f"remove dependency {i['key']} <- #{n}", err)

    print(f"done: {gh.mutations} mutations, {gh.failures} failures")
    if gh.failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
