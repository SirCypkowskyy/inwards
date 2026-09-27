/**
 * Finding the project `inwards init --style` works on: the nearest
 * pyproject.toml, its import package, and whether it uses a src layout.
 */
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import process from "node:process";
import { inwardsTable } from "@inwards/core";
import { posix } from "../paths/lexical.ts";
import { isRecord } from "./agents.ts";
import { isDir } from "./report.ts";

/** A pyproject.toml found from the cwd, and what init needs to know about it. */
export interface Target {
  path: string;
  text: string;
  /** True when it already has `[tool.inwards]`. */
  configured: boolean;
  /** The import package: `--package`, or `[project].name` normalised; undefined when neither is set. */
  pkg: string | undefined;
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
 * @param pkgFlag - `--package`, if given.
 * @returns the target, or an error message.
 */
export function findTarget(pkgFlag: string | undefined): Target | string {
  let dir = process.cwd();
  while (!existsSync(join(dir, "pyproject.toml"))) {
    if (dirname(dir) === dir) {
      return "no pyproject.toml here or above. Create the project first, e.g. `uv init --package app`.";
    }
    dir = dirname(dir);
  }
  const path = join(dir, "pyproject.toml");
  const text = readFileSync(path, "utf8");
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
 * @param path - the pyproject.toml.
 * @returns the message.
 */
export function noPackage(path: string): string {
  return `inwards init: ${shown(path)} has no usable [project].name; name the import package with --package.`;
}

/**
 * Shows a path relative to the cwd, with forward slashes, as the rest of the output does.
 *
 * @param path - an absolute path.
 * @returns the relative path, e.g. `pyproject.toml` or `../pyproject.toml`.
 */
export function shown(path: string): string {
  return posix(relative(process.cwd(), path));
}

/**
 * Picks the config root: `src` for a src layout, `.` otherwise. Before the
 * package exists, `src` wins when the build backend is uv_build (whose
 * module root is `src`) or `src/` already holds Python code; an unrelated
 * `src/` (a frontend, say) doesn't count.
 *
 * @param project - the project directory.
 * @param pkg - the import package.
 * @param text - the pyproject.toml text, for the build backend.
 * @returns `src` or `.`.
 */
export function sourceRoot(project: string, pkg: string, text: string): string {
  const rel = pkg.replaceAll(".", "/");
  if (isDir(join(project, "src", rel))) {
    return "src";
  }
  if (isDir(join(project, rel))) {
    return ".";
  }
  return usesUvBuild(text) || holdsPython(join(project, "src")) ? "src" : ".";
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
 * @param dir - the directory.
 * @returns false when it is missing or holds no Python.
 */
function holdsPython(dir: string): boolean {
  if (!isDir(dir)) {
    return false;
  }
  return readdirSync(dir, { withFileTypes: true }).some(
    (entry) =>
      (entry.isFile() && entry.name.endsWith(".py")) ||
      (entry.isDirectory() &&
        lstatSync(join(dir, entry.name, "__init__.py"), { throwIfNoEntry: false }) !== undefined),
  );
}
