/**
 * @file Python module names from file paths, and relative imports resolved
 * against a package, as the interpreter computes them. Pure string work: no
 * parsing and no file system.
 */
import type { SourceFile } from "../contracts/records.ts";

/**
 * Returns the package a file's relative imports start from, as name parts.
 * That is the file's own module for `__init__.py` and its parent otherwise,
 * the value Python stores in `__package__`.
 *
 * @param file - the importing file.
 * @returns the package's dotted name split into parts.
 */
export function packageOf(file: SourceFile): string[] {
  const pkg = file.module.split(".");
  if (!file.isPackage) {
    pkg.pop();
  }
  return pkg;
}

/**
 * Resolves a relative module name against a package.
 * Level 1 is the package itself, and each extra level climbs one package up,
 * as the dots of `from ..x import y` or the `level` of `__import__` do. Like
 * Python, it refuses to climb past the top-level package, and refuses any
 * level in a top-level module, which has no package.
 *
 * @param pkg - the package the name is relative to, split into parts.
 * @param level - the number of leading dots, 1 or more.
 * @param rest - the dotted name after the dots, if any.
 * @returns the dotted module name, or null if the level climbs above the top-level package.
 */
export function resolveRelative(
  pkg: readonly string[],
  level: number,
  rest: string | undefined,
): string | null {
  const up = level - 1;
  if (up >= pkg.length) {
    return null;
  }
  const parts = pkg.slice(0, pkg.length - up);
  if (rest) {
    parts.push(rest);
  }
  return parts.join(".");
}

const PYTHON_SUFFIX = /\.pyi?$/u;

/**
 * Derives the dotted module name of a Python file from its path.
 * `shop/domain/order.py` becomes `shop.domain.order` and `shop/__init__.py`
 * becomes `shop` (a package). Accepts `\` or `/` separators and `.py` or `.pyi`.
 *
 * @param relativePath - path of the file relative to the configured root.
 * @returns the module name and whether the file is a package's `__init__`.
 */
export function moduleNameFor(relativePath: string): { module: string; isPackage: boolean } {
  const parts = relativePath.replaceAll("\\", "/").replace(PYTHON_SUFFIX, "").split("/");
  const isPackage = parts.at(-1) === "__init__";
  if (isPackage) {
    parts.pop();
  }
  return { module: parts.filter(Boolean).join("."), isPackage };
}
