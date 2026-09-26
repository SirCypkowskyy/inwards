/**
 * The baseline: violations a project already had when it adopted Inwards,
 * accepted so that only new ones fail. It lives next to the pyproject.toml it
 * belongs to and is committed, so every clone, hook and CI run sees the same
 * list. Entries match by rule, module and message, never by line, so moving
 * an import doesn't bring it back. The message's closing "Allowed direction"
 * sentence names every layer, so it is left out: adding an unrelated layer
 * must not bring every accepted violation back.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { ConfigError, type Diagnostic, type Report } from "@inwards/core";

export const BASELINE_FILE = "inwards-baseline.json";
const SCHEMA = "inwards/baseline@1";
/** INW001 and INW011 end with the whole layer order, which isn't part of the violation. */
const DIRECTION = / Allowed direction: [^\n]*$/u;
const REGENERATE = "Ask the user to regenerate it with `inwards baseline`.";

/** One accepted violation, with how many times the module has it. */
interface Entry {
  code: string;
  module: string;
  message: string;
  count: number;
}

/**
 * Where a config's baseline lives: next to its pyproject.toml.
 *
 * @param configPath - the pyproject.toml.
 * @returns the baseline path.
 */
function baselinePath(configPath: string): string {
  return join(dirname(configPath), BASELINE_FILE);
}

/**
 * The key an entry and a diagnostic match on.
 *
 * @param d - a diagnostic or entry.
 * @returns rule, module and message joined.
 */
function keyOf(d: Pick<Diagnostic, "code" | "module" | "message">): string {
  return `${d.code}\u0000${d.module}\u0000${stable(d.message)}`;
}

/**
 * Drops the part of a message that depends on the rest of the config.
 *
 * @param message - a diagnostic message.
 * @returns the message without its "Allowed direction" sentence.
 */
function stable(message: string): string {
  return message.replace(DIRECTION, "");
}

/**
 * Orders two strings by code point, the same in every locale.
 *
 * @param a - one string.
 * @param b - the other.
 * @returns negative, zero or positive.
 */
function byCodePoint(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/**
 * Writes the baseline from a whole-project check: its errors, grouped and sorted
 * so that the file diffs well. Warnings don't fail a check, so they stay out.
 *
 * @param configPath - the pyproject.toml.
 * @param diagnostics - the whole-project check's diagnostics.
 * @returns how many violations the baseline now accepts.
 */
export function writeBaseline(configPath: string, diagnostics: readonly Diagnostic[]): number {
  const entries = new Map<string, Entry>();
  for (const d of diagnostics.filter((x) => x.severity === "error")) {
    const entry = entries.get(keyOf(d)) ?? {
      code: d.code,
      module: d.module,
      message: stable(d.message),
      count: 0,
    };
    entry.count += 1;
    entries.set(keyOf(d), entry);
  }
  const violations = [...entries.values()].sort(
    (a, b) =>
      byCodePoint(a.module, b.module) ||
      byCodePoint(a.code, b.code) ||
      byCodePoint(a.message, b.message),
  );
  // A temp file and a rename replace a planted symlink instead of writing through it.
  const path = baselinePath(configPath);
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ schema: SCHEMA, violations }, null, 2)}\n`, {
    flag: "wx",
  });
  renameSync(temp, path);
  return violations.reduce((sum, v) => sum + v.count, 0);
}

/**
 * Reads a baseline's entries.
 *
 * @param path - the baseline file.
 * @returns the entries, or undefined when there is no baseline.
 * @throws {ConfigError} when the file isn't a baseline this version understands.
 */
function readEntries(path: string): Entry[] | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new ConfigError(`${path} is not valid JSON. ${REGENERATE}`, {
      cause: err,
    });
  }
  const violations = isRecord(value) ? value["violations"] : undefined;
  if (!(isRecord(value) && value["schema"] === SCHEMA && Array.isArray(violations))) {
    throw new ConfigError(`${path} is not an ${SCHEMA} file. ${REGENERATE}`);
  }
  const entries = violations.filter(isEntry);
  if (entries.length !== violations.length) {
    throw new ConfigError(`${path} has a malformed entry. ${REGENERATE}`);
  }
  return entries;
}

/**
 * Tells whether a parsed value is a baseline entry.
 *
 * @param value - one element of `violations`.
 * @returns true for `{code, module, message, count}` with a positive integer count.
 */
function isEntry(value: unknown): value is Entry {
  return (
    isRecord(value) &&
    typeof value["code"] === "string" &&
    typeof value["module"] === "string" &&
    typeof value["message"] === "string" &&
    typeof value["count"] === "number" &&
    Number.isInteger(value["count"]) &&
    value["count"] > 0
  );
}

/**
 * Tells whether a parsed JSON value is an object.
 *
 * @param value - the value.
 * @returns true for a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Drops the errors the baseline accepts, up to each entry's count, so a module
 * that gains a second copy of an accepted violation still fails.
 *
 * @param configPath - the pyproject.toml.
 * @param report - the check's report.
 * @param whole - true when the whole project was checked, so leftover entries were fixed.
 * @returns the report without accepted errors, with `baselined` (and `resolved` for a whole run).
 */
export function applyBaseline(configPath: string, report: Report, whole: boolean): Report {
  const entries = readEntries(baselinePath(configPath));
  if (entries === undefined) {
    return report;
  }
  const left = new Map<string, number>();
  for (const e of entries) {
    left.set(keyOf(e), (left.get(keyOf(e)) ?? 0) + e.count);
  }
  let baselined = 0;
  const diagnostics = report.diagnostics.filter((d) => {
    const n = d.severity === "error" ? (left.get(keyOf(d)) ?? 0) : 0;
    if (n === 0) {
      return true;
    }
    left.set(keyOf(d), n - 1);
    baselined += 1;
    return false;
  });
  const resolved = whole ? [...left.values()].reduce((sum, n) => sum + n, 0) : undefined;
  return { ...report, diagnostics, baselined, ...(resolved === undefined ? {} : { resolved }) };
}

/**
 * Fingerprints each config's baseline, so the Stop gate can tell whether one
 * changed during a session. Never throws: a baseline that can't be read (a
 * directory, a dangling link) gets a marker instead, which differs from any hash.
 *
 * @param project - the project root.
 * @param configs - project-relative pyproject.toml paths.
 * @returns the SHA-256 or marker of each existing baseline, by the config's path, sorted.
 */
export function baselineHashes(
  project: string,
  configs: readonly string[],
): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const rel of [...configs].sort()) {
    const path = baselinePath(join(project, rel));
    if (lstatSync(path, { throwIfNoEntry: false }) === undefined) {
      continue;
    }
    try {
      hashes[rel] = statSync(path).isFile()
        ? createHash("sha256").update(readFileSync(path)).digest("hex")
        : "not a file";
    } catch {
      hashes[rel] = "unreadable";
    }
  }
  return hashes;
}

/**
 * Lists the baselines that differ from the session start.
 *
 * @param project - the project root.
 * @param configs - the session-start configs' project-relative paths.
 * @param start - the baseline hashes recorded at session start, by config path.
 * @returns project-relative baseline paths that appeared, changed or went away.
 */
export function changedBaselines(
  project: string,
  configs: readonly string[],
  start: Record<string, string>,
): string[] {
  const now = baselineHashes(project, configs);
  return [...new Set([...Object.keys(start), ...Object.keys(now)])]
    .filter((rel) => start[rel] !== now[rel])
    .map((rel) => join(dirname(rel), BASELINE_FILE).replaceAll("\\", "/"));
}
