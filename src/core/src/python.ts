import { Language, type Node, Parser, type Tree } from "web-tree-sitter";
import type { ImportRef, SourceFile } from "./types.ts";

/**
 * The engine never touches the file system to find its grammars. Each adapter
 * (Bun binary, VS Code extension, tests) hands over the two WASM blobs.
 */
export interface GrammarBinaries {
  runtime: Uint8Array;
  python: Uint8Array;
}

export async function createPythonParser(wasm: GrammarBinaries): Promise<Parser> {
  await Parser.init({ wasmBinary: wasm.runtime });
  const parser = new Parser();
  parser.setLanguage(await Language.load(wasm.python));
  return parser;
}

export function parsePython(parser: Parser, text: string): Tree {
  const tree = parser.parse(text);
  if (!tree) throw new Error("tree-sitter returned no tree");
  return tree;
}

/** Every import in the file, including ones nested in functions or `if TYPE_CHECKING:`. */
export function extractImports(tree: Tree, file: SourceFile): ImportRef[] {
  const refs: ImportRef[] = [];
  for (const stmt of tree.rootNode.descendantsOfType([
    "import_statement",
    "import_from_statement",
  ])) {
    if (!stmt) continue;
    const statement = stmt.text;
    const at = (node: Node, target: string): ImportRef => ({
      target,
      statement,
      line: node.startPosition.row + 1,
      column: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
    });

    if (stmt.type === "import_statement") {
      // import a.b, c.d as e
      for (const name of stmt.childrenForFieldName("name")) {
        const dotted = name.type === "aliased_import" ? name.childForFieldName("name") : name;
        if (dotted) refs.push(at(name, dotted.text));
      }
      continue;
    }

    // from X import a, b   |   from ..X import a   |   from . import a
    const moduleNode = stmt.childForFieldName("module_name");
    if (!moduleNode) continue;
    const base = resolveModule(moduleNode, file);
    if (base === null) continue;
    const names = stmt.childrenForFieldName("name");
    if (names.length === 0) {
      refs.push(at(moduleNode, base)); // from X import *
      continue;
    }
    for (const name of names) {
      const dotted = name.type === "aliased_import" ? name.childForFieldName("name") : name;
      if (!dotted) continue;
      // `from shop import infrastructure` must count as importing shop.infrastructure.
      refs.push(at(name, base ? `${base}.${dotted.text}` : dotted.text));
    }
  }
  return refs;
}

/** Turns `..repo` inside `shop.application.orders` into `shop.repo`. Null if it escapes the root. */
function resolveModule(node: Node, file: SourceFile): string | null {
  if (node.type !== "relative_import") return node.text;
  const prefix = node.children.find((c) => c?.type === "import_prefix")?.text ?? "";
  const rest = node.children.find((c) => c?.type === "dotted_name")?.text;
  const pkg = file.module.split(".");
  if (!file.isPackage) pkg.pop();
  const up = prefix.length - 1;
  if (up > pkg.length) return null;
  const parts = pkg.slice(0, pkg.length - up);
  if (rest) parts.push(rest);
  return parts.join(".");
}

/** `shop/domain/order.py` → `shop.domain.order`, `shop/__init__.py` → `shop`. */
export function moduleNameFor(relativePath: string): { module: string; isPackage: boolean } {
  const parts = relativePath
    .replace(/\\/g, "/")
    .replace(/\.pyi?$/, "")
    .split("/");
  const isPackage = parts.at(-1) === "__init__";
  if (isPackage) parts.pop();
  return { module: parts.filter(Boolean).join("."), isPackage };
}
