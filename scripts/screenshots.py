"""Render real terminal sessions to SVG screenshots for the docs.

    bun run scripts/build-binaries.ts bun-linux-x64
    uv run --with rich python scripts/screenshots.py

Every screenshot is the actual output of the command shown in it, run against a
scratch copy of examples/clean-app. The only liberty taken: `jq` runs with `-C`
so the JSON keeps its colours. Output: docs/chapters/assets/screens/*.svg
"""

import os
import re
import shutil
import subprocess
import sys
import sysconfig
import tempfile
from pathlib import Path

from rich.console import Console
from rich.text import Text

REPO = Path(__file__).resolve().parent.parent
BINARY = REPO / "dist" / "inwards-linux-x64"
OUT = REPO / "docs" / "chapters" / "assets" / "screens"
WIDTH = 118

CONFIG = """[tool.inwards]
root = "clean-app"
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "application", modules = ["shop.application"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
  { name = "interface", modules = ["shop.api"] },
]
"""

HOOK = """#!/bin/sh
# .claude/settings.json -> hooks.PostToolUse, matcher "Edit|Write"
f=$(jq -r '.tool_input.file_path // empty')
case "$f" in
  *.py) inwards check "$f" --format json >&2 || exit 2 ;;
esac
"""

BAD_IMPORT = "from shop.infrastructure.sql_orders import SqlOrderRepository\n"


def run(cmd: str, cwd: Path, env: dict[str, str]) -> str:
    done = subprocess.run(
        cmd, shell=True, cwd=cwd, env=env, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    return done.stdout.rstrip("\n")


def shoot(name: str, title: str, steps: list[tuple[str, str]], cwd: Path, env: dict[str, str]) -> None:
    console = Console(record=True, width=WIDTH, force_terminal=True, color_system="truecolor", file=open(os.devnull, "w"))
    for shown, actual in steps:
        console.print(Text.assemble(("$ ", "bold green"), (shown, "bold")))
        output = run(actual, cwd, env)
        if output:
            console.print(Text.from_ansi(output))
        console.print()
    OUT.mkdir(parents=True, exist_ok=True)
    svg = console.export_svg(title=title)
    # Rich sets only a viewBox; without a size, <img> falls back to a tiny default.
    _, _, w, h = re.search(r'viewBox="([\d. ]+)"', svg).group(1).split()
    svg = svg.replace("<svg ", f'<svg width="{float(w):.0f}" height="{float(h):.0f}" ', 1)
    # SVGs shown through <img> may not fetch web fonts. Drop the CDN URLs so the
    # file is self-contained and falls back to a local monospace font.
    svg = re.sub(r',\s*url\("https://[^"]+"\) format\("woff2?"\)', "", svg)
    (OUT / f"{name}.svg").write_text(svg)
    print(f"wrote {name}.svg")


def main() -> None:
    if not BINARY.exists():
        sys.exit(f"missing {BINARY}; run: bun run scripts/build-binaries.ts bun-linux-x64")

    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp) / "shop-repo"
        bindir = Path(tmp) / "bin"
        bindir.mkdir()
        (bindir / "inwards").symlink_to(BINARY)
        shutil.copytree(REPO / "examples" / "clean-app", work / "clean-app")
        (work / "pyproject.toml").write_text(CONFIG)
        hooks = work / ".claude" / "hooks"
        hooks.mkdir(parents=True)
        (hooks / "inwards.sh").write_text(HOOK)

        bun = Path.home() / ".bun" / "bin"
        env = {**os.environ, "PATH": f"{bindir}:{bun}:{os.environ['PATH']}", "FORCE_COLOR": "1"}
        env.pop("NO_COLOR", None)

        shoot("check-clean", "inwards check", [("inwards check", "inwards check")], work, env)

        order = work / "clean-app" / "shop" / "domain" / "order.py"
        order.write_text(order.read_text() + BAD_IMPORT)
        shoot(
            "check-violation",
            "inwards check",
            [
                ("tail -1 clean-app/shop/domain/order.py", "tail -1 clean-app/shop/domain/order.py"),
                ("inwards check", "inwards check"),
                ("echo $?", "inwards check >/dev/null; echo $?"),
            ],
            work,
            env,
        )
        shoot(
            "json-for-agents",
            "inwards check --format json",
            [(
                "inwards check --format json | jq '.summary, .diagnostics[0].fix'",
                "inwards check --format json | jq -C '.summary, .diagnostics[0].fix'",
            )],
            work,
            env,
        )
        hook_input = """'{"tool_name":"Edit","tool_input":{"file_path":"clean-app/shop/domain/order.py"}}'"""
        shoot(
            "claude-code-hook",
            "Claude Code PostToolUse hook",
            [
                ("cat .claude/hooks/inwards.sh", "cat .claude/hooks/inwards.sh"),
                (
                    f"echo {hook_input} | sh .claude/hooks/inwards.sh 2> seen-by-claude.json; echo \"hook exit: $?\"",
                    f"echo {hook_input} | sh .claude/hooks/inwards.sh 2> seen-by-claude.json; echo \"hook exit: $?\"",
                ),
                (
                    "jq '.diagnostics[0] | {code, line, fix: .fix.summary}' seen-by-claude.json",
                    "jq -C '.diagnostics[0] | {code, line, fix: .fix.summary}' seen-by-claude.json",
                ),
            ],
            work,
            env,
        )

        bench = Path(tmp) / "bench"
        subprocess.run([sys.executable, str(REPO / "bench" / "generate.py"), str(bench)], check=True)
        shoot(
            "benchmark",
            "cold run, 2,100 files / 496k lines",
            [
                ("python3 bench/generate.py bench && cd bench", "true"),
                ("find src -name '*.py' | xargs cat | wc -l", "find src -name '*.py' | xargs cat | wc -l"),
                ("inwards check", "inwards check"),
            ],
            bench,
            env,
        )

    stdlib = sysconfig.get_paths()["stdlib"]  # /usr/lib64/python3.14 on the machine that made the docs
    shoot(
        "prescan-diff",
        "prescan differential test",
        [(
            "bun run src/core/scripts/prescan-diff.ts /usr/lib64/python3.14",
            f"bun run src/core/scripts/prescan-diff.ts {stdlib}",
        )],
        REPO,
        env,
    )
    shoot("bun-test", "bun test", [("bun test 2>&1 | tail -6", "bun test 2>&1 | tail -6")], REPO, env)


if __name__ == "__main__":
    main()
