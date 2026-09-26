/**
 * Records Claude Code hook payloads and compares their shape with the fixtures.
 *
 *   bun run scripts/claude-payload-drift.ts <dir>
 *
 * Without `<dir>/payloads`, runs a headless `claude -p` session (Haiku, capped
 * at $0.25) in `<dir>` with hooks that save every payload there, and a second
 * session in `<dir>/retry` when the first skipped a call a fixture needs. Then
 * compares the first payload per fixture in src/cli/test/fixtures/claude-code
 * by field names and JSON types, never values. Prints a Markdown report.
 * Exit codes: 0 no drift, 1 drift, 3 the session failed or never made a call
 * (not drift). Run nightly by .github/workflows/nightly-e2e.yml.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import process from "node:process";

const FIXTURES = resolve(import.meta.dir, "../src/cli/test/fixtures/claude-code");
const EVENTS = ["SessionStart", "PreToolUse", "PostToolUse", "Stop"];
// One call per tool fixture: left to itself, Haiku sometimes writes the file once.
const PROMPT = [
  "Make exactly these three tool calls, one at a time, then stop.",
  "1. Write tool: create shop/domain/order.py containing the line: import shop.infrastructure.db",
  "2. Edit tool: in shop/domain/order.py, append the line: X = 1",
  "3. Write tool: create README.md containing the word: hi",
].join("\n");
/** Exit code when the session failed or skipped a call: not drift, so no issue. */
const SESSION_FAILED = 3;
const JSON_FILE = /\.json$/u;
// Fields a payload may leave out: Stop has no last message when the turn ends early.
const OPTIONAL: Record<string, string[]> = { stop: ["last_assistant_message"] };
const EXTENSION = /\.[^.]*$/u;

/** Field path to JSON type, e.g. `tool_input.file_path` → `string`. `*` marks an empty array. */
type Shape = Map<string, string>;

/**
 * Flattens a JSON value into its field paths and types.
 * Array elements share one path (`lines[]`); an empty array gets `[]` → `*`,
 * so the element fields the other side has are not reported as drift.
 *
 * @param value - the parsed JSON.
 * @param path - the path of `value`; empty at the root.
 * @param out - the map to fill.
 * @returns `out`.
 */
function shape(value: unknown, path = "", out: Shape = new Map()): Shape {
  if (Array.isArray(value)) {
    out.set(path, "array");
    if (value.length === 0) {
      out.set(`${path}[]`, "*");
    }
    for (const item of value) {
      shape(item, `${path}[]`, out);
    }
  } else if (typeof value === "object" && value !== null) {
    out.set(path, "object");
    for (const [key, item] of Object.entries(value)) {
      shape(item, path === "" ? key : `${path}.${key}`, out);
    }
  } else {
    out.set(path, value === null ? "null" : typeof value);
  }
  return out;
}

/**
 * Lists how a recorded shape differs from the fixture's.
 *
 * @param fixture - the fixture's shape.
 * @param recorded - the new payload's shape.
 * @returns one line per field added (`+`), removed (`-`) or retyped (`~`).
 */
function diff(fixture: Shape, recorded: Shape): string[] {
  /**
   * Whether a path sits under an array that is empty on this side.
   *
   * @param side - the shape without the path.
   * @param path - the field path.
   * @returns true when the missing field can't be compared.
   */
  function underEmpty(side: Shape, path: string): boolean {
    return [...side].some(([p, t]) => t === "*" && path.startsWith(p));
  }
  const lines: string[] = [];
  for (const path of new Set([...fixture.keys(), ...recorded.keys()])) {
    const was = fixture.get(path);
    const now = recorded.get(path);
    if (was === now || was === "*" || now === "*") {
      continue;
    }
    if (was === undefined) {
      if (!underEmpty(fixture, path)) {
        lines.push(`+ ${path}: ${now}`);
      }
    } else if (now === undefined) {
      if (!underEmpty(recorded, path)) {
        lines.push(`- ${path}: ${was}`);
      }
    } else {
      lines.push(`~ ${path}: ${was} → ${now}`);
    }
  }
  return lines;
}

/**
 * Names a payload the way the fixtures are named, e.g. `pre-write-order`.
 *
 * @param p - the parsed payload.
 * @returns the fixture name, or undefined for events the fixtures don't cover.
 */
function nameOf(p: Record<string, unknown>): string | undefined {
  const event = p["hook_event_name"];
  if (event === "SessionStart") {
    return "session-start";
  }
  if (event === "Stop") {
    return "stop";
  }
  const input = p["tool_input"];
  const file =
    typeof input === "object" && input !== null && "file_path" in input ? input.file_path : "";
  if ((event !== "PreToolUse" && event !== "PostToolUse") || typeof file !== "string") {
    return;
  }
  const stem = basename(file).replace(EXTENSION, "").toLowerCase();
  return `${event === "PreToolUse" ? "pre" : "post"}-${String(p["tool_name"]).toLowerCase()}-${stem}`;
}

/**
 * Reads a JSON object from a file.
 *
 * @param path - the file.
 * @returns the object.
 * @throws {Error} when the file holds something other than an object.
 */
function readObject(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} is not a JSON object`);
  }
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: checked above that it is a non-array object.
  return value as Record<string, unknown>;
}

/**
 * Runs a headless Claude Code session in a project whose hooks save their stdin.
 * Payload files are named `<ns since epoch>-<pid>.json`, so they sort in the order
 * the hooks ran (GNU date; BSD date has no `%N`). Exits 3 when `claude` fails.
 *
 * @param project - the scratch project; payloads land in `project/payloads`.
 */
function record(project: string): void {
  const save = 'cat > "$CLAUDE_PROJECT_DIR/payloads/$(date +%s%N)-$$.json"';
  const hooks = Object.fromEntries(
    EVENTS.map((e) => [e, [{ matcher: "*", hooks: [{ type: "command", command: save }] }]]),
  );
  mkdirSync(join(project, "payloads"), { recursive: true });
  mkdirSync(join(project, ".claude"), { recursive: true });
  writeFileSync(join(project, ".claude/settings.json"), JSON.stringify({ hooks }, null, 2));
  writeFileSync(
    join(project, "pyproject.toml"),
    '[tool.inwards]\nlayers = [\n  { name = "domain", modules = ["shop.domain"] },\n  { name = "infrastructure", modules = ["shop.infrastructure"] },\n]\n',
  );
  const args = ["-p", PROMPT, "--model", "haiku", "--setting-sources", "project"];
  const p = Bun.spawnSync(
    ["claude", ...args, "--permission-mode", "acceptEdits", "--max-budget-usd", "0.25"],
    { cwd: project, stderr: "inherit" },
  );
  process.stderr.write(p.stdout); // stdout carries only the report
  if (p.exitCode !== 0) {
    process.stderr.write(`claude -p exited with ${p.exitCode}\n`);
    process.exit(SESSION_FAILED);
  }
}

/**
 * Adds a project's payloads to `into`, keeping the first one per fixture name.
 *
 * @param project - the scratch project with a `payloads` directory.
 * @param into - payloads by fixture name.
 */
function collect(project: string, into: Map<string, Record<string, unknown>>): void {
  for (const f of readdirSync(join(project, "payloads")).sort()) {
    const p = readObject(join(project, "payloads", f));
    const name = nameOf(p);
    if (name !== undefined && !into.has(name)) {
      into.set(name, p);
    }
  }
}

const [, , dir]: (string | undefined)[] = process.argv;
if (dir === undefined) {
  process.stderr.write("usage: bun run scripts/claude-payload-drift.ts <dir>\n");
  process.exit(2);
}
const fixtures = readdirSync(FIXTURES)
  .filter((n) => JSON_FILE.test(n))
  .map((n) => n.replace(JSON_FILE, ""))
  .sort();
const payloads = new Map<string, Record<string, unknown>>();
const fresh = !existsSync(join(dir, "payloads"));
if (fresh) {
  record(dir);
}
collect(dir, payloads);
// The model sometimes merges or skips a call; one more session before giving up.
if (fresh && fixtures.some((name) => !payloads.has(name))) {
  record(join(dir, "retry"));
  collect(join(dir, "retry"), payloads);
}

const drift: string[] = [];
const missing: string[] = [];
for (const name of fixtures) {
  const now = payloads.get(name);
  if (now === undefined) {
    missing.push(`- ${name}`);
    continue;
  }
  const was = readObject(join(FIXTURES, `${name}.json`));
  for (const field of OPTIONAL[name] ?? []) {
    if (!(field in now)) {
      delete was[field];
    }
  }
  const lines = diff(shape(was), shape(now));
  if (lines.length > 0) {
    drift.push(`### ${name}\n\n\`\`\`diff\n${lines.join("\n")}\n\`\`\``);
  }
}

const version = Bun.spawnSync(["claude", "--version"]).stdout.toString().trim();
const sections: string[] = [];
if (drift.length > 0) {
  sections.push(`## Hook payload drift in Claude Code ${version}`, ...drift);
}
if (missing.length > 0) {
  sections.push(
    "## Not recorded",
    `The session didn't make these calls${fresh ? ", even on a retry" : ""}, so they weren't compared:\n\n${missing.join("\n")}`,
  );
}
if (sections.length === 0) {
  sections.push(
    `No drift: ${payloads.size} payloads from Claude Code ${version} match the fixtures.`,
  );
}
process.stdout.write(`${sections.join("\n\n")}\n`);
if (drift.length > 0) {
  process.exit(1);
}
process.exit(missing.length > 0 ? SESSION_FAILED : 0);
