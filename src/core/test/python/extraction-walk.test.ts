/**
 * @file The full parse's extraction reads the same nodes as a walk over the
 * whole tree (#62). `importStatements` skips subtrees that can't hold an
 * import and `commentsIn` looks only around the word `inwards`; both are
 * compared here with `descendantsOfType` on hand-picked snippets, on seeded
 * mutations of them that break the syntax, and the holder list is checked
 * against the grammar's own `node-types.json`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Tree } from "web-tree-sitter";
import { IMPORT_HOLDERS, importStatements, parsePython } from "../../src/python/parser.ts";
import { commentsIn } from "../../src/rules/suppression-comment.ts";
import { parser } from "../support/helpers.ts";

/** One entry of tree-sitter's `node-types.json`. */
interface NodeType {
  type: string;
  subtypes?: { type: string }[];
  fields?: Record<string, { types: { type: string }[] }>;
  children?: { types: { type: string }[] };
}

/**
 * Tells whether a parsed JSON value has the shape of a `node-types.json` entry.
 *
 * @param value - one element of the parsed file.
 * @returns true when it has a string `type`.
 */
function isNodeType(value: unknown): value is NodeType {
  return typeof value === "object" && value !== null && "type" in value;
}

/**
 * Reads the node types tree-sitter-python declares.
 *
 * @returns the entries of its `src/node-types.json`.
 * @throws {Error} when the file isn't a list of node types.
 */
function nodeTypes(): NodeType[] {
  const path = Bun.resolveSync("tree-sitter-python/src/node-types.json", import.meta.dir);
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!(Array.isArray(parsed) && parsed.every(isNodeType))) {
    throw new Error("node-types.json is not a list of node types");
  }
  return parsed;
}

/**
 * Replaces a supertype (`_simple_statement`) by the concrete types under it.
 *
 * @param type - a node type from `node-types.json`.
 * @param supertypes - each type's subtypes, empty for a concrete type.
 * @returns the concrete types `type` stands for.
 */
function expand(type: string, supertypes: ReadonlyMap<string, string[]>): string[] {
  const subs = supertypes.get(type) ?? [];
  return subs.length > 0 ? subs.flatMap((sub) => expand(sub, supertypes)) : [type];
}

/**
 * Lists the node types that can hold an import statement at any depth, by
 * closing the grammar's parent-to-child relation over the import types.
 *
 * @returns the holder types, sorted.
 */
function derivedHolders(): string[] {
  const all = nodeTypes();
  const supertypes = new Map(all.map((n) => [n.type, (n.subtypes ?? []).map((s) => s.type)]));
  const children = new Map(
    all
      .filter((n) => n.subtypes === undefined)
      .map((n) => {
        const listed = [
          ...Object.values(n.fields ?? {}).flatMap((f) => f.types),
          ...(n.children?.types ?? []),
        ];
        return [n.type, new Set(listed.flatMap((t) => expand(t.type, supertypes)))];
      }),
  );
  const holders = new Set<string>();
  const reaches = new Set(["import_statement", "import_from_statement"]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [type, kids] of children) {
      if (!holders.has(type) && [...kids].some((k) => reaches.has(k))) {
        holders.add(type);
        reaches.add(type);
        grew = true;
      }
    }
  }
  return [...holders].sort();
}

const SNIPPETS = [
  "import os\nfrom . import a\nfrom ..b import c as d, e\nfrom f import *\n",
  "def f():\n    import a\n    class C:\n        import b\n",
  "@dec\ndef f():\n    if x:\n        import a\n    elif y:\n        import b\n    else:\n        import c\n",
  "try:\n    import a\nexcept E:\n    import b\nexcept* F:\n    import g\nelse:\n    import c\nfinally:\n    import d\n",
  "for i in x:\n    import a\nelse:\n    import b\nwhile y:\n    import c\nwith z as w:\n    import d\n",
  "match x:\n    case 1:\n        import a\n    case _:\n        from b import c\n",
  "if TYPE_CHECKING: import a\nx = 1; import b\nasync def f():\n    import c\n",
  "f(\nimport a\n)\nx = [import b]\ndef g(:\n    import c\n",
  'from x import (a, # inwards: ignore[INW001] reason="r"\n    b)\n',
  's = "# inwards: ignore[INW001]"\nx = 1  # inwards: ignore[INW001] reason="a" inwards\n',
  '"""\n# inwards: ignore[INW002]\n"""\n# 😀 ünï  # inwards:ignore[INW003]\n#inwards: ignore\n',
  "class C(\n    import a,\n):\n    from b import (c,\n",
];

/** Fragments spliced into the snippets to break their syntax. */
const JUNK = ["(", ")", ":", "import", "from x import", "\n", "    ", "'''", '"', "[", "\\\n"];

/** A linear congruential generator's modulus, 2^31. */
const MODULUS = 2_147_483_648;

/**
 * Draws the next number from a linear congruential generator.
 *
 * @param state - the generator's state, advanced in place.
 * @param state.seed - the last value drawn.
 * @param bound - the exclusive upper bound.
 * @returns an integer in [0, bound).
 */
function nextBelow(state: { seed: number }, bound: number): number {
  state.seed = (state.seed * 1_103_515_245 + 12_345) % MODULUS;
  return Math.floor((state.seed / MODULUS) * bound);
}

/**
 * Makes seeded mutations of a text by splicing in fragments at random offsets.
 *
 * @param text - the text to mutate.
 * @param seed - the seed of the generator, so a failure reproduces.
 * @param count - how many mutations.
 * @returns the mutated texts.
 */
function mutations(text: string, seed: number, count: number): string[] {
  const state = { seed };
  return Array.from({ length: count }, () => {
    let out = text;
    for (let i = 0; i < 3; i += 1) {
      const at = nextBelow(state, out.length + 1);
      out = out.slice(0, at) + (JUNK[nextBelow(state, JUNK.length)] ?? "") + out.slice(at);
    }
    return out;
  });
}

/**
 * Parses a text, hands the tree to a callback, and frees it.
 *
 * @param text - the Python source.
 * @param read - what to read from the tree.
 * @returns what `read` returned.
 */
function withTree<T>(text: string, read: (tree: Tree) => T): T {
  const tree = parsePython(parser, text);
  try {
    return read(tree);
  } finally {
    tree.delete();
  }
}

/** A directive, as `commentsIn` recognises one. */
const DIRECTIVE = /#\s*inwards:\s*ignore\b/u;

/**
 * Spells a node's type and offsets, which both sides must agree on.
 *
 * @param n - an import node.
 * @param n.type - its node type.
 * @param n.startIndex - its first offset.
 * @param n.endIndex - the offset after it.
 * @returns `type@start-end`.
 */
function span(n: { type: string; startIndex: number; endIndex: number }): string {
  return `${n.type}@${n.startIndex}-${n.endIndex}`;
}

/**
 * Spells a tree-sitter point the way a diagnostic does, 1-based.
 *
 * @param p - a 0-based point.
 * @param p.row - its row.
 * @param p.column - its column.
 * @returns `line:column`.
 */
function point(p: { row: number; column: number }): string {
  return `${p.row + 1}:${p.column + 1}`;
}

/**
 * Reads what both extractions must agree on, the new way and the reference way.
 *
 * @param tree - the parsed file.
 * @returns the spans of the imports and directive comments from each.
 */
function bothWays(tree: Tree): { walked: string[]; reference: string[] } {
  const root = tree.rootNode;
  return {
    walked: [
      ...importStatements(tree).map(span),
      ...commentsIn(tree).map(
        ({ span: s }) => `comment:${s.line}:${s.column}-${s.endLine}:${s.endColumn}`,
      ),
    ],
    reference: [
      ...root
        .descendantsOfType(["import_statement", "import_from_statement"])
        .flatMap((n) => (n ? [span(n)] : [])),
      ...root
        .descendantsOfType("comment")
        .flatMap((n) =>
          n && DIRECTIVE.test(n.text.trimEnd())
            ? [`comment:${point(n.startPosition)}-${point(n.endPosition)}`]
            : [],
        ),
    ],
  };
}

describe("full-parse extraction walk", () => {
  test("holders match the grammar's node-types.json", () => {
    expect([...IMPORT_HOLDERS].sort()).toEqual(derivedHolders());
  });

  test.each(SNIPPETS)("reads what descendantsOfType reads: %j", (text) => {
    const { walked, reference } = withTree(text, bothWays);
    expect(walked).toEqual(reference);
  });

  test("reads what descendantsOfType reads on broken mutations", () => {
    const texts = SNIPPETS.flatMap((text, i) => mutations(text, i + 1, 40));
    const broken = texts.filter((text) => withTree(text, (tree) => tree.rootNode.hasError));
    expect(broken.length).toBeGreaterThan(texts.length / 2);
    for (const text of texts) {
      const { walked, reference } = withTree(text, bothWays);
      expect({ text, walked }).toEqual({ text, walked: reference });
    }
  });

  test("finds a directive after non-BMP text at its UTF-16 column", () => {
    const text = 'x = "😀😀"  # inwards: ignore[INW001] reason="r"\n';
    expect(withTree(text, (tree) => commentsIn(tree).map((c) => c.span.column))).toEqual([13]);
  });
});
