/**
 * @file Fails when the source of any package imports itself in a circle,
 * type-only imports included. fallow reports runtime cycles already; this
 * catches the ones it doesn't: two modules that only share types through
 * each other still form a knot that makes neither understandable alone
 * (#176). It prints each strongly connected group of more than one module.
 *
 * The imports come from TypeScript itself (the pinned compiler's
 * `typescript/unstable/async` API, which runs tsgo): the syntax tree finds
 * `import`, `export ... from`, `import x = require()`, `import()` calls and
 * `import("...")` types, so comments and strings can't hide or invent an edge,
 * and the checker resolves each specifier with the package's own tsconfig,
 * so extensionless and `index` imports count too. The API is marked unstable;
 * if a TypeScript upgrade changes it, this script fails loudly rather than
 * passing.
 *
 * Run by CI and `bun run check:cycles`. Exit 0 when there is none, 1 otherwise.
 */
import { readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";
import { type Node, SyntaxKind } from "typescript/unstable/ast";
import {
  isCallExpression,
  isExportDeclaration,
  isExternalModuleReference,
  isImportDeclaration,
  isImportEqualsDeclaration,
  isImportTypeNode,
  isLiteralTypeNode,
} from "typescript/unstable/ast/is";
import { API } from "typescript/unstable/async";

const ROOT = join(import.meta.dir, "..");
/** A slash at the end of a directory path. */
const TRAILING_SLASH = /\/$/u;

/** Each module's imported modules, absolute paths. */
export type ImportGraph = Map<string, string[]>;

/**
 * Picks the module specifier out of a node, if the node imports anything.
 *
 * @param node - any node of a source file's tree.
 * @returns the specifier's string literal node, or undefined for other nodes.
 */
function specifierOf(node: Node): Node | undefined {
  if (isImportDeclaration(node) || isExportDeclaration(node)) {
    return node.moduleSpecifier;
  }
  if (isImportEqualsDeclaration(node) && isExternalModuleReference(node.moduleReference)) {
    return node.moduleReference.expression;
  }
  if (isImportTypeNode(node) && isLiteralTypeNode(node.argument)) {
    return node.argument.literal;
  }
  if (isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword) {
    return node.arguments[0];
  }
  return undefined;
}

/**
 * Collects the module specifiers of a source file, at any depth.
 *
 * @param file - the file's syntax tree.
 * @returns the specifier nodes, in source order.
 */
function specifiers(file: Node): Node[] {
  const found: Node[] = [];
  collect(file, found);
  return found;
}

/**
 * Adds the module specifiers of a node and its descendants to a list.
 *
 * @param node - the subtree to search.
 * @param found - the specifiers so far, appended to in source order.
 */
function collect(node: Node, found: Node[]): void {
  const specifier = specifierOf(node);
  if (specifier !== undefined) {
    found.push(specifier);
  }
  node.forEachChild((child) => collect(child, found));
}

/**
 * Tells whether a path lies below a directory, both spelled as `pathKey`
 * spells them.
 *
 * @param path - an absolute file path, either separator.
 * @param dir - an absolute directory path, either separator.
 * @param fold - compare without case, for a file system that ignores it.
 * @returns true when the path is inside the directory.
 */
export function isInside(path: string, dir: string, fold: boolean): boolean {
  return pathKey(path, fold).startsWith(`${pathKey(dir, fold).replace(TRAILING_SLASH, "")}/`);
}

/**
 * Spells a path the one way every source agrees on. TypeScript reports its
 * canonical paths with forward slashes on every OS, through symlinks
 * (`/private/var` for macOS's `/var`) and lower-cased where the file system
 * ignores case (macOS, Windows), while its list of source files and
 * `node:path` keep the spelling they were given. Resolving links and using
 * `/` makes the two meet; case is folded only where the file system ignores
 * it (see `ignoresCase`), so `A.ts` and `a.ts` stay apart on Linux.
 *
 * @param path - an absolute path, either separator; it need not exist.
 * @param fold - lower-case the key, for a file system that ignores case.
 * @returns the path's comparison key.
 */
export function pathKey(path: string, fold: boolean): string {
  let real = path;
  try {
    real = realpathSync.native(path);
  } catch {
    // not on disk (a bundled lib file, a test's made-up path): as written
  }
  const slashed = real.replaceAll("\\", "/");
  return fold ? slashed.toLowerCase() : slashed;
}

/**
 * Tells whether the file system holding a directory ignores case, by asking
 * whether the upper- and lower-case spellings of its path are one directory.
 *
 * @param dir - an existing absolute directory.
 * @returns true when both spellings reach the same directory.
 */
export function ignoresCase(dir: string): boolean {
  const upperCased = dir.toUpperCase();
  const lowerCased = dir.toLowerCase();
  if (upperCased === lowerCased) {
    return false; // nothing to fold
  }
  try {
    const a = statSync(upperCased);
    const b = statSync(lowerCased);
    return a.dev === b.dev && a.ino === b.ino;
  } catch {
    return false; // one spelling doesn't exist: case matters here
  }
}

/**
 * Indexes source files by key, refusing a file whose real path can't be read
 * (it would silently drop out of the graph) and two files that share a key.
 *
 * @param names - the source files, as TypeScript lists them.
 * @param fold - fold case, as `pathKey` does.
 * @returns each key with its file.
 * @throws {Error} when a file can't be resolved or two files share a key.
 */
export function indexByKey(names: readonly string[], fold: boolean): Map<string, string> {
  const byKey = new Map<string, string>();
  for (const name of names) {
    const key = pathKey(realpathSync.native(name), fold);
    const other = byKey.get(key);
    if (other !== undefined) {
      throw new Error(`${name} and ${other} are one file to this file system`);
    }
    byKey.set(key, name);
  }
  return byKey;
}

/**
 * Builds the import graph of one TypeScript project's source directory, as
 * the compiler resolves it.
 *
 * @param tsconfig - absolute path of the project's tsconfig.json.
 * @param dir - absolute path of the source directory whose modules count.
 * @returns each module under `dir` with the modules under `dir` it imports.
 * @throws {Error} when the compiler doesn't load the project, or a source file
 *   can't be resolved or shares its key with another (see `indexByKey`).
 */
export async function importGraph(tsconfig: string, dir: string): Promise<ImportGraph> {
  const api = new API({ cwd: ROOT });
  try {
    const snapshot = await api.updateSnapshot({ openProjects: [tsconfig] });
    const project = snapshot.getProject(tsconfig) ?? snapshot.getProjects()[0];
    if (project === undefined) {
      throw new Error(`TypeScript did not load ${tsconfig}`);
    }
    const fold = ignoresCase(dir);
    const names = (await project.program.getSourceFileNames()).filter(
      (name) => isInside(name, dir, fold) && !name.endsWith(".d.ts"),
    );
    // A resolved target is matched to a listed file by key, not by spelling.
    const byKey = indexByKey(names, fold);
    const edges = await Promise.all(
      names.map(async (name): Promise<[string, string[]]> => {
        const file = await project.program.getSourceFile(name);
        const nodes = file === undefined ? [] : specifiers(file);
        const symbols = nodes.length === 0 ? [] : await project.checker.getSymbolAtLocation(nodes);
        const targets = symbols
          .flatMap((symbol) => symbol?.declarations ?? [])
          .flatMap((declaration) => byKey.get(pathKey(declaration.path, fold)) ?? [])
          .filter((target) => target !== name);
        return [name, [...new Set(targets)]];
      }),
    );
    return new Map(edges);
  } finally {
    await api.close();
  }
}

/** Tarjan's bookkeeping for one walk of the graph. */
interface Walk {
  graph: ReadonlyMap<string, readonly string[]>;
  index: Map<string, number>;
  low: Map<string, number>;
  stack: string[];
  onStack: Set<string>;
  found: string[][];
}

/**
 * Finds the strongly connected groups of a graph with more than one member
 * (Tarjan's algorithm), i.e. the import cycles.
 *
 * @param graph - each node's successors.
 * @returns the cycles, each as its member files.
 */
export function cycles(graph: ReadonlyMap<string, readonly string[]>): string[][] {
  const walk: Walk = {
    graph,
    index: new Map(),
    low: new Map(),
    stack: [],
    onStack: new Set(),
    found: [],
  };
  for (const node of graph.keys()) {
    if (!walk.index.has(node)) {
      visit(walk, node);
    }
  }
  return walk.found;
}

/**
 * Visits one node and everything reachable from it, recording each finished
 * group of more than one node.
 *
 * @param walk - the walk's bookkeeping, updated in place.
 * @param node - the file to visit.
 */
function visit(walk: Walk, node: string): void {
  walk.index.set(node, walk.index.size);
  walk.low.set(node, walk.index.get(node) ?? 0);
  walk.stack.push(node);
  walk.onStack.add(node);
  for (const next of walk.graph.get(node) ?? []) {
    if (!walk.index.has(next)) {
      visit(walk, next);
      lower(walk, node, walk.low.get(next));
    } else if (walk.onStack.has(next)) {
      lower(walk, node, walk.index.get(next));
    }
  }
  if (walk.low.get(node) === walk.index.get(node)) {
    const group = popGroup(walk, node);
    if (group.length > 1) {
      walk.found.push(group.sort());
    }
  }
}

/**
 * Lowers a node's low-link to a value, if it is lower.
 *
 * @param walk - the walk's bookkeeping, updated in place.
 * @param node - the node whose low-link may drop.
 * @param value - the candidate, from a successor.
 */
function lower(walk: Walk, node: string, value: number | undefined): void {
  walk.low.set(node, Math.min(walk.low.get(node) ?? 0, value ?? 0));
}

/**
 * Pops the finished group whose root is a node off the stack.
 *
 * @param walk - the walk's bookkeeping, updated in place.
 * @param root - the node the group was entered from (its low-link equals its index).
 * @returns the files in the group, root included.
 */
function popGroup(walk: Walk, root: string): string[] {
  const group: string[] = [];
  for (let member = walk.stack.pop(); member !== undefined; member = walk.stack.pop()) {
    walk.onStack.delete(member);
    group.push(member);
    if (member === root) {
      break;
    }
  }
  return group;
}

if (import.meta.main) {
  const packages = readdirSync(join(ROOT, "src"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(ROOT, "src", entry.name));
  const graphs = await Promise.all(
    packages.map((pkg) => importGraph(join(pkg, "tsconfig.json"), join(pkg, "src"))),
  );
  const knots = graphs.flatMap((graph) => cycles(graph));
  for (const knot of knots) {
    process.stderr.write(
      `import cycle (type imports included):\n  ${knot.map((f) => relative(ROOT, f)).join("\n  ")}\n`,
    );
  }
  process.stdout.write(knots.length === 0 ? "No import cycles.\n" : "");
  process.exitCode = knots.length === 0 ? 0 : 1;
}
