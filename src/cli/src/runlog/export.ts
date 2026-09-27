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
 *
 * Reading the logs and hashing are here; the key and the output file go
 * through the `ExportFiles` contract.
 */
import { createHmac } from "node:crypto";
import { join, resolve, sep } from "node:path";
import { ConfigError } from "@inwards/core";
import type { FileReader, PathProbe } from "../platform/contracts.ts";
import type { ExportFiles } from "./contracts.ts";
import { parseLine, type RunLine } from "./runs.ts";

const LINE_BREAK = /\r?\n/u;
/** Hex digits kept from an HMAC: 64 bits tell a project's files and violations apart. */
const HASH_LENGTH = 16;

/** What an export touches. */
export interface ExportIo {
  probe: Pick<PathProbe, "realpath">;
  read: Pick<FileReader, "text">;
  exports: ExportFiles;
}

/**
 * Writes the project's run logs, merged in time order, to one file readable
 * by the owner only.
 *
 * @param io - reads the logs, resolves paths, and keeps the key and the output.
 * @param dirs - directories that may hold `.inwards/` logs (see `logDirs`).
 * @param out - the file to write.
 * @param redact - with the project root: replace paths and fingerprints with keyed hashes.
 * @param redact.project - the project root, where the key lives.
 * @returns how many lines were written.
 * @throws {ConfigError} when `out` is one of the logs, or the key can't be used safely.
 */
export function exportRunLogs(
  io: ExportIo,
  dirs: readonly string[],
  out: string,
  redact?: { project: string },
): number {
  const logs = [...new Set(dirs)].flatMap((dir) =>
    ["runs.1.jsonl", "runs.jsonl"].map((name) => join(dir, ".inwards", name)),
  );
  const target = io.probe.realpath(resolve(out)) ?? resolve(out);
  if (
    target.split(sep).includes(".inwards") ||
    logs.some((log) => io.probe.realpath(log) === target)
  ) {
    throw new ConfigError(`${out} is inside .inwards/ or is a run log; export to another file.`);
  }
  const hash = redact ? keyedHash(io.exports.exportKey(redact.project)) : undefined;
  const lines = logs
    .flatMap((log) => readKnownLines(io, log))
    .sort((a, b) => Date.parse(String(a["at"])) - Date.parse(String(b["at"])))
    .map((line) => (hash ? redactLine(line, hash) : line));
  io.exports.writeOwnerOnly(out, lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
  return lines.length;
}

/**
 * Reads a log file's lines that `stats` would read, keeping known fields only.
 *
 * @param io - reads the file.
 * @param path - the log file.
 * @returns the lines, or none when the file doesn't exist.
 */
function readKnownLines(io: Pick<ExportIo, "read">, path: string): Record<string, unknown>[] {
  let text = "";
  try {
    text = io.read.text(path);
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
 * Makes the keyed hash from the project's export key.
 *
 * @param key - the project's export key.
 * @returns text to a 16-hex-digit HMAC-SHA256.
 */
function keyedHash(key: string): (text: string) => string {
  return (text: string): string =>
    createHmac("sha256", key).update(text).digest("hex").slice(0, HASH_LENGTH);
}
