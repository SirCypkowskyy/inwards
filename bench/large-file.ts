/**
 * @file The bench job's large-file case (#122): the PostToolUse hook on a
 * 4,500-line module with two violations, the shape of polar's
 * `subscription/service.py` that first went over the 100 ms budget. It builds
 * its own small project in a temporary directory (the synthetic repo must
 * stay clean), commits it, starts a session so both violations are old, and
 * times the base and the head one-shot in alternation, then the head
 * one-shot and through its daemon, changing the file before every run as an
 * agent's edit does. Owns nothing the other metrics
 * use; `compare.ts` gates it like them.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type DaemonSamples, daemonHook } from "./daemon.ts";
import { alternate, ms, type Samples, summarise, timeRun } from "./timing.ts";

/** The edited module, relative to the project. */
const MODULE = "shop/domain/service.py";
/** Classes in the module; each adds 77 lines. */
const CLASSES = 58;
/** The line every run rewrites, so each hook sees a changed file. */
const EDITED = /^EDITED = \d+$/mu;

/**
 * Writes the large module: a docstring that makes the prescan refuse the
 * file, two outward imports (two INW001 violations), as in polar's file,
 * then classes whose methods hold loops,
 * f-strings, decorators and an import inside a function, with a constant in
 * the middle that the timed runs rewrite.
 *
 * @returns the module's text, about 4,500 lines.
 */
export function largeModule(): string {
  const head = [
    '"""A large domain service, generated for the benchmark.',
    "",
    "Like polar's file, this docstring mentions an import, so the prescan",
    "refuses the file and both checks of the hook parse all of it.",
    '"""',
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

/** The large-file case's samples: base and head one-shot, and the head through its daemon. */
export interface LargeSamples {
  oneShot: Samples;
  daemon: DaemonSamples;
}

/**
 * Times the PostToolUse hook on the large module with the module changed
 * before every run: base and head one-shot in alternation, then the head
 * one-shot and through `inwards daemon` in alternation.
 *
 * @param binaries - the two builds to compare.
 * @param binaries.base - the base branch's executable.
 * @param binaries.head - the head branch's executable.
 * @param runs - how many runs.
 * @param runs.measured - measured runs per binary and per mode.
 * @param runs.warmup - unmeasured runs before those.
 * @returns the samples.
 * @throws {Error} when the project can't be built, the daemon doesn't start or a run fails.
 */
export function largeHook(
  binaries: { base: string; head: string },
  runs: { measured: number; warmup: number },
): LargeSamples {
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
  /** Rewrites the module's constant, so every run checks a changed file. */
  function before(): void {
    edit += 1;
    writeFileSync(file, text.replace(EDITED, `EDITED = ${edit}`));
  }
  try {
    const oneShot = alternate(
      binaries,
      { argv: ["hook", "claude-code"], cwd: dir, stdin: payload, before },
      runs,
    );
    return { oneShot, daemon: daemonHook(binaries.head, dir, payload, { ...runs, before }) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The quality goal for a hook on one edited file: p95 under 100 ms (chapter 6). */
const HOOK_BUDGET_MS = 100;
/** #60's target for a hook through the daemon: p95 under 50 ms. */
const DAEMON_TARGET_MS = 50;

/**
 * Renders the head's hook on the large module, one-shot and through the
 * daemon, against the budget and the daemon's target.
 *
 * @param samples - the head one-shot and through the daemon, in alternation.
 * @returns a table with a verdict per row.
 */
export function largeMarkdown(samples: DaemonSamples): string {
  return [
    "| PostToolUse hook on the 4,482-line file (head) | p50 / p95 (ms) | p95 target |",
    "|---|---|---|",
    row("one-shot", samples.oneShot, HOOK_BUDGET_MS),
    row("through the daemon", samples.daemon, DAEMON_TARGET_MS),
  ].join("\n");
}

/**
 * Renders one row of the large-file table.
 *
 * @param mode - one-shot or through the daemon.
 * @param xs - its samples, in milliseconds.
 * @param limit - the p95 it must stay under, in milliseconds.
 * @returns the Markdown row.
 */
function row(mode: string, xs: readonly number[], limit: number): string {
  const { p50, p95 } = summarise(xs);
  return `| ${mode} | ${ms(p50)} / ${ms(p95)} | ${limit} ms: ${p95 < limit ? "met" : "**missed**"} |`;
}
