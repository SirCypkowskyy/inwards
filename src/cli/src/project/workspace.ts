/**
 * @file Finds the uv workspace a project belongs to and the top-level import
 * packages of its members, so INW005 can call an import of a sibling member a
 * "workspace package" rather than a library (#203). It reads through the
 * injected `ProjectIo` and parses TOML with the function it is given; it
 * decides nothing about which imports are allowed.
 *
 * Member globs support `*` inside a path segment only (`packages/*`,
 * `libs/qv_*`); `**`, `?` and character classes match nothing.
 */
import { dirname, join } from "node:path";
import { isRecord } from "../json/guards.ts";
import type { ProjectIo } from "./contracts.ts";

/** What the discovery reads: files, directory listings, path kinds and TOML. */
type WorkspaceIo = Pick<ProjectIo, "probe" | "read" | "toml">;

/** A Python identifier, the shape a top-level import package has. */
const IDENTIFIER = /^[\p{XID_Start}_]\p{XID_Continue}*$/u;

/**
 * Names the import packages of every member of the nearest uv workspace at or
 * above a config's directory. The answer only changes wording, so anything
 * that can't be read (a broken pyproject.toml, an unreadable directory)
 * gives no names rather than failing the check.
 *
 * @param io - reads the pyproject.toml files and lists the member directories.
 * @param configDir - absolute directory of the config's pyproject.toml.
 * @returns the members' top-level import packages; empty outside a workspace.
 */
export function workspacePackages(io: WorkspaceIo, configDir: string): Set<string> {
  try {
    const found = workspaceRoot(io, configDir);
    if (found === undefined) {
      return new Set();
    }
    const exclude = found.exclude.flatMap((glob) => expand(io, found.dir, glob));
    const members = found.members
      .flatMap((glob) => expand(io, found.dir, glob))
      .filter((dir) => !exclude.includes(dir));
    return new Set(members.flatMap((dir) => memberPackages(io, dir)));
  } catch {
    return new Set();
  }
}

/**
 * Walks up from a directory to the first pyproject.toml with a
 * `[tool.uv.workspace]` table, the way uv finds a member's workspace root.
 *
 * @param io - probes and reads the pyproject.toml files.
 * @param start - the directory to start from.
 * @returns the workspace root with its member and exclude globs, or undefined.
 */
function workspaceRoot(
  io: WorkspaceIo,
  start: string,
): { dir: string; members: string[]; exclude: string[] } | undefined {
  for (let dir = start; ; dir = dirname(dir)) {
    const table = workspaceTable(io, join(dir, "pyproject.toml"));
    if (table !== undefined) {
      return { dir, members: strings(table["members"]), exclude: strings(table["exclude"]) };
    }
    if (dirname(dir) === dir) {
      return undefined;
    }
  }
}

/**
 * Reads the `[tool.uv.workspace]` table of a pyproject.toml.
 *
 * @param io - probes, reads and parses the file.
 * @param path - the pyproject.toml, which may be missing.
 * @returns the table, or undefined when the file or the table is missing.
 */
function workspaceTable(io: WorkspaceIo, path: string): Record<string, unknown> | undefined {
  if (io.probe.kind(path) !== "file") {
    return undefined;
  }
  const doc = io.toml(io.read.text(path));
  const tool = isRecord(doc) ? doc["tool"] : undefined;
  const uv = isRecord(tool) ? tool["uv"] : undefined;
  const workspace = isRecord(uv) ? uv["workspace"] : undefined;
  return isRecord(workspace) ? workspace : undefined;
}

/**
 * Keeps the strings of a TOML array.
 *
 * @param value - any parsed value.
 * @returns its string items, or none when it isn't an array.
 */
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

/**
 * Expands a member glob against the directories under the workspace root.
 *
 * @param io - lists directories and tells what a path is.
 * @param root - the workspace root.
 * @param glob - e.g. `packages/*`; only `*` inside a segment is a wildcard.
 * @returns the existing directories it matches.
 */
function expand(io: WorkspaceIo, root: string, glob: string): string[] {
  let dirs = [root];
  for (const segment of glob.split("/").filter((s) => s !== "" && s !== ".")) {
    if (!segment.includes("*")) {
      dirs = dirs.map((dir) => join(dir, segment));
      continue;
    }
    const pattern = new RegExp(`^${segment.split("*").map(escapeRegex).join(".*")}$`, "u");
    dirs = dirs.flatMap((dir) =>
      (io.read.list(dir) ?? [])
        .filter((entry) => pattern.test(entry.name))
        .map((entry) => join(dir, entry.name)),
    );
  }
  return dirs.filter((dir) => io.probe.kind(dir) === "dir");
}

/**
 * Escapes a literal piece of a glob for a regular expression.
 *
 * @param text - the text between two `*`.
 * @returns the text with every regex metacharacter escaped.
 */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Names a member's top-level import packages: its `[project] name` made an
 * import name the way uv does, the directories under `src/`, and without a
 * `src/` the directories with an `__init__.py` next to its pyproject.toml.
 *
 * @param io - reads the member's pyproject.toml and lists its directories.
 * @param dir - the member directory.
 * @returns the member's packages; none when it has no pyproject.toml.
 */
function memberPackages(io: WorkspaceIo, dir: string): string[] {
  const path = join(dir, "pyproject.toml");
  if (io.probe.kind(path) !== "file") {
    return [];
  }
  const doc = io.toml(io.read.text(path));
  const project = isRecord(doc) ? doc["project"] : undefined;
  const name = isRecord(project) ? project["name"] : undefined;
  const named = typeof name === "string" ? [name.toLowerCase().replace(/[-_.]+/gu, "_")] : [];
  const src = join(dir, "src");
  const layout =
    io.probe.kind(src) === "dir"
      ? subdirs(io, src)
      : subdirs(io, dir).filter((pkg) => io.probe.kind(join(dir, pkg, "__init__.py")) === "file");
  return [...named, ...layout].filter((pkg) => IDENTIFIER.test(pkg));
}

/**
 * Lists the subdirectories of a directory.
 *
 * @param io - lists the directory.
 * @param dir - the directory.
 * @returns the names of its subdirectories, symlinks left out.
 */
function subdirs(io: WorkspaceIo, dir: string): string[] {
  return (io.read.list(dir) ?? []).filter((entry) => entry.dir).map((entry) => entry.name);
}
