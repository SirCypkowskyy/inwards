/**
 * What an Edit, Write or MultiEdit would do, worked out before it runs, for
 * the config guard. The simulation follows Claude Code's own matching: the
 * file is read with its BOM stripped and CRLF turned into LF, and an empty
 * `old_string` creates a file that is missing or blank. Claude Code also
 * retries with curly quotes straightened and `\uXXXX` escapes decoded; the
 * guard doesn't, and denies an edit it can't simulate on a protected file
 * instead, so a looser match can't slip a change past it.
 */
import { lstatSync, readlinkSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { physicalRealpath } from "../paths/lexical.ts";

const BOM = "﻿";

/**
 * Normalises file text the way Claude Code does before matching an edit.
 *
 * @param text - the file's text.
 * @returns the text without a BOM and with LF line ends.
 */
export function normalised(text: string): string {
  return (text.startsWith(BOM) ? text.slice(1) : text).replaceAll("\r\n", "\n");
}

/**
 * Applies an Edit, Write or MultiEdit to a file's text, as the tool would.
 *
 * @param before - the current text, normalised ("" for a new file).
 * @param tool - the tool name.
 * @param input - the tool's input.
 * @returns the new text, or undefined when the edit can't be simulated exactly.
 */
export function applyEdit(
  before: string,
  tool: unknown,
  input: Record<string, unknown>,
): string | undefined {
  if (tool === "Write") {
    return typeof input["content"] === "string" ? normalised(input["content"]) : undefined;
  }
  let edits: unknown;
  if (tool === "MultiEdit") {
    edits = input["edits"];
  } else if (tool === "Edit") {
    edits = [input];
  }
  if (!Array.isArray(edits)) {
    return undefined;
  }
  let text: string | undefined = before;
  for (const edit of edits) {
    text = text === undefined || !isRecord(edit) ? undefined : replaceOnce(text, edit);
  }
  return text;
}

/**
 * Applies one `old_string` → `new_string` replacement.
 *
 * @param text - the text so far.
 * @param edit - `old_string`, `new_string` and optional `replace_all`.
 * @returns the replaced text, or undefined when `old_string` isn't there verbatim.
 */
function replaceOnce(text: string, edit: Record<string, unknown>): string | undefined {
  const { old_string: from, new_string: to, replace_all: all } = edit;
  if (typeof from !== "string" || typeof to !== "string") {
    return undefined;
  }
  const [a, b] = [normalised(from), normalised(to)];
  if (a === "") {
    return text.trim() === "" ? b : undefined; // creates a missing or blank file
  }
  if (!text.includes(a)) {
    return undefined;
  }
  return all === true ? text.replaceAll(a, b) : text.replace(a, () => b);
}

/**
 * Resolves a tool's `file_path` as written: trimmed, `~/` expanded, made absolute.
 *
 * @param base - the directory a relative path is resolved against.
 * @param file - the path as given.
 * @returns the absolute path, symlinks not resolved.
 */
export function lexicalPath(base: string, file: string): string {
  const trimmed = file.trim();
  const home = trimmed.startsWith("~/") ? join(homedir(), trimmed.slice(2)) : trimmed;
  return resolve(base, home);
}

/**
 * Resolves where a path would land if written: the real path of its nearest
 * existing ancestor, plus the rest. A symlink can't make `.inwards` look like
 * another directory.
 *
 * @param base - the directory a relative path is resolved against.
 * @param file - the path as given.
 * @returns the real landing path, or undefined when nothing on the way exists.
 */
export function landingPath(base: string, file: string): string | undefined {
  const full = lexicalPath(base, file);
  const real = physicalRealpath(base, full);
  if (real !== undefined) {
    return real;
  }
  const link = danglingTarget(full);
  if (link !== undefined) {
    return landingPath(dirname(full), link); // writing through it creates the target
  }
  const parent = dirname(full);
  if (parent === full) {
    return undefined;
  }
  const landed = landingPath(base, parent);
  return landed === undefined ? undefined : join(landed, basename(full));
}

/**
 * Reads a symlink whose target doesn't exist yet.
 *
 * @param path - any path.
 * @returns the link's target as written, or undefined when it isn't a symlink.
 */
function danglingTarget(path: string): string | undefined {
  try {
    return lstatSync(path).isSymbolicLink() ? readlinkSync(path) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Tells whether a parsed JSON value is a plain object.
 *
 * @param value - any parsed JSON value.
 * @returns true for a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
