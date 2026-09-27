/**
 * Finding the project `inwards init --style` works on: the nearest
 * pyproject.toml, its import package, and whether it uses a src layout.
 */
import { dirname, join, relative } from "node:path";
import { inwardsTable } from "@inwards/core";
import { isRecord } from "../json/guards.ts";
import { posix } from "../paths/lexical.ts";
import type { FileReader, PathProbe, Runtime } from "../platform/contracts.ts";
import type { Target } from "./contracts.ts";

/** What finding the target reads. */
interface TargetIo {
  probe: Pick<PathProbe, "exists" | "kind" | "isLink">;
  read: Pick<FileReader, "text" | "list">;
  runtime: Pick<Runtime, "cwd">;
}

const PACKAGE_NAME = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/u;
const NAME_SEPARATORS = /[-_.]+/gu;
/** Python's hard keywords: `import class` is a syntax error, so none can name a package. */
const KEYWORDS: ReadonlySet<string> = new Set(
  "False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(
    " ",
  ),
);
/**
 * Finds the nearest pyproject.toml above the cwd and reads what init needs.
 *
 * @param io - probes and reads files, and knows the cwd.
 * @param pkgFlag - `--package`, if given.
 * @returns the target, or an error message.
 * @throws when the pyproject.toml exists but can't be read.
 */
export function findTarget(io: TargetIo, pkgFlag: string | undefined): Target | string {
  let dir = io.runtime.cwd;
  while (!io.probe.exists(join(dir, "pyproject.toml"))) {
    if (dirname(dir) === dir) {
      return "no pyproject.toml here or above. Create the project first, e.g. `uv init --package app`.";
    }
    dir = dirname(dir);
  }
  const path = join(dir, "pyproject.toml");
  const text = io.read.text(path);
  const table = inwardsTable(text);
  if (table === null) {
    return `${path} is not valid TOML; fix it first.`;
  }
  if (pkgFlag !== undefined && !isPackageName(pkgFlag)) {
    return `--package ${pkgFlag} is not a Python package name.`;
  }
  return { path, text, configured: table !== undefined, pkg: pkgFlag ?? projectPackage(text) };
}

/**
 * Reads `[project].name` and turns it into the import package the way uv
 * does: lowercase, with runs of `-`, `_` and `.` made one `_`.
 *
 * @param text - the pyproject.toml text.
 * @returns the package, or undefined when there is no usable name.
 */
function projectPackage(text: string): string | undefined {
  const doc = parseToml(text);
  const project = isRecord(doc) ? doc["project"] : undefined;
  const name = isRecord(project) ? project["name"] : undefined;
  if (typeof name !== "string") {
    return undefined;
  }
  const pkg = name.toLowerCase().replace(NAME_SEPARATORS, "_");
  return isPackageName(pkg) ? pkg : undefined;
}

/**
 * Parses TOML, returning undefined instead of throwing.
 *
 * @param text - the pyproject.toml text.
 * @returns the document, or undefined when it doesn't parse.
 */
function parseToml(text: string): unknown {
  try {
    return Bun.TOML.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Tells whether a dotted name can be imported: identifiers, none a keyword.
 *
 * @param name - e.g. `my_app` or `acme.shop`.
 * @returns false for `my-app`, `1app` or `class`.
 */
function isPackageName(name: string): boolean {
  return PACKAGE_NAME.test(name) && !name.split(".").some((part) => KEYWORDS.has(part));
}

/**
 * Says that init can't tell the import package.
 *
 * @param cwd - the working directory.
 * @param path - the pyproject.toml.
 * @returns the message.
 */
export function noPackage(cwd: string, path: string): string {
  return `inwards init: ${shown(cwd, path)} has no usable [project].name; name the import package with --package.`;
}

/**
 * Shows a path relative to the cwd, with forward slashes, as the rest of the output does.
 *
 * @param cwd - the working directory.
 * @param path - an absolute path.
 * @returns the relative path, e.g. `pyproject.toml` or `../pyproject.toml`.
 */
export function shown(cwd: string, path: string): string {
  return posix(relative(cwd, path));
}

/**
 * Picks the config root: `src` for a src layout, `.` otherwise. Before the
 * package exists, `src` wins when the build backend is uv_build (whose
 * module root is `src`) or `src/` already holds Python code; an unrelated
 * `src/` (a frontend, say) doesn't count.
 *
 * @param io - looks at the directories.
 * @param project - the project directory.
 * @param pkg - the import package.
 * @param text - the pyproject.toml text, for the build backend.
 * @returns `src` or `.`.
 * @throws when `src/` is a directory that can't be listed.
 */
export function sourceRoot(
  io: Pick<TargetIo, "probe" | "read">,
  project: string,
  pkg: string,
  text: string,
): string {
  const rel = pkg.replaceAll(".", "/");
  if (io.probe.kind(join(project, "src", rel)) === "dir") {
    return "src";
  }
  if (io.probe.kind(join(project, rel)) === "dir") {
    return ".";
  }
  return usesUvBuild(text) || holdsPython(io, join(project, "src")) ? "src" : ".";
}

/**
 * Tells whether pyproject.toml builds with uv_build, as `uv init --package` sets up.
 *
 * @param text - the pyproject.toml text.
 * @returns true for `build-backend = "uv_build"`.
 */
function usesUvBuild(text: string): boolean {
  const doc = parseToml(text);
  const build = isRecord(doc) ? doc["build-system"] : undefined;
  return isRecord(build) && build["build-backend"] === "uv_build";
}

/**
 * Tells whether a directory holds Python code at its top level: a `.py` file
 * or a package (a directory with `__init__.py`).
 *
 * @param io - lists the directory and looks for `__init__.py`.
 * @param dir - the directory.
 * @returns false when it is missing or holds no Python.
 */
function holdsPython(io: Pick<TargetIo, "probe" | "read">, dir: string): boolean {
  return (io.read.list(dir) ?? []).some(
    (entry) =>
      (entry.file && entry.name.endsWith(".py")) ||
      (entry.dir && io.probe.isLink(join(dir, entry.name, "__init__.py")) !== undefined),
  );
}
