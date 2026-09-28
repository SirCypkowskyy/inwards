/**
 * @file What a module loader call (`import_module`, `find_spec`, `__import__`,
 * `run_module`, `pkgutil.resolve_name`, a file loader) loads, read from its
 * arguments as Python would compute them before the call runs. A target that
 * isn't a constant comes back as `COMPUTED`, which INW011 reports as
 * unverifiable in inner layers (see `imports.ts`). Source-running calls
 * (`exec`, `eval`, `compile`) are read in `calls.ts`, not here.
 */
import type { Node } from "web-tree-sitter";
import type { SourceFile } from "../../contracts/records.ts";
import { argumentAt, type Constants, hasSplat, literalString } from "../../python/literals.ts";
import { moduleNameFor, packageOf, resolveRelative } from "../../python/module-names.ts";
import { identifierName, integerLiteral, namedChildren } from "../../python/nodes.ts";
import type { LoaderKind } from "./loaders.ts";

/** A loading call as its loader sees it. */
export interface LoaderCall {
  /** The `call` node: the loader's own call, or `functools.partial(loader, ...)`. */
  node: Node;
  /** Positional arguments ahead of the loader's own: 1 for `partial(loader, ...)`. */
  skip: number;
  /** The calling module's constants, worked out on first use. */
  constants: () => Constants;
}

/**
 * Finds one of the loader's arguments by position or keyword.
 *
 * @param call - the loading call.
 * @param index - the 0-based position among the loader's own arguments.
 * @param keyword - the keyword name, or "" when the parameter is positional-only.
 * @returns the argument's value node, or null when it isn't given.
 */
export function loaderArgument(call: LoaderCall, index: number, keyword: string): Node | null {
  return argumentAt(call.node, index + call.skip, keyword);
}

/**
 * Reads a `str` constant: a literal, or an expression over the module's constants.
 * The constants are only worked out when the node isn't a literal by itself.
 *
 * @param call - the loading call, whose module's constants may be needed.
 * @param node - the expression, or null.
 * @returns the string, or null when it isn't a constant `str`.
 */
function constantString(call: LoaderCall, node: Node | null): string | null {
  return node ? (literalString(node) ?? literalString(node, call.constants())) : null;
}

/**
 * Why a dynamic import's target can't be read: a bytes source for `exec` or
 * `compile` declares a codec Inwards can't decode (PEP 263, as for files), or
 * the target is computed at runtime.
 */
export type Unreadable = { kind: "encoding"; encoding: string } | { kind: "computed" };

/** What a loader call loads, before the loader's name is attached. */
export interface Loaded {
  target: string;
  /** Set instead of `target` when the call's target can't be read. */
  unreadable: Unreadable | null;
}

/** A load whose target is computed at runtime. */
export const COMPUTED: Loaded = { target: "", unreadable: { kind: "computed" } };

/**
 * Wraps a module name a call was found to load.
 *
 * @param target - the dotted module name.
 * @returns the load.
 */
function read(target: string): Loaded {
  return { target, unreadable: null };
}

/**
 * Resolves the module a module loader call loads.
 *
 * @param kind - which loader the call is.
 * @param call - the loading call.
 * @param file - the calling file, for relative names.
 * @returns the loaded modules, `COMPUTED` for a target that isn't a constant,
 *   and nothing for a call that fails at runtime.
 */
export function moduleTargets(kind: LoaderKind, call: LoaderCall, file: SourceFile): Loaded[] {
  switch (kind) {
    case "import_module":
      return importModuleTargets(call, file);
    case "__import__":
      return dunderImportTargets(call, file);
    case "run_module": {
      const name = constantString(call, loaderArgument(call, 0, "mod_name"));
      if (name === null) {
        return [COMPUTED];
      }
      return name && !name.startsWith(".") ? [read(name)] : [];
    }
    case "resolve_name": {
      // `pkg.mod:Obj.attr` imports `pkg.mod`; without a colon, as much of the name as imports
      const name = constantString(call, loaderArgument(call, 0, "name"));
      if (name === null) {
        return [COMPUTED];
      }
      const module = name.split(":")[0] ?? "";
      return module ? [read(module)] : [];
    }
    case "file":
      return fileTargets(call);
    default:
      return [];
  }
}

const LEADING_CURRENT_DIR = /^(?:\.[/\\])+/u;
const RELATIVE_PYTHON_FILE = /^(?![/\\]|[A-Za-z]:|.*(?:^|[/\\])\.\.(?:[/\\]|$)).+\.pyi?$/u;

/**
 * Resolves `SourceFileLoader(fullname, path)` or
 * `spec_from_file_location(name, location)`: they load the file at the path,
 * whatever name they register it under. A relative path to a `.py` file is
 * read as a path from the project root, the usual working directory; any
 * other path is computed.
 *
 * @param call - the loading call.
 * @returns the module the file is, `COMPUTED`, or nothing when no path is given.
 */
function fileTargets(call: LoaderCall): Loaded[] {
  const node = loaderArgument(call, 1, "path") ?? loaderArgument(call, 1, "location");
  if (!node) {
    return hasSplat(call.node) ? [COMPUTED] : [];
  }
  const path = constantString(call, node);
  return path !== null && RELATIVE_PYTHON_FILE.test(path)
    ? [read(moduleNameFor(path.replace(LEADING_CURRENT_DIR, "")).module)]
    : [COMPUTED];
}

const LEADING_DOTS = /^\.*/u;

/**
 * Resolves `importlib.import_module(name, package)`.
 * A relative name needs its package as a literal, `__package__` or `__name__`.
 * Without a package (or with `None` or `""`) the call fails at runtime and is
 * skipped; any other package, or one that `*args` may hide, makes the target
 * computed.
 *
 * @param call - the loading call.
 * @param file - the calling file.
 * @returns the loaded module, `COMPUTED`, or nothing when the call fails at runtime.
 */
function importModuleTargets(call: LoaderCall, file: SourceFile): Loaded[] {
  const name = constantString(call, loaderArgument(call, 0, "name"));
  if (name === null) {
    return [COMPUTED];
  }
  const level = LEADING_DOTS.exec(name)?.[0].length ?? 0;
  if (level === 0) {
    return name ? [read(name)] : [];
  }
  const pkgNode = loaderArgument(call, 1, "package");
  if (!pkgNode) {
    return hasSplat(call.node) ? [COMPUTED] : [];
  }
  if (pkgNode.type === "none" || constantString(call, pkgNode) === "") {
    return [];
  }
  const pkg = packageArgument(call, pkgNode, file);
  if (!pkg) {
    return [COMPUTED];
  }
  const target = resolveRelative(pkg, level, name.slice(level) || undefined);
  return target ? [read(target)] : [];
}

/**
 * Reads the `package` argument of `import_module` as name parts.
 *
 * @param call - the loading call, whose module's constants may be needed.
 * @param node - the `package` argument's expression.
 * @param file - the calling file, which `__package__` and `__name__` refer to.
 * @returns the package split into parts, or null when it isn't known statically.
 */
function packageArgument(call: LoaderCall, node: Node, file: SourceFile): string[] | null {
  const name = node.type === "identifier" ? identifierName(node) : "";
  if (name === "__package__") {
    return packageOf(file);
  }
  if (name === "__name__") {
    return file.module.split(".");
  }
  const pkg = constantString(call, node);
  return pkg ? pkg.split(".") : null;
}

/** Positions of `fromlist` and `level` in `__import__(name, globals, locals, fromlist, level)`. */
const DUNDER_FROMLIST = 3;
const DUNDER_LEVEL = 4;

/**
 * Resolves `__import__(name, globals, locals, fromlist, level)`.
 * The call imports `name`, and with a `fromlist` also `name.x` for each
 * entry, as `from name import x` does. A positive literal `level` resolves
 * `name` against the calling file's package. A computed name or level makes
 * the call computed, and so does a `fromlist` that isn't `None` or a list or
 * tuple of literals, on top of `name` itself. A level or fromlist that `*args`
 * may hide counts as computed.
 *
 * @param call - the loading call.
 * @param file - the calling file.
 * @returns the loaded modules, with `COMPUTED` for what can't be read.
 */
function dunderImportTargets(call: LoaderCall, file: SourceFile): Loaded[] {
  const name = constantString(call, loaderArgument(call, 0, "name"));
  const levelNode = loaderArgument(call, DUNDER_LEVEL, "level");
  const splat = hasSplat(call.node);
  const level = levelNode ? integerLiteral(levelNode) : 0;
  if (name === null || level === null || (!levelNode && splat)) {
    return [COMPUTED];
  }
  const base = level > 0 ? resolveRelative(packageOf(file), level, name || undefined) : name;
  if (!base) {
    return [];
  }
  const fromlist = loaderArgument(call, DUNDER_FROMLIST, "fromlist");
  if (!fromlist) {
    return splat ? [read(base), COMPUTED] : [read(base)];
  }
  if (fromlist.type === "none") {
    return [read(base)];
  }
  const entries = ["list", "tuple"].includes(fromlist.type)
    ? namedChildren(fromlist).map((n) => constantString(call, n))
    : [null];
  const members = entries.flatMap((entry) => (entry && entry !== "*" ? [`${base}.${entry}`] : []));
  return [read(base), ...members.map(read), ...(entries.includes(null) ? [COMPUTED] : [])];
}
