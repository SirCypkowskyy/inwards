/**
 * @file How the CLI tests run Inwards: the compiled binary when `INWARDS_BIN`
 * is set (as CI does), else `bun` on the source. It also builds throwaway
 * projects from a file map and loads recorded Claude Code hook payloads.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { STATE_HOME, tempDir } from "./temp.ts";

// CI sets INWARDS_BIN to the compiled binary; locally the tests run the source.
const REPO = resolve(import.meta.dir, "../../../..");
/** How the tests start the CLI: the compiled binary in CI, else main.ts under Bun. */
export const CMD: string[] = process.env["INWARDS_BIN"]
  ? [resolve(REPO, process.env["INWARDS_BIN"])]
  : [process.execPath, join(REPO, "src/cli/src/main.ts")];

/** The user-level Claude settings directory the CLI sees in tests, so the real one never leaks in. */
export const CLAUDE_USER_DIR: string = tempDir("inwards-claude-user-");

// FORCE_COLOR on purpose: hosts set it, and machine output must stay plain anyway.
// CLAUDE_PROJECT_DIR is dropped because these tests may run inside Claude Code,
// and INWARDS_RUN_LOG so a developer's own setting can't change the results.
const ENV: Record<string, string | undefined> = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => name !== "CLAUDE_PROJECT_DIR" && name !== "INWARDS_RUN_LOG",
    ),
  ),
  NO_COLOR: "",
  FORCE_COLOR: "1",
  CLAUDE_CONFIG_DIR: CLAUDE_USER_DIR,
  XDG_STATE_HOME: STATE_HOME,
};

/** What one run of the CLI produced. */
export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs the CLI synchronously and captures its output.
 * Runs the compiled binary when INWARDS_BIN is set, else main.ts under Bun.
 * FORCE_COLOR is on and CLAUDE_PROJECT_DIR is removed unless `opts.env` sets it.
 *
 * @param args - CLI arguments, e.g. `["check", "--format", "json"]`.
 * @param opts - working directory, optional stdin text, and extra environment.
 * @param opts.cwd - the directory to run in.
 * @param opts.stdin - text to pipe to stdin; none when undefined.
 * @param opts.env - variables added to the test environment.
 * @returns the exit code and both output streams as text.
 */
export function inwards(
  args: string[],
  opts: { cwd: string; stdin?: string | undefined; env?: Record<string, string> },
): RunResult {
  const p = Bun.spawnSync([...CMD, ...args], {
    cwd: opts.cwd,
    stdin: opts.stdin === undefined ? "ignore" : new TextEncoder().encode(opts.stdin),
    env: { ...ENV, ...opts.env },
  });
  return { code: p.exitCode, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
}

export const LAYERS = `[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]
`;

/** Vertical slices: every slice's domain and infrastructure (layer selectors). */
export const SLICES = `[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.*.domain"] },
  { name = "infrastructure", modules = ["shop.*.infrastructure"] },
]
`;

const TMP = tempDir("inwards-e2e-");

/**
 * Runs the CLI without blocking, so several copies can run at once.
 *
 * @param args - CLI arguments.
 * @param opts - working directory and stdin text.
 * @param opts.cwd - the directory to run in.
 * @param opts.stdin - text to pipe to stdin.
 * @returns the exit code and captured output, once the process ends.
 */
export async function inwardsAsync(
  args: string[],
  opts: { cwd: string; stdin: string },
): Promise<RunResult> {
  const p = Bun.spawn([...CMD, ...args], {
    cwd: opts.cwd,
    stdin: new TextEncoder().encode(opts.stdin),
    stdout: "pipe",
    stderr: "pipe",
    env: ENV,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { code, stdout, stderr };
}

/**
 * Creates a throwaway project in a temp directory removed when the process exits.
 * Example: `{ "pyproject.toml": LAYERS, "shop/domain/order.py": "..." }`.
 * A project on LAYERS also gets `shop/infrastructure/db.py` unless it has its
 * own infrastructure files, so both layers exist (an empty layer is INW006).
 *
 * @param files - file contents keyed by path relative to the project root.
 * @returns the project's absolute root.
 */
export function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(TMP, "p-"));
  const withLayers = files["pyproject.toml"] === LAYERS;
  const hasInfra = Object.keys(files).some((rel) => rel.startsWith("shop/infrastructure/"));
  const all = withLayers && !hasInfra ? { "shop/infrastructure/db.py": "", ...files } : files;
  for (const [rel, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

const ROOT_MARKER = "{{ROOT}}";
/** Numbers the tool calls `payload` makes up, so no two calls share a `tool_use_id`. */
let toolCalls = 0;

/**
 * Loads a recorded Claude Code payload and points it at a project.
 * Every string starting with `{{ROOT}}` becomes a native path under `root`;
 * top-level fields in `patch` then replace the recorded ones. A recorded
 * `tool_use_id` gets a fresh value on every call, as each Claude Code tool
 * call has its own, since the session counts an edit once per id (#60).
 *
 * @param name - fixture name in fixtures/claude-code, without `.json`.
 * @param root - the project root to substitute.
 * @param patch - top-level fields to override, e.g. `{ cwd: undefined }`.
 * @returns the payload as JSON text for the hook's stdin.
 * @throws {Error} when the fixture is not a JSON object.
 */
export function payload(name: string, root: string, patch: Record<string, unknown> = {}): string {
  const text = readFileSync(join(import.meta.dir, "fixtures/claude-code", `${name}.json`), "utf8");
  /**
   * JSON.parse reviver that roots `{{ROOT}}` paths under the project.
   *
   * @param _key - the property name (unused).
   * @param v - the parsed value.
   * @returns the value, with the marker replaced when it is a rooted string.
   */
  function rooted(_key: string, v: unknown): unknown {
    return typeof v === "string" && v.startsWith(ROOT_MARKER)
      ? join(root, v.slice(ROOT_MARKER.length))
      : v;
  }
  const recorded: unknown = JSON.parse(text, rooted);
  if (typeof recorded !== "object" || recorded === null) {
    throw new Error(`fixture ${name} is not a JSON object`);
  }
  toolCalls += 1;
  const tool = "tool_use_id" in recorded ? { tool_use_id: `toolu_test${toolCalls}` } : {};
  return JSON.stringify({ ...recorded, ...tool, ...patch });
}
