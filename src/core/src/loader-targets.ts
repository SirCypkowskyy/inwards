/**
 * What an `import_module`, `__import__` or `run_module` call loads, read from
 * its arguments as Python would compute them before the call runs. A target
 * that isn't a literal comes back as `COMPUTED`, which INW011 reports as
 * unverifiable in inner layers (see `dynamic.ts`).
 */
import type { Node } from "web-tree-sitter";
import type { LoaderKind } from "./callees.ts";
import {
  argumentAt,
  hasSplat,
  identifierName,
  integerLiteral,
  literalString,
  namedChildren,
} from "./literals.ts";
import { packageOf, resolveRelative } from "./python.ts";
import type { SourceFile } from "./types.ts";

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
 * Resolves the module an `import_module`, `__import__` or `run_module` call loads.
 *
 * @param kind - which loader the call is.
 * @param call - the `call` node.
 * @param file - the calling file, for relative names.
 * @returns the loaded modules, `COMPUTED` for a target that isn't a literal,
 *   and nothing for a call that fails at runtime.
 */
export function moduleTargets(kind: LoaderKind, call: Node, file: SourceFile): Loaded[] {
  switch (kind) {
    case "import_module":
      return importModuleTargets(call, file);
    case "__import__":
      return dunderImportTargets(call, file);
    case "run_module": {
      const name = literalString(argumentAt(call, 0, "mod_name"));
      if (name === null) {
        return [COMPUTED];
      }
      return name && !name.startsWith(".") ? [read(name)] : [];
    }
    default:
      return [];
  }
}

const LEADING_DOTS = /^\.*/u;

/**
 * Resolves `importlib.import_module(name, package)`.
 * A relative name needs its package as a literal, `__package__` or `__name__`.
 * Without a package (or with `None` or `""`) the call fails at runtime and is
 * skipped; any other package, or one that `*args` may hide, makes the target
 * computed.
 *
 * @param call - the `call` node.
 * @param file - the calling file.
 * @returns the loaded module, `COMPUTED`, or nothing when the call fails at runtime.
 */
function importModuleTargets(call: Node, file: SourceFile): Loaded[] {
  const name = literalString(argumentAt(call, 0, "name"));
  if (name === null) {
    return [COMPUTED];
  }
  const level = LEADING_DOTS.exec(name)?.[0].length ?? 0;
  if (level === 0) {
    return name ? [read(name)] : [];
  }
  const pkgNode = argumentAt(call, 1, "package");
  if (!pkgNode) {
    return hasSplat(call) ? [COMPUTED] : [];
  }
  if (pkgNode.type === "none" || literalString(pkgNode) === "") {
    return [];
  }
  const pkg = packageArgument(pkgNode, file);
  if (!pkg) {
    return [COMPUTED];
  }
  const target = resolveRelative(pkg, level, name.slice(level) || undefined);
  return target ? [read(target)] : [];
}

/**
 * Reads the `package` argument of `import_module` as name parts.
 *
 * @param node - the argument.
 * @param file - the calling file, which `__package__` and `__name__` refer to.
 * @returns the package split into parts, or null when it isn't known statically.
 */
function packageArgument(node: Node, file: SourceFile): string[] | null {
  if (node.type === "identifier") {
    const name = identifierName(node);
    if (name === "__package__") {
      return packageOf(file);
    }
    return name === "__name__" ? file.module.split(".") : null;
  }
  const pkg = literalString(node);
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
 * @param call - the `call` node.
 * @param file - the calling file.
 * @returns the loaded modules, with `COMPUTED` for what can't be read.
 */
function dunderImportTargets(call: Node, file: SourceFile): Loaded[] {
  const name = literalString(argumentAt(call, 0, "name"));
  const levelNode = argumentAt(call, DUNDER_LEVEL, "level");
  const splat = hasSplat(call);
  const level = levelNode ? integerLiteral(levelNode) : 0;
  if (name === null || level === null || (!levelNode && splat)) {
    return [COMPUTED];
  }
  const base = level > 0 ? resolveRelative(packageOf(file), level, name || undefined) : name;
  if (!base) {
    return [];
  }
  const fromlist = argumentAt(call, DUNDER_FROMLIST, "fromlist");
  if (!fromlist) {
    return splat ? [read(base), COMPUTED] : [read(base)];
  }
  if (fromlist.type === "none") {
    return [read(base)];
  }
  const entries = ["list", "tuple"].includes(fromlist.type)
    ? namedChildren(fromlist).map((n) => literalString(n))
    : [null];
  const members = entries.flatMap((entry) => (entry && entry !== "*" ? [`${base}.${entry}`] : []));
  return [read(base), ...members.map(read), ...(entries.includes(null) ? [COMPUTED] : [])];
}
