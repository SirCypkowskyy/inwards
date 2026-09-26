/**
 * INW007 package-shape and INW008 missing-member: which members a package may,
 * must and must not hold (`[[tool.inwards.shape]]`), and where a member name
 * may appear (`[[tool.inwards.names]]`).
 *
 * - `checkShape` is pure: it reads only the file's path, so the engine runs it
 *   on every file, parsed or not.
 * - `checkRequired` asks a `ListMembers` port what a package holds. Adapters
 *   build one from a directory listing (`probeMembers`) or from the files they
 *   already have (`membersFrom`).
 * - `checkSelectors` warns about a shape selector that matches no package.
 */
import type { InwardsConfig } from "./config.ts";
import { type ConfigFile, spanOf } from "./layout.ts";
import { diagnostic, RULES } from "./rules.ts";
import { memberMatches, selects, shapeFor } from "./shape-config.ts";
import { type Misfit, missingFinding, nameFinding, shapeFinding } from "./shape-fix.ts";
import type { Diagnostic, Fix, Severity, SourceFile, Span } from "./types.ts";

/**
 * Lists a package's direct members, the port INW008 needs from the adapter.
 *
 * @param pkg - a dotted package name under the config root.
 * @returns member names (`x.py`, `x.pyi`, `x/`), or undefined when the package doesn't exist.
 */
export type ListMembers = (pkg: string) => readonly string[] | undefined;

/** What an adapter's file system holds in a directory. */
export type ListDir = (relDir: string) => readonly { name: string; dir: boolean }[] | undefined;

/** What a misplaced member is reported as. */
interface Problem {
  message: string;
  fix: Fix;
  severity: Severity;
}

const FIRST_LINE: Span = { line: 1, column: 1, endLine: 1, endColumn: 1 };
const PYTHON = /\.pyi?$/u;
const INIT = /^__init__\.pyi?$/u;
const SEPARATOR = /[\\/]/u;

/**
 * Applies INW007 to a file: every package on its path that a shape or a names
 * rule covers must allow the member the file sits in. `app/orders/services/x.py`
 * is member `services/` of `app.orders` and member `x.py` of
 * `app.orders.services`. A names rule is checked first, then `forbid`, then
 * `allow` (`require` and `__init__` are always allowed).
 *
 * Hidden files and directories are skipped, as every file walk skips them:
 * Python can't import them under a dotted name either.
 *
 * @param file - the source file; only its path, module name and kind are read.
 * @param config - the shapes and names rules.
 * @returns one diagnostic per misplaced member, on line 1.
 */
export function checkShape(file: SourceFile, config: InwardsConfig): Diagnostic[] {
  const { shape = [], names = [] } = config;
  const parts = rootPathOf(file).split("/");
  if ((shape.length === 0 && names.length === 0) || !visible(parts)) {
    return [];
  }
  const found: Diagnostic[] = [];
  // The last part is the file itself; `__init__.py` needs no check, it is always allowed.
  parts.slice(0, file.isPackage ? -1 : undefined).forEach((name, i, all) => {
    const pkg = parts.slice(0, i).join(".");
    const member = i === all.length - 1 && !file.isPackage ? name : `${name}/`;
    const problem = memberProblem({ pkg, member }, config);
    if (problem) {
      found.push(diagnostic(RULES.INW007, file, { span: FIRST_LINE, ...problem }));
    }
  });
  return found;
}

/**
 * Applies INW008 to packages: each member a package's shape requires must be
 * there. The diagnostic sits on the package's `__init__.py`, or its first file
 * without one; its module is the package, so a baseline entry survives the
 * file it sits on changing.
 *
 * @param config - the shapes.
 * @param packages - the packages to check; only those a shape with `require` covers are listed.
 * @param members - lists what a package holds.
 * @param root - the config root as report paths show it (`""` or `src`).
 * @returns one error per missing member.
 */
export function checkRequired(
  config: InwardsConfig,
  packages: Iterable<string>,
  members: ListMembers,
  root = "",
): Diagnostic[] {
  const found: Diagnostic[] = [];
  for (const pkg of [...packages].sort()) {
    const require = shapeFor(config.shape ?? [], pkg)?.require ?? [];
    const listed = require.length === 0 ? undefined : members(pkg);
    const missing = require.filter((p) => !listed?.some((m) => memberMatches(p, m)));
    if (listed === undefined || missing.length === 0) {
      continue;
    }
    const anchor =
      listed.find((m) => INIT.test(m)) ?? [...listed].sort().find((m) => PYTHON.test(m));
    const dir = pkg.replaceAll(".", "/");
    const path = [root, dir, anchor ?? "__init__.py"].filter(Boolean).join("/");
    const file: SourceFile = { path, module: pkg, isPackage: true, text: "" };
    for (const pattern of missing) {
      found.push(
        diagnostic(RULES.INW008, file, { span: FIRST_LINE, ...missingFinding(pkg, pattern) }),
      );
    }
  }
  return found;
}

/**
 * Warns about shape selectors that match no package, often a typo.
 *
 * @param config - the shapes.
 * @param packages - every package under the config root.
 * @param file - the pyproject.toml, to point at each selector.
 * @returns one INW007 warning per dead selector.
 */
export function checkSelectors(
  config: InwardsConfig,
  packages: ReadonlySet<string>,
  file: ConfigFile,
): Diagnostic[] {
  const source: SourceFile = { path: file.path, module: "", isPackage: false, text: file.text };
  const dead = (config.shape ?? [])
    .flatMap((shape) => shape.packages)
    .filter((selector) => ![...packages].some((pkg) => selects(selector, pkg)));
  return [...new Set(dead)].map((selector) =>
    diagnostic(RULES.INW007, source, {
      span: spanOf(file.text, selector),
      severity: "warning",
      message: `Shape selector "${selector}" matches no package.`,
      fix: {
        summary: `Ask the user to fix or remove "${selector}" in [[tool.inwards.shape]].`,
        steps: [
          "Check the selector for a typo: a selector that matches nothing leaves those packages unshaped.",
          "Don't edit [tool.inwards] yourself; tell the user.",
        ],
      },
    }),
  );
}

/**
 * Builds a ListMembers from an adapter's directory listing: Python files and
 * subdirectories, without hidden entries and `__pycache__`.
 *
 * @param list - lists a forward-slash directory relative to the config root.
 * @returns the port.
 */
export function probeMembers(list: ListDir): ListMembers {
  return (pkg: string) =>
    list(pkg.replaceAll(".", "/"))?.flatMap(({ name, dir }) => {
      if (name.startsWith(".") || name === "__pycache__") {
        return [];
      }
      if (dir) {
        return [`${name}/`];
      }
      return PYTHON.test(name) ? [name] : [];
    });
}

/**
 * Builds a ListMembers from Python files the adapter already knows about.
 *
 * @param paths - forward-slash paths relative to the config root.
 * @returns the port; a package holding no Python file doesn't exist for it.
 */
export function membersFrom(paths: Iterable<string>): ListMembers {
  const byPackage = new Map<string, Set<string>>();
  for (const path of paths) {
    const parts = path.split("/");
    if (!visible(parts)) {
      continue;
    }
    parts.forEach((name, i) => {
      const pkg = parts.slice(0, i).join(".");
      const member = i === parts.length - 1 ? name : `${name}/`;
      byPackage.set(pkg, (byPackage.get(pkg) ?? new Set()).add(member));
    });
  }
  return (pkg: string) => {
    const found = byPackage.get(pkg);
    return found === undefined ? undefined : [...found];
  };
}

/**
 * Names every package that holds one of the files: each directory above one.
 * Paths through a hidden directory are left out.
 *
 * @param paths - forward-slash paths of Python files relative to the config root.
 * @returns dotted package names.
 */
export function packagesOf(paths: Iterable<string>): Set<string> {
  const packages = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/").slice(0, -1);
    if (!visible(parts)) {
      continue;
    }
    for (let end = 1; end <= parts.length; end += 1) {
      packages.add(parts.slice(0, end).join("."));
    }
  }
  return packages;
}

/**
 * Names a source file by its path under the config root. The file name comes
 * from the path, so `utils.helpers.py` stays one member and isn't read as
 * `utils/helpers.py`; the directories are the trailing path segments that
 * spell the file's package. A path that doesn't end in them (it shouldn't
 * happen) falls back to the dotted package name.
 *
 * @param file - a source file; its path may be relative to any directory above the root.
 * @returns e.g. `app/orders/__init__.py`.
 */
export function rootPathOf(file: SourceFile): string {
  const parts = file.path.split(SEPARATOR);
  const base = parts.pop() ?? "";
  const stem = base.replace(PYTHON, "");
  const pkg = file.isPackage
    ? file.module
    : file.module.slice(0, Math.max(0, file.module.length - stem.length - 1));
  const size = parts.findIndex((_, i) => parts.slice(i).join(".") === pkg);
  const dirs = size === -1 ? pkg.split(".").filter(Boolean) : parts.slice(size);
  return [...(pkg === "" ? [] : dirs), base].join("/");
}

/**
 * Tells whether a path has no hidden segment.
 *
 * @param parts - the path's segments.
 * @returns false when a file or directory name starts with a dot.
 */
function visible(parts: readonly string[]): boolean {
  return !parts.some((part) => part.startsWith("."));
}

/**
 * Checks one member against the names rules, then its package's shape.
 *
 * @param misfit - the package and the member.
 * @param config - the shapes and names rules.
 * @returns the message, fix and severity; undefined when the member fits.
 */
function memberProblem(misfit: Misfit, config: InwardsConfig): Problem | undefined {
  const { pkg, member } = misfit;
  const rule = config.names?.find(
    (r) => memberMatches(r.pattern, member) && !r.onlyIn.some((s) => selects(s, pkg)),
  );
  if (rule) {
    return { ...nameFinding(misfit, rule), severity: "error" };
  }
  const spec = shapeFor(config.shape ?? [], pkg);
  if (spec?.forbid?.some((p) => memberMatches(p, member))) {
    return { ...shapeFinding(misfit, spec, true), severity: "error" };
  }
  const allowed = [...(spec?.allow ?? []), ...(spec?.require ?? []), "__init__"];
  if (spec?.allow && !allowed.some((p) => memberMatches(p, member))) {
    return { ...shapeFinding(misfit, spec, false), severity: spec.extra };
  }
  return undefined;
}
