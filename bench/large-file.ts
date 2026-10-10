/**
 * @file The bench job's large-file case (#122): the PostToolUse hook on a
 * 4,500-line module with two violations, the shape of polar's
 * `subscription/service.py` that first went over the 100 ms budget. It builds
 * its own small project in a temporary directory (the synthetic repo must
 * stay clean), commits it, starts a session so both violations are old, and
 * times the base and the head one-shot in alternation, changing the file
 * before every run as an agent's edit does. Owns nothing the other metrics
 * use; `compare.ts` gates it like them.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { alternate, type Samples, timeRun } from "./timing.ts";

/** The edited module, relative to the project. */
const MODULE = "shop/domain/service.py";
/** Classes in the module; each adds 77 lines. */
const CLASSES = 58;
/** The line every run rewrites, so each hook sees a changed file. */
const EDITED = /^EDITED = \d+$/mu;

/**
 * Writes the large module: two outward imports at the top (two INW001
 * violations, as in polar's file), then classes whose methods hold loops,
 * f-strings, decorators and an import inside a function, with a constant in
 * the middle that the timed runs rewrite.
 *
 * @returns the module's text, about 4,500 lines.
 */
export function largeModule(): string {
  const head = [
    '"""A large domain service, generated for the benchmark."""',
    "from __future__ import annotations",
    "",
    "import dataclasses",
    "from collections.abc import Iterable",
    "",
    "from shop.domain.model import Order",
    "from shop.infrastructure.db import Session, engine",
    "",
  ];
  const classes = Array.from({ length: CLASSES }, (_, i) => [
    ...(i === CLASSES / 2 ? ["EDITED = 0", "", ""] : []),
    ...serviceClass(i),
  ]);
  return [...head, ...classes.flat()].join("\n");
}

/**
 * Writes one class of the large module.
 *
 * @param i - the class's number, which makes every name unique.
 * @returns its 77 lines.
 */
function serviceClass(i: number): string[] {
  const methods = Array.from({ length: 6 }, (_, m) => [
    "    @staticmethod",
    `    def step_${m}(orders: Iterable[Order], limit: int = ${m + 1}) -> list[str]:`,
    `        """Step ${m} of service ${i}."""`,
    "        out: list[str] = []",
    "        for n, order in enumerate(orders):",
    "            if n >= limit:",
    "                break",
    `            out.append(f"{order!r}:{n}:${i}")`,
    "        return out",
    "",
  ]);
  return [
    "",
    "@dataclasses.dataclass",
    `class Service${i}:`,
    `    """Service number ${i}."""`,
    "",
    "    name: str = ''",
    "    count: int = 0",
    "",
    "    def run(self, orders: Iterable[Order]) -> int:",
    "        from shop.domain.model import Order as Local  # an import inside a function",
    "",
    "        total = 0",
    "        for order in orders:",
    "            if isinstance(order, Local):",
    "                total += 1",
    "        return total",
    "",
    ...methods.flat(),
  ];
}

/**
 * Builds the project in a fresh temporary directory: the config, the
 * packages, the large module, one git commit, and a SessionStart, so the
 * module's two violations are old and every timed hook exits 0.
 *
 * @param head - the head's executable, which runs the SessionStart.
 * @returns the project directory; the caller removes it.
 * @throws {Error} when git fails or the SessionStart exits non-zero.
 */
function largeProject(head: string): string {
  const dir = mkdtempSync(join(tmpdir(), "inwards-large-"));
  const files: Record<string, string> = {
    "pyproject.toml": [
      "[tool.inwards]",
      "layers = [",
      '  { name = "domain", modules = ["shop.domain"] },',
      '  { name = "infrastructure", modules = ["shop.infrastructure"] },',
      "]",
      "",
    ].join("\n"),
    "shop/__init__.py": "",
    "shop/domain/__init__.py": "",
    "shop/domain/model.py": "class Order:\n    pass\n",
    "shop/infrastructure/__init__.py": "",
    "shop/infrastructure/db.py": "Session = object\nengine = None\n",
    [MODULE]: largeModule(),
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  const git = ["git", "-C", dir, "-c", "user.name=bench", "-c", "user.email=bench@localhost"];
  for (const args of [
    ["init", "-q"],
    ["add", "-A"],
    ["-c", "commit.gpgsign=false", "commit", "-qm", "bench"],
  ]) {
    if (Bun.spawnSync([...git, ...args]).exitCode !== 0) {
      throw new Error(`git ${args.join(" ")} failed in ${dir}`);
    }
  }
  const start = {
    session_id: "bench-large",
    hook_event_name: "SessionStart",
    source: "startup",
    cwd: dir,
  };
  timeRun([head, "hook", "claude-code"], dir, JSON.stringify(start));
  return dir;
}

/**
 * Times the PostToolUse hook on the large module, base and head one-shot in
 * alternation, with the module changed before every run.
 *
 * @param binaries - the two builds to compare.
 * @param binaries.base - the base branch's executable.
 * @param binaries.head - the head branch's executable.
 * @param runs - how many runs.
 * @param runs.measured - measured runs per binary.
 * @param runs.warmup - unmeasured runs per binary before those.
 * @returns the samples.
 * @throws {Error} when the project can't be built or a run fails.
 */
export function largeHook(
  binaries: { base: string; head: string },
  runs: { measured: number; warmup: number },
): Samples {
  const dir = largeProject(binaries.head);
  const file = join(dir, MODULE);
  const text = largeModule();
  const payload = JSON.stringify({
    session_id: "bench-large",
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    cwd: dir,
    tool_input: { file_path: file },
  });
  let edit = 0;
  try {
    return alternate(
      binaries,
      {
        argv: ["hook", "claude-code"],
        cwd: dir,
        stdin: payload,
        before: (): void => {
          edit += 1;
          writeFileSync(file, text.replace(EDITED, `EDITED = ${edit}`));
        },
      },
      runs,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
