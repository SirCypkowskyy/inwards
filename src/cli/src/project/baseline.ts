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
import { dirname, join } from "node:path";
import {
  baselineKey,
  ConfigError,
  type Diagnostic,
  type Report,
  type RuleSettings,
  ruleLevel,
  stableMessage,
} from "@inwards/core";
import { isRecord } from "../json/guards.ts";
import type { FileReader, PathProbe } from "../platform/contracts.ts";
import type { BaselineWriter } from "./contracts.ts";

/** What reading a baseline needs. */
interface BaselineReads {
  probe: Pick<PathProbe, "exists">;
  read: Pick<FileReader, "text">;
}

export const BASELINE_FILE = "inwards-baseline.json";
const SCHEMA = "inwards/baseline@1";
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
 * The old file's dormant entries (rules `[tool.inwards.rules]` turns off or
 * down to a warning, which the check can't see) are kept, so that turning the
 * rule back on doesn't bring back violations the user had accepted.
 *
 * @param io - reads the old baseline and replaces it.
 * @param io.probe - tells whether the old baseline exists.
 * @param io.read - reads the old baseline.
 * @param io.baselines - replaces the file.
 * @param configPath - the pyproject.toml.
 * @param diagnostics - the whole-project check's diagnostics.
 * @param rules - the config's `[tool.inwards.rules]`, if any.
 * @returns how many violations the baseline now accepts, dormant ones included.
 * @throws {ConfigError} when the baseline can't be written.
 */
export function writeBaseline(
  io: BaselineReads & { baselines: BaselineWriter },
  configPath: string,
  diagnostics: readonly Diagnostic[],
  rules: RuleSettings | undefined,
): number {
  const entries = new Map<string, Entry>();
  for (const e of dormantEntries(io, configPath, rules)) {
    entries.set(baselineKey(e), e);
  }
  for (const d of diagnostics.filter((x) => x.severity === "error")) {
    const entry = entries.get(baselineKey(d)) ?? {
      code: d.code,
      module: d.module,
      message: stableMessage(d.message),
      count: 0,
    };
    entry.count += 1;
    entries.set(baselineKey(d), entry);
  }
  const violations = [...entries.values()].sort(
    (a, b) =>
      byCodePoint(a.module, b.module) ||
      byCodePoint(a.code, b.code) ||
      byCodePoint(a.message, b.message),
  );
  io.baselines.replace(
    baselinePath(configPath),
    `${JSON.stringify({ schema: SCHEMA, violations }, null, 2)}\n`,
  );
  return violations.reduce((sum, v) => sum + v.count, 0);
}

/**
 * Reads the entries of the current baseline that `[tool.inwards.rules]` makes
 * dormant. A baseline this version can't read has none: it is being replaced.
 *
 * @param io - reads the baseline.
 * @param configPath - the pyproject.toml.
 * @param rules - the config's `[tool.inwards.rules]`, if any.
 * @returns the dormant entries.
 */
function dormantEntries(
  io: BaselineReads,
  configPath: string,
  rules: RuleSettings | undefined,
): Entry[] {
  if (rules === undefined) {
    return [];
  }
  try {
    return (readEntries(io, baselinePath(configPath)) ?? []).filter((e) => dormant(e.code, rules));
  } catch {
    return [];
  }
}

/**
 * Reads a baseline's entries.
 *
 * @param io - tells whether the file exists and reads it.
 * @param path - the baseline file.
 * @returns the entries, or undefined when there is no baseline.
 * @throws {ConfigError} when the file isn't a baseline this version understands.
 */
function readEntries(io: BaselineReads, path: string): Entry[] | undefined {
  if (!io.probe.exists(path)) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(io.read.text(path));
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
 * Reads the accepted violations of a config's baseline, for the engine and
 * for `applyBaseline`. Entries of a rule that `[tool.inwards.rules]` turns
 * off or down to a warning are left out: that rule reports no errors to
 * accept, and its entries must not count as fixed. They apply again once the
 * rule is back; `inwards baseline` keeps them (see `writeBaseline`).
 *
 * @param io - tells whether the baseline exists and reads it.
 * @param configPath - the pyproject.toml.
 * @param rules - the config's `[tool.inwards.rules]`, if any.
 * @returns accepted copies by baseline key, or undefined when there is no baseline.
 * @throws {ConfigError} when the file isn't a baseline this version understands.
 */
export function readBaseline(
  io: BaselineReads,
  configPath: string,
  rules: RuleSettings | undefined,
): Map<string, number> | undefined {
  const entries = readEntries(io, baselinePath(configPath));
  if (entries === undefined) {
    return undefined;
  }
  const accepted = new Map<string, number>();
  for (const e of entries.filter((entry) => !dormant(entry.code, rules))) {
    accepted.set(baselineKey(e), (accepted.get(baselineKey(e)) ?? 0) + e.count);
  }
  return accepted;
}

/**
 * Tells whether a rule's baseline entries are dormant: the rule reports no
 * errors, being off or turned down to a warning.
 *
 * @param code - the entry's rule code.
 * @param rules - the config's `[tool.inwards.rules]`, if any.
 * @returns true when the entry can't match anything now.
 */
function dormant(code: string, rules: RuleSettings | undefined): boolean {
  const level = ruleLevel(code, rules);
  return level === "off" || level === "warning";
}

/**
 * Drops the errors the baseline accepts, up to each entry's count, so a module
 * that gains a second copy of an accepted violation still fails. A warning
 * that matches an entry (a rule `[tool.inwards.rules]` raised to error when the
 * baseline was taken, back at its default now) is still there, so its entry
 * doesn't count as fixed; the warning is reported as usual.
 *
 * Findings an inline comment suppressed use up entries too, after the
 * reported ones, so their entries don't count as fixed; an error that does is
 * marked `baselined`, which keeps it hidden if the hooks don't honour its
 * suppression (see `session/agent-suppressions.ts`).
 *
 * @param accepted - accepted copies by baseline key, from `readBaseline`.
 * @param report - the check's report.
 * @param whole - true when the whole project was checked, so leftover entries were fixed.
 * @returns the report without accepted errors, with `baselined` (and `resolved` for a whole run).
 */
export function applyBaseline(
  accepted: ReadonlyMap<string, number>,
  report: Report,
  whole: boolean,
): Report {
  const left = new Map(accepted);
  let baselined = 0;
  const diagnostics = report.diagnostics.filter((d) => {
    const n = left.get(baselineKey(d)) ?? 0;
    if (n === 0) {
      return true;
    }
    left.set(baselineKey(d), n - 1);
    if (d.severity !== "error") {
      return true; // uses up the entry, but a warning is never hidden
    }
    baselined += 1;
    return false;
  });
  const suppressed = report.suppressed?.map((s) => {
    const n = left.get(baselineKey(s.diagnostic)) ?? 0;
    if (n === 0) {
      return s;
    }
    left.set(baselineKey(s.diagnostic), n - 1);
    return s.diagnostic.severity === "error" ? { ...s, baselined: true } : s;
  });
  const resolved = whole ? [...left.values()].reduce((sum, n) => sum + n, 0) : undefined;
  return {
    ...report,
    diagnostics,
    baselined,
    ...(suppressed === undefined ? {} : { suppressed }),
    ...(resolved === undefined ? {} : { resolved }),
  };
}

/**
 * Fingerprints each config's baseline, so the Stop gate can tell whether one
 * changed during a session. Never throws: a baseline that can't be read (a
 * directory, a dangling link) gets a marker instead, which differs from any hash.
 *
 * @param io - looks at and reads the baselines.
 * @param io.probe - tells what each baseline path is.
 * @param io.read - reads a baseline's bytes.
 * @param project - the project root.
 * @param configs - project-relative pyproject.toml paths.
 * @returns the SHA-256 or marker of each existing baseline, by the config's path, sorted.
 */
export function baselineHashes(
  io: { probe: Pick<PathProbe, "isLink" | "kind" | "exists">; read: Pick<FileReader, "bytes"> },
  project: string,
  configs: readonly string[],
): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const rel of [...configs].sort()) {
    const path = baselinePath(join(project, rel));
    if (io.probe.isLink(path) === undefined) {
      continue; // nothing there, not even a dangling link
    }
    hashes[rel] = baselineMark(io, path);
  }
  return hashes;
}

/**
 * Fingerprints one baseline path that exists (possibly as a dangling link).
 *
 * @param io - looks at and reads the path.
 * @param io.probe - tells what the path is.
 * @param io.read - reads its bytes.
 * @param path - the baseline path.
 * @returns its SHA-256, "not a file" for a directory or special file, or
 *   "unreadable" for a dangling link or a file that can't be read.
 */
function baselineMark(
  io: { probe: Pick<PathProbe, "kind" | "exists">; read: Pick<FileReader, "bytes"> },
  path: string,
): string {
  if (!io.probe.exists(path)) {
    return "unreadable";
  }
  if (io.probe.kind(path) !== "file") {
    return "not a file";
  }
  try {
    return createHash("sha256").update(io.read.bytes(path)).digest("hex");
  } catch {
    return "unreadable";
  }
}

/**
 * Lists the baselines that differ from the session start.
 *
 * @param io - looks at and reads the baselines.
 * @param io.probe - tells what each baseline path is.
 * @param io.read - reads a baseline's bytes.
 * @param project - the project root.
 * @param configs - the session-start configs' project-relative paths.
 * @param start - the baseline hashes recorded at session start, by config path.
 * @returns project-relative baseline paths that appeared, changed or went away.
 */
export function changedBaselines(
  io: { probe: Pick<PathProbe, "isLink" | "kind" | "exists">; read: Pick<FileReader, "bytes"> },
  project: string,
  configs: readonly string[],
  start: Record<string, string>,
): string[] {
  const now = baselineHashes(io, project, configs);
  return [...new Set([...Object.keys(start), ...Object.keys(now)])]
    .filter((rel) => start[rel] !== now[rel])
    .map((rel) => join(dirname(rel), BASELINE_FILE).replaceAll("\\", "/"));
}
