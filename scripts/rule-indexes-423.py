#!/usr/bin/env python3
"""#423: give every engine rule folder (except fastapi/ and shared/) an index.ts
that re-exports what the rest of the engine uses, and make its other modules
private (_name.ts). Imports, docs `resource:` links and fallow zones follow.

Run from the repo root on a tree where a rule folder is still unconverted;
rerun after a rebase conflict (converted folders are skipped; the index is
rebuilt from the importers that still name a public module).
"""
import re
import subprocess
from pathlib import Path

ROOT = Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip())
R = ROOT / "src/core/src/rules"
SKIP = {"fastapi", "shared"}


def git_mv(a: Path, b: Path) -> None:
    subprocess.check_call(["git", "mv", str(a), str(b)], cwd=ROOT)


def sources() -> list[Path]:
    out = []
    for d in ("src", "docs", "scripts"):
        out += [p for p in (ROOT / d).rglob("*") if p.is_file() and "node_modules" not in p.parts
                and p.suffix in (".ts", ".md")]
    return out


# 1. the last single-file rule becomes a folder
pm = R / "private-module.ts"
if pm.exists():
    (R / "private-module").mkdir()
    git_mv(pm, R / "private-module/check.ts")
    f = R / "private-module/check.ts"
    f.write_text(f.read_text().replace('from "../', 'from "../../').replace('from "./shared/', 'from "../shared/'))

folders = sorted(p.name for p in R.iterdir() if p.is_dir() and p.name not in SKIP)

# 2. what does the outside import from each public module?
IMPORT = re.compile(r'(?:import|export)\s+(type\s+)?\{([^}]*)\}\s+from\s+"[^"]*rules/([a-z-]+)/([a-z-]+)\.ts"')
used: dict[str, dict[tuple[str, str], bool]] = {}
for f in sources():
    rel = f.relative_to(ROOT).as_posix()
    if f.suffix != ".ts" or "/test/" in rel or rel.startswith("src/core/src/rules/"):
        continue
    for m in IMPORT.finditer(f.read_text()):
        folder, mod = m.group(3), m.group(4)
        if folder not in folders or mod == "index":
            continue
        for raw in m.group(2).split(","):
            s = raw.strip()
            if not s:
                continue
            is_type = bool(m.group(1)) or s.startswith("type ")
            name = re.sub(r"^type\s+", "", s).split(" as ")[0]
            key = (mod, name)
            used.setdefault(folder, {})[key] = used.get(folder, {}).get(key, True) and is_type

# 3. rename the private modules
renamed: dict[str, list[str]] = {}
for folder in folders:
    for p in sorted((R / folder).glob("*.ts")):
        if p.name == "index.ts" or p.name.startswith("_"):
            continue
        git_mv(p, p.with_name("_" + p.name))
        renamed.setdefault(folder, []).append(p.stem)

# 4. rewrite references (tests keep reaching the private module)
for f in sources():
    rel = f.relative_to(ROOT).as_posix()
    s = o = f.read_text()
    in_folder = rel.split("/")[4] if rel.startswith("src/core/src/rules/") else None
    for folder, mods in renamed.items():
        for mod in mods:
            if in_folder == folder:
                s = s.replace(f'"./{mod}.ts"', f'"./_{mod}.ts"')
            target = f"_{mod}.ts" if "/test/" in rel else "index.ts"
            s = s.replace(f"rules/{folder}/{mod}.ts", f"rules/{folder}/{target}")
    s = s.replace("rules/private-module.ts", "rules/private-module/index.ts")
    if s != o:
        f.write_text(s)

# 5. the indexes
for folder, names in used.items():
    by_mod: dict[str, list[str]] = {}
    for (mod, name), type_only in names.items():
        by_mod.setdefault(mod, []).append(f"type {name}" if type_only else name)
    body = "\n".join(
        f'export {{ {", ".join(sorted(ns))} }} from "./_{mod}.ts";' for mod, ns in sorted(by_mod.items())
    )
    (R / folder / "index.ts").write_text(
        f"/**\n * @file The public face of the {folder} rule. Everything outside the folder imports\n"
        f" * this module, never the private `_*.ts` modules behind it.\n */\n{body}\n"
    )
# the private-module index (its only importer has no braces in the pattern above)
pmi = R / "private-module/index.ts"
if not pmi.exists():
    pmi.write_text(
        "/**\n * @file The public face of the private-module rule. Everything outside the folder imports\n"
        " * this module, never the private `_*.ts` modules behind it.\n */\n"
        'export { checkPrivateModules } from "./_check.ts";\n'
    )
