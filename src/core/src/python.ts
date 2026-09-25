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

/**
 * Creates a tree-sitter parser for Python from the adapter's WASM bytes.
 * Initialises the tree-sitter runtime, then loads the Python grammar into a
 * new parser. Async because both steps compile WASM.
 *
 * @param wasm - the tree-sitter runtime and Python grammar as WASM bytes.
 * @returns a parser ready to parse Python source.
 */
export async function createPythonParser(wasm: GrammarBinaries): Promise<Parser> {
  await Parser.init({ wasmBinary: wasm.runtime });
  const parser = new Parser();
  parser.setLanguage(await Language.load(wasm.python));
  return parser;
}

/**
 * Parses Python source into a syntax tree.
 * tree-sitter recovers from syntax errors, so a tree comes back for any text;
 * null means the parser had no language or the parse was cancelled.
 * The caller must `delete()` the tree: WASM memory is not garbage collected.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param text - Python source.
 * @returns the syntax tree.
 * @throws {Error} when tree-sitter returns no tree.
 */
export function parsePython(parser: Parser, text: string): Tree {
  const tree = parser.parse(text);
  if (!tree) {
    throw new Error("tree-sitter returned no tree");
  }
  return tree;
}

const LEADING_BOM = /^\uFEFF/u;
const LONE_CR = /\r(?!\n)/gu;

/**
 * Normalises source text before parsing.
 * Drops a BOM (editors don't count it as a column) and turns a lone \r into \n.
 * Python ends a line at a lone \r but tree-sitter doesn't, so `# c\rimport x`
 * would otherwise hide a real import inside a comment. CRLF is left alone.
 *
 * @param text - raw file text.
 * @returns the text with line breaks and columns as Python sees them.
 */
export function normalizeSource(text: string): string {
  return text.replace(LEADING_BOM, "").replace(LONE_CR, "\n");
}

const IMPORT_STATEMENTS = ["import_statement", "import_from_statement"];

/**
 * Lists every import in a parsed file.
 * Includes imports nested in functions, classes and `if TYPE_CHECKING:`
 * blocks, since those still create a dependency. Relative imports are
 * resolved against the file's module.
 *
 * @param tree - the parsed file.
 * @param file - the file the tree came from; its module resolves relative imports.
 * @returns one entry per imported name, in source order.
 */
export function extractImports(tree: Tree, file: SourceFile): ImportRef[] {
  const refs: ImportRef[] = [];
  for (const stmt of tree.rootNode.descendantsOfType(IMPORT_STATEMENTS)) {
    refs.push(...(stmt.type === "import_statement" ? plainImports(stmt) : fromImports(stmt, file)));
  }
  return refs;
}

/**
 * Lists the modules named by an `import a.b, c as d` statement.
 * Aliases are dropped: `import c as d` imports `c`.
 *
 * @param stmt - an `import_statement` node.
 * @returns one entry per imported module.
 */
function plainImports(stmt: Node): ImportRef[] {
  // import a.b, c.d as e
  const refs: ImportRef[] = [];
  for (const name of stmt.childrenForFieldName("name")) {
    const dotted = importedName(name);
    if (dotted) {
      refs.push(refAt(name, canonicalName(dotted), stmt.text));
    }
  }
  return refs;
}

/**
 * Lists the targets of a `from X import a, b` statement.
 * Each name counts as `X.name`, because `from shop import infrastructure` may
 * import a submodule. `from X import *` counts as `X`. A relative import that
 * climbs above the root yields nothing.
 *
 * @param stmt - an `import_from_statement` node.
 * @param file - the importing file, used to resolve relative imports.
 * @returns one entry per imported name.
 */
function fromImports(stmt: Node, file: SourceFile): ImportRef[] {
  // from X import a, b   |   from ..X import a   |   from . import a
  const moduleNode = stmt.childForFieldName("module_name");
  if (!moduleNode) {
    return [];
  }
  const base = resolveModule(moduleNode, file);
  if (base === null) {
    return [];
  }
  const names = stmt.childrenForFieldName("name");
  if (names.length === 0) {
    return [refAt(moduleNode, base, stmt.text)]; // from X import *
  }
  const refs: ImportRef[] = [];
  for (const name of names) {
    const dotted = importedName(name);
    if (!dotted) {
      continue;
    }
    // `from shop import infrastructure` must count as importing shop.infrastructure.
    const imported = canonicalName(dotted);
    refs.push(refAt(name, base ? `${base}.${imported}` : imported, stmt.text));
  }
  return refs;
}

/**
 * Returns the imported name of an import list entry, without its alias.
 *
 * @param name - a `dotted_name` or `aliased_import` node.
 * @returns the dotted name node, or null if the alias node has none.
 */
function importedName(name: Node): Node | null {
  return name.type === "aliased_import" ? name.childForFieldName("name") : name;
}

/**
 * Spells a dotted name the way Python's import system sees it.
 * The node text is not enough: Python allows `shop . infrastructure`, a
 * backslash continuation or a comment between the parts, and it NFKC-normalises
 * identifiers, so `ｓhop` (fullwidth) names the module `shop`.
 *
 * @param node - a `dotted_name` or `identifier` node.
 * @returns the dotted name, e.g. `shop.infrastructure.db`.
 */
function canonicalName(node: Node): string {
  const parts = node.type === "dotted_name" ? node.namedChildren : [node];
  return parts
    .filter((part) => part?.type === "identifier")
    .map((part) => part?.text.normalize("NFKC") ?? "")
    .join(".");
}

/**
 * Builds an import reference that spans a syntax node.
 * tree-sitter rows and columns are 0-based; editors and SARIF use 1-based.
 *
 * @param node - the node whose span the diagnostic will point at.
 * @param target - the resolved dotted module name.
 * @param statement - the whole import statement as written.
 * @returns the reference with 1-based line and column.
 */
function refAt(node: Node, target: string, statement: string): ImportRef {
  return {
    target,
    statement,
    line: node.startPosition.row + 1,
    column: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column + 1,
  };
}

/**
 * Resolves the module part of a `from` import to a dotted name.
 * Turns `..repo` inside `shop.application.orders` into `shop.repo`. One dot
 * is the current package: the file's own module for `__init__.py`, its parent
 * otherwise.
 *
 * @param node - the `module_name` node of the statement.
 * @param file - the importing file.
 * @returns the dotted module name, or null if the dots climb above the root.
 */
function resolveModule(node: Node, file: SourceFile): string | null {
  if (node.type !== "relative_import") {
    return canonicalName(node);
  }
  // `from . . x import y` is valid Python: count the dots, not the characters.
  const prefix = node.children.find((c) => c?.type === "import_prefix")?.text ?? "";
  const dots = prefix.split("").filter((ch) => ch === ".").length;
  const restNode = node.children.find((c) => c?.type === "dotted_name");
  return resolveRelative(packageOf(file), dots, restNode ? canonicalName(restNode) : undefined);
}

/**
 * Returns the package a file's relative imports start from, as name parts.
 * That is the file's own module for `__init__.py` and its parent otherwise,
 * the value Python stores in `__package__`.
 *
 * @param file - the importing file.
 * @returns the package's dotted name split into parts.
 */
export function packageOf(file: SourceFile): string[] {
  const pkg = file.module.split(".");
  if (!file.isPackage) {
    pkg.pop();
  }
  return pkg;
}

/**
 * Resolves a relative module name against a package.
 * Level 1 is the package itself, and each extra level climbs one package up,
 * as the dots of `from ..x import y` or the `level` of `__import__` do.
 *
 * @param pkg - the package the name is relative to, split into parts.
 * @param level - the number of leading dots, 1 or more.
 * @param rest - the dotted name after the dots, if any.
 * @returns the dotted module name, or null if the level climbs above the root.
 */
export function resolveRelative(
  pkg: readonly string[],
  level: number,
  rest: string | undefined,
): string | null {
  const up = level - 1;
  if (up > pkg.length) {
    return null;
  }
  const parts = pkg.slice(0, pkg.length - up);
  if (rest) {
    parts.push(rest);
  }
  return parts.join(".");
}

const PYTHON_SUFFIX = /\.pyi?$/u;

/**
 * Derives the dotted module name of a Python file from its path.
 * `shop/domain/order.py` becomes `shop.domain.order` and `shop/__init__.py`
 * becomes `shop` (a package). Accepts `\` or `/` separators and `.py` or `.pyi`.
 *
 * @param relativePath - path of the file relative to the configured root.
 * @returns the module name and whether the file is a package's `__init__`.
 */
export function moduleNameFor(relativePath: string): { module: string; isPackage: boolean } {
  const parts = relativePath.replaceAll("\\", "/").replace(PYTHON_SUFFIX, "").split("/");
  const isPackage = parts.at(-1) === "__init__";
  if (isPackage) {
    parts.pop();
  }
  return { module: parts.filter(Boolean).join("."), isPackage };
}
