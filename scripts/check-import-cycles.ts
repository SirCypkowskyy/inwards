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
const SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/gu;

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
        .map((match) => normalize(join(dirname(file), match[1] ?? "")))
        .filter((target) => known.has(target));
      return [file, [...new Set(targets)]];
    }),
  );
}

/**
 * Finds the strongly connected groups of a graph with more than one member
 * (Tarjan's algorithm), i.e. the import cycles.
 *
 * @param graph - each node's successors.
 * @returns the cycles, each as its member files.
 */
function cycles(graph: ReadonlyMap<string, readonly string[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const found: string[][] = [];
  let next = 0;

  /**
   * Visits one node and everything reachable from it.
   *
   * @param node - the file to visit.
   */
  function visit(node: string): void {
    index.set(node, next);
    low.set(node, next);
    next += 1;
    stack.push(node);
    onStack.add(node);
    for (const successor of graph.get(node) ?? []) {
      if (!index.has(successor)) {
        visit(successor);
        low.set(node, Math.min(low.get(node) ?? 0, low.get(successor) ?? 0));
      } else if (onStack.has(successor)) {
        low.set(node, Math.min(low.get(node) ?? 0, index.get(successor) ?? 0));
      }
    }
    if (low.get(node) === index.get(node)) {
      const group: string[] = [];
      let member: string | undefined;
      do {
        member = stack.pop();
        if (member !== undefined) {
          onStack.delete(member);
          group.push(member);
        }
      } while (member !== undefined && member !== node);
      if (group.length > 1) {
        found.push(group.sort());
      }
    }
  }

  for (const node of graph.keys()) {
    if (!index.has(node)) {
      visit(node);
    }
  }
  return found;
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
