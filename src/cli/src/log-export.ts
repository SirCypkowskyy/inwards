/**
 * `inwards stats --export FILE [--redact]`: one file a design partner can
 * send, holding every run-log line of the project in time order.
 *
 * Each line is rebuilt from the `inwards/run@1` fields with checked types,
 * from lines `stats` itself would read, so nothing else a line holds (an
 * extra key, a nested object, a field added later) slips out.
 * With `--redact`, every path and every fingerprint is replaced by an HMAC
 * keyed by `.inwards/export-key`. The fingerprints need it too: they are
 * unkeyed hashes of rule, module and message, so a dictionary of likely
 * module names would reverse them. The key is made once per project and
 * never leaves the machine; the receiver can tell files and violations apart
 * but can't guess what they are.
 */
import { createHmac, randomBytes } from "node:crypto";
import { closeSync, constants, lstatSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { ConfigError } from "@inwards/core";
import { realpath } from "./paths.ts";
import { parseLine, type RunLine } from "./runs.ts";

const LINE_BREAK = /\r?\n/u;
const KEY_BYTES = 32;
const KEY_FORMAT = /^[0-9a-f]{64}$/u;
/** Hex digits kept from an HMAC: 64 bits tell a project's files and violations apart. */
const HASH_LENGTH = 16;
/** O_NOFOLLOW where the OS has it (not on Windows), so a planted symlink isn't read. */
const NO_FOLLOW: number = constants.O_NOFOLLOW ?? 0;
const OWNER_ONLY = 0o600;

/**
 * Writes the project's run logs, merged in time order, to one file readable
 * by the owner only.
 *
 * @param dirs - directories that may hold `.inwards/` logs (see `logDirs`).
 * @param out - the file to write.
 * @param redact - with the project root: replace paths and fingerprints with keyed hashes.
 * @param redact.project - the project root, where the key lives.
 * @returns how many lines were written.
 * @throws {ConfigError} when `out` is one of the logs, or the key can't be used safely.
 */
export function exportRunLogs(
  dirs: readonly string[],
  out: string,
  redact?: { project: string },
): number {
  const logs = [...new Set(dirs)].flatMap((dir) =>
    ["runs.1.jsonl", "runs.jsonl"].map((name) => join(dir, ".inwards", name)),
  );
  const target = realpath(resolve(out)) ?? resolve(out);
  if (target.split(sep).includes(".inwards") || logs.some((log) => realpath(log) === target)) {
    throw new ConfigError(`${out} is inside .inwards/ or is a run log; export to another file.`);
  }
  const hash = redact ? keyedHash(redact.project) : undefined;
  const lines = logs
    .flatMap(readKnownLines)
    .sort((a, b) => Date.parse(String(a["at"])) - Date.parse(String(b["at"])))
    .map((line) => (hash ? redactLine(line, hash) : line));
  writeFileSync(out, lines.map((line) => `${JSON.stringify(line)}\n`).join(""), {
    mode: OWNER_ONLY,
  });
  return lines.length;
}

/**
 * Reads a log file's lines that `stats` would read, keeping known fields only.
 *
 * @param path - the log file.
 * @returns the lines, or none when the file doesn't exist.
 */
function readKnownLines(path: string): Record<string, unknown>[] {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return []; // no such file: nothing logged there
  }
  return text.split(LINE_BREAK).flatMap((raw) => {
    const known = parseLine(raw);
    return known === undefined ? [] : [rebuild(known, JSON.parse(raw))];
  });
}

/**
 * Rebuilds one line from checked values only, so nothing a line holds beyond
 * the `inwards/run@1` schema (an extra key, a nested object, a later field)
 * goes out.
 *
 * @param known - the line as `parseLine` read it.
 * @param raw - the same line as parsed JSON, for the fields `RunLine` doesn't keep.
 * @returns the line with schema fields and checked types only.
 */
function rebuild(known: RunLine, raw: Record<string, unknown>): Record<string, unknown> {
  const tool = raw["tool"];
  const exit = raw["exit"];
  const removed = new Map(
    (Array.isArray(raw["lines"]) ? raw["lines"] : []).map((c: Record<string, unknown>) => [
      c["file"],
      c["removed"],
    ]),
  );
  return {
    v: 1,
    at: known.at,
    session_id: known.session_id,
    event: known.event,
    tool: typeof tool === "string" ? tool : null,
    files: known.files,
    lines: known.lines.map((c) => ({
      file: c.file,
      added: c.added,
      removed: Number(removed.get(c.file)) || 0,
    })),
    fingerprints: known.fingerprints,
    ...(known.codes ? { codes: known.codes } : {}),
    ...(known.severities ? { severities: known.severities } : {}),
    ...(typeof exit === "number" ? { exit } : {}),
    durationMs: known.durationMs,
  };
}

/**
 * Replaces the paths and fingerprints in one log line.
 *
 * @param line - one log line, known fields only.
 * @param hash - the keyed hash.
 * @returns a copy with `files`, `lines[].file` and `fingerprints` hashed.
 */
function redactLine(
  line: Record<string, unknown>,
  hash: (text: string) => string,
): Record<string, unknown> {
  const counts = Array.isArray(line["lines"]) ? line["lines"] : [];
  return {
    ...line,
    files: strings(line["files"]).map((f) => (f === "." ? f : hash(f))),
    lines: counts.map((c: Record<string, unknown>) => ({
      file: hash(String(c["file"])),
      added: c["added"],
      removed: c["removed"],
    })),
    fingerprints: strings(line["fingerprints"]).map(hash),
  };
}

/**
 * Keeps the strings of a parsed array.
 *
 * @param value - a field that should be a string array.
 * @returns its strings, or none when it isn't an array.
 */
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Makes the keyed hash from the project's key, creating the key on first use.
 *
 * @param project - the project root.
 * @returns text to a 16-hex-digit HMAC-SHA256.
 * @throws {ConfigError} when `.inwards` or the key is a symlink, or the key is malformed.
 */
function keyedHash(project: string): (text: string) => string {
  const dir = join(project, ".inwards");
  if (lstatSync(dir, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new ConfigError(`${dir} is a symlink; the export key must stay in the project.`);
  }
  const key = readKey(join(dir, "export-key")) ?? createKey(dir);
  return (text: string): string =>
    createHmac("sha256", key).update(text).digest("hex").slice(0, HASH_LENGTH);
}

/**
 * Reads the key without following a symlink.
 *
 * @param path - the key file.
 * @returns the key, or undefined when there is none yet.
 * @throws {ConfigError} when the file isn't 64 hex digits.
 */
function readKey(path: string): string | undefined {
  if (lstatSync(path, { throwIfNoEntry: false }) === undefined) {
    return undefined;
  }
  let fd: number;
  try {
    // biome-ignore lint/suspicious/noBitwiseOperators: open(2) flags are a bit set.
    fd = openSync(path, constants.O_RDONLY | NO_FOLLOW);
  } catch (err) {
    throw new ConfigError(`${path} can't be read safely (a symlink?).`, { cause: err });
  }
  try {
    const key = readFileSync(fd, "utf8").trim();
    if (!KEY_FORMAT.test(key)) {
      throw new ConfigError(
        `${path} isn't an export key (64 hex digits). Delete it to make a new one.`,
      );
    }
    return key;
  } finally {
    closeSync(fd);
  }
}

/**
 * Creates the key, or reads the one a concurrent export just created.
 *
 * @param dir - the project's `.inwards/`.
 * @returns the key.
 */
function createKey(dir: string): string {
  const path = join(dir, "export-key");
  const key = randomBytes(KEY_BYTES).toString("hex");
  try {
    writeFileSync(path, `${key}\n`, { mode: OWNER_ONLY, flag: "wx" });
    return key;
  } catch {
    return readKey(path) ?? key; // another export won the race: use its key
  }
}
