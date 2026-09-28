/**
 * @file Builds the engine's module index (`Engine.index`): a `ProjectIndex`
 * whose import reader goes skeleton-first through the engine's extractor, as
 * `checkFile` does, and whose binding reader parses the files it asks for.
 * It reads nothing itself; the index asks the adapter's `ProjectFiles`.
 */
import type { Parser } from "web-tree-sitter";
import { type ProjectFiles, ProjectIndex } from "../lookup/project-index.ts";
import { topLevelBindings } from "../python/bindings.ts";
import { normalizeSource, parsePython } from "../python/parser.ts";
import type { Extractor } from "./extraction.ts";

/**
 * Builds a lazy module index over an adapter's files.
 *
 * @param files - the adapter's view of the files under the config root.
 * @param extractor - reads imports, through the extraction cache when there is one.
 * @param parser - parser with the Python grammar loaded, for the bindings.
 * @returns a lazy index that lists and reads only when a rule asks.
 */
export function moduleIndex(
  files: ProjectFiles,
  extractor: Extractor,
  parser: Parser,
): ProjectIndex {
  return new ProjectIndex(
    files,
    (file) => {
      const src = { ...file, text: normalizeSource(file.text) };
      return extractor.skeleton(src) ?? extractor.full(src).imports;
    },
    (file) => {
      const tree = parsePython(parser, normalizeSource(file.text));
      try {
        return topLevelBindings(tree, file.path.endsWith(".pyi"));
      } finally {
        tree.delete(); // WASM memory is not garbage collected
      }
    },
  );
}
