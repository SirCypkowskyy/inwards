/**
 * @file The graph algorithms behind INW004. Strongly connected components
 * with two or more nodes are found, self-loops are ignored, and the order is
 * the same on every run. A chain far deeper than the call stack is fine,
 * since Tarjan runs iteratively. The shortest cycle through a node stays
 * inside its component and prefers the fewest steps.
 */
import { expect, test } from "bun:test";
import {
  cyclicComponents,
  type Graph,
  shortestCycle,
} from "../../src/rules/import-cycles/graph.ts";

/**
 * Builds a graph from edges.
 *
 * @param edges - `[from, to]` pairs.
 * @returns the adjacency map.
 */
function graphOf(edges: readonly [string, string][]): Graph {
  const graph = new Map<string, Set<string>>();
  for (const [from, to] of edges) {
    graph.set(from, (graph.get(from) ?? new Set()).add(to));
  }
  return graph;
}

test("components with a cycle are found, sorted, and self-loops don't count", () => {
  const graph = graphOf([
    ["b", "a"],
    ["a", "b"],
    ["c", "d"],
    ["d", "e"],
    ["e", "c"],
    ["f", "f"],
    ["a", "c"],
  ]);
  expect(cyclicComponents(graph)).toEqual([
    ["a", "b"],
    ["c", "d", "e"],
  ]);
});

test("a graph without cycles has no components to report", () => {
  expect(
    cyclicComponents(
      graphOf([
        ["a", "b"],
        ["b", "c"],
        ["a", "c"],
      ]),
    ),
  ).toEqual([]);
});

test("a chain deeper than the call stack is handled", () => {
  const edges: [string, string][] = [];
  for (let i = 0; i < 20_000; i += 1) {
    edges.push([`m${i}`, `m${i + 1}`]);
  }
  edges.push(["m20000", "m0"]);
  const [component] = cyclicComponents(graphOf(edges));
  expect(component).toHaveLength(20_001);
});

test("the shortest cycle through a node is chosen", () => {
  const graph = graphOf([
    ["a", "b"],
    ["b", "c"],
    ["c", "d"],
    ["d", "a"],
    ["b", "a"],
  ]);
  const [component = []] = cyclicComponents(graph);
  expect(shortestCycle(graph, component, "a")).toEqual(["a", "b", "a"]);
  expect(shortestCycle(graph, component, "c")).toEqual(["c", "d", "a", "b", "c"]);
});

test("a node outside every cycle has none", () => {
  const graph = graphOf([
    ["a", "b"],
    ["b", "a"],
    ["x", "a"],
  ]);
  expect(shortestCycle(graph, ["x"], "x")).toBeUndefined();
});
