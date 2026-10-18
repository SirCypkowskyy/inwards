/**
 * @file The graph algorithms INW004 needs, on a directed graph given as an
 * adjacency map of string nodes: strongly connected components (Tarjan's,
 * iterative so a deep project can't overflow the stack) and the shortest
 * cycle through one node of a component (a breadth-first search inside it).
 * Every result is deterministic: nodes and neighbours are visited in sorted
 * order, so the same project always reports the same path.
 */

/** A directed graph: each node's direct successors. */
export type Graph = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Tarjan's algorithm, iterative: each frame on `frames` is a node and the
 * successors it has yet to visit, so a long import chain can't overflow the
 * call stack.
 */
class Tarjan {
  private readonly graph: Graph;
  private readonly index = new Map<string, number>();
  private readonly low = new Map<string, number>();
  private readonly stack: string[] = [];
  private readonly onStack = new Set<string>();
  private readonly frames: { node: string; rest: string[] }[] = [];
  private next = 0;
  readonly found: string[][] = [];

  /**
   * Keeps the graph to search.
   *
   * @param graph - each node's successors.
   */
  constructor(graph: Graph) {
    this.graph = graph;
  }

  /**
   * Visits every node reachable from a root not visited yet.
   *
   * @param root - where to start.
   */
  run(root: string): void {
    if (this.index.has(root)) {
      return;
    }
    this.enter(root);
    for (let frame = this.frames.at(-1); frame !== undefined; frame = this.frames.at(-1)) {
      const child = frame.rest.shift();
      if (child === undefined) {
        this.leave(frame.node);
      } else if (!this.index.has(child)) {
        this.enter(child);
      } else if (this.onStack.has(child)) {
        this.lower(frame.node, this.index.get(child) ?? 0);
      }
    }
  }

  /**
   * Starts a node: numbers it and pushes it.
   *
   * @param node - a node not visited yet.
   */
  private enter(node: string): void {
    this.index.set(node, this.next);
    this.low.set(node, this.next);
    this.next += 1;
    this.stack.push(node);
    this.onStack.add(node);
    this.frames.push({ node, rest: successors(this.graph, node) });
  }

  /**
   * Finishes a node: passes its low-link to its parent, and pops its
   * component when it is the component's root.
   *
   * @param node - the node whose successors are all visited.
   */
  private leave(node: string): void {
    this.frames.pop();
    const low = this.low.get(node) ?? 0;
    const parent = this.frames.at(-1);
    if (parent !== undefined) {
      this.lower(parent.node, low);
    }
    if (low === this.index.get(node)) {
      const component = popComponent(this.stack, this.onStack, node);
      if (component.length > 1) {
        this.found.push(component.sort());
      }
    }
  }

  /**
   * Lowers a node's low-link to a value, if that is lower.
   *
   * @param node - a node of the graph.
   * @param value - an index or low-link reachable from it.
   */
  private lower(node: string, value: number): void {
    if (value < (this.low.get(node) ?? value)) {
      this.low.set(node, value);
    }
  }
}

/**
 * Finds the strongly connected components that hold a cycle: two or more
 * nodes, each reachable from every other. A node's edge to itself is ignored.
 *
 * @param graph - each node's successors.
 * @returns each such component's nodes, sorted, the components in order of their first node.
 */
export function cyclicComponents(graph: Graph): string[][] {
  const tarjan = new Tarjan(graph);
  for (const root of [...graph.keys()].sort()) {
    tarjan.run(root);
  }
  return tarjan.found.sort((a, b) => (a[0] ?? "").localeCompare(b[0] ?? ""));
}

/**
 * Finds the shortest cycle through a node, staying inside its component.
 *
 * @param graph - each node's successors.
 * @param component - the node's strongly connected component.
 * @param start - the node the cycle starts and ends at.
 * @returns the cycle's nodes from `start` back to `start`, e.g. `[a, b, a]`,
 *   or undefined when no cycle passes through it.
 */
export function shortestCycle(
  graph: Graph,
  component: readonly string[],
  start: string,
): string[] | undefined {
  const inside = new Set(component);
  const cameFrom = new Map<string, string>();
  const queue = [start];
  // The iterator also visits nodes pushed while it runs: a breadth-first queue.
  for (const node of queue) {
    for (const next of successors(graph, node)) {
      if (next === start) {
        return [...pathTo(cameFrom, start, node), start];
      }
      if (inside.has(next) && !cameFrom.has(next)) {
        cameFrom.set(next, node);
        queue.push(next);
      }
    }
  }
  return undefined;
}

/**
 * Lists a node's successors in sorted order, without the node itself.
 *
 * @param graph - each node's successors.
 * @param node - a node of the graph.
 * @returns its successors.
 */
function successors(graph: Graph, node: string): string[] {
  return [...(graph.get(node) ?? [])].filter((next) => next !== node).sort();
}

/**
 * Pops one component off Tarjan's stack, down to and including its root.
 *
 * @param stack - Tarjan's stack of nodes not yet in a component.
 * @param onStack - the nodes on it, updated in place.
 * @param root - the node whose index equals its low-link.
 * @returns the component's nodes.
 */
function popComponent(stack: string[], onStack: Set<string>, root: string): string[] {
  const component: string[] = [];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    onStack.delete(node);
    component.push(node);
    if (node === root) {
      break;
    }
  }
  return component;
}

/**
 * Walks the breadth-first search's parents back from a node to the start.
 *
 * @param cameFrom - each reached node's parent.
 * @param start - where the search began.
 * @param end - the node to walk back from.
 * @returns the nodes from `start` to `end`.
 */
function pathTo(cameFrom: ReadonlyMap<string, string>, start: string, end: string): string[] {
  const path = [end];
  for (let node = end; node !== start; ) {
    const parent = cameFrom.get(node);
    if (parent === undefined) {
      break;
    }
    path.unshift(parent);
    node = parent;
  }
  return path;
}
