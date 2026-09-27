/**
 * @file Fails when the source of any package imports itself in a circle,
 * type-only imports included. fallow reports runtime cycles already; this
 * catches the ones it doesn't: two modules that only share types through
 * each other still form a knot that makes neither understandable alone
 * (#176). It reads every `.ts` file under `src/<package>/src`, follows the
 * relative specifiers of `import`, `export ... from` and `import()`, and
 * prints each strongly connected group of more than one module.
 *
 * Run by CI and `bun run check:cycles`. Exit 0 when there is none, 1 otherwise.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import process from "node:process";

const ROOT = join(import.meta.dir, "..");
const SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*["'](?<spec>\.{1,2}\/[^"']+)["']/gu;

/**
 * Lists every TypeScript source file below a directory, declarations excluded.
 *
 * @param dir - the directory to walk.
 * @returns absolute paths.
 */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" ? [] : sources(path);
    }
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

/**
 * Builds the import graph of the given files, keeping only edges to files in it.
 *
 * @param files - absolute source paths.
 * @returns each file's imported files.
 */
function graphOf(files: readonly string[]): Map<string, string[]> {
  const known = new Set(files);
  return new Map(
    files.map((file) => {
      const text = readFileSync(file, "utf8");
      const targets = [...text.matchAll(SPECIFIER)]
        .map((match) => normalize(join(dirname(file), match.groups?.["spec"] ?? "")))
        .filter((target) => known.has(target));
      return [file, [...new Set(targets)]];
    }),
  );
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
function cycles(graph: ReadonlyMap<string, readonly string[]>): string[][] {
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
 * @param root - the group's root.
 * @returns the group's members.
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

const packages = readdirSync(join(ROOT, "src"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(ROOT, "src", entry.name, "src"));
const knots = packages.flatMap((dir) => cycles(graphOf(sources(dir))));
for (const knot of knots) {
  process.stderr.write(
    `import cycle (type imports included):\n  ${knot.map((f) => relative(ROOT, f)).join("\n  ")}\n`,
  );
}
process.stdout.write(knots.length === 0 ? "No import cycles.\n" : "");
process.exitCode = knots.length === 0 ? 0 : 1;
