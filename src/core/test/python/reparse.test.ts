/**
 * @file A parse that starts from the last tree (`TreeReuse`, #122) gives the same
 * tree as a fresh parse. Each case parses one text, then another through the
 * same `TreeReuse`, and compares every node (type, span, rows and columns,
 * error and missing flags) with a fresh parse of the second text: on
 * hand-picked edits, on seeded chains of syntax-breaking edits, across long
 * comment runs that `flattenCommentRuns` blanks, and with non-BMP text. The
 * engine is checked too: a file's diagnostics don't change when its engine
 * shares a `TreeReuse` with the check before it.
 */
import { describe, expect, test } from "bun:test";
import type { Tree } from "web-tree-sitter";
import { Engine, parseConfig } from "../../src/index.ts";
import { parsePython } from "../../src/python/parser.ts";
import { createTreeReuse, editBetween, type TreeReuse } from "../../src/python/reparse.ts";
import { file, grammars, PROJECT, parser } from "../support/helpers.ts";

/**
 * Lists every node of a tree, named and anonymous, in document order, with
 * its span, its rows and columns, and its error flags.
 *
 * @param tree - a parse, fresh or incremental.
 * @returns one line per node.
 */
function dump(tree: Tree): string[] {
  const lines: string[] = [];
  const cursor = tree.walk();
  try {
    for (;;) {
      const n = cursor.currentNode;
      const at = `${n.startPosition.row}:${n.startPosition.column}-${n.endPosition.row}:${n.endPosition.column}`;
      const flags = `${n.isError ? " error" : ""}${n.isMissing ? " missing" : ""}${n.hasError ? " has-error" : ""}`;
      lines.push(`${n.type} ${n.startIndex}-${n.endIndex} ${at}${flags}`);
      if (cursor.gotoFirstChild()) {
        continue;
      }
      while (!cursor.gotoNextSibling()) {
        if (!cursor.gotoParent()) {
          return lines;
        }
      }
    }
  } finally {
    cursor.delete();
  }
}

/**
 * Parses a text from scratch and lists its nodes.
 *
 * @param text - the Python source.
 * @returns `dump` of the fresh tree.
 */
function fresh(text: string): string[] {
  const tree = parsePython(parser, text);
  try {
    return dump(tree);
  } finally {
    tree.delete();
  }
}

/**
 * Parses a text through a `TreeReuse` and lists its nodes.
 *
 * @param reuse - the kept parse.
 * @param text - the Python source.
 * @param path - the file the text belongs to.
 * @returns `dump` of the tree.
 */
function reused(reuse: TreeReuse, text: string, path = "shop/domain/order.py"): string[] {
  const tree = reuse.parse(parser, path, text);
  try {
    return dump(tree);
  } finally {
    tree.delete();
  }
}

/** A module shaped like a service: imports, classes, functions with local imports. */
const SERVICE = [
  "from __future__ import annotations",
  "import os",
  "from shop.domain import model",
  "from shop.infrastructure.db import Session  # the outward import",
  "",
  "",
  "class OrderService:",
  '    """Places orders."""',
  "",
  "    def place(self, order: model.Order) -> None:",
  "        from shop.application import events",
  "        if order.total > 0:",
  "            events.emit(order)",
  "        else:",
  '            raise ValueError(f"empty {order!r}")',
  "",
  "    async def cancel(self, order_id: int) -> None:",
  "        async with Session() as s:",
  "            await s.delete(order_id)",
  "",
  "",
  "def helper(x):",
  "    return [y for y in x if y]",
  "",
].join("\n");

/** Fragments spliced in to break the syntax, as in `extraction-walk.test.ts`. */
const JUNK = [
  "(",
  ")",
  ":",
  "import",
  "from x import",
  "\n",
  "    ",
  "'''",
  '"',
  "[",
  "\\\n",
  "😀",
  "# c\n",
];

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
 * Makes a chain of edits: each text is the previous one with a fragment
 * spliced in or a short slice cut out at a random offset, so later texts
 * pile errors on earlier ones and some edits repair them.
 *
 * @param text - the first text.
 * @param seed - the generator's seed, so a failure reproduces.
 * @param count - how many edits.
 * @returns the texts after each edit.
 */
function chain(text: string, seed: number, count: number): string[] {
  const state = { seed };
  const texts: string[] = [];
  let out = text;
  for (let i = 0; i < count; i += 1) {
    const at = nextBelow(state, out.length + 1);
    out =
      nextBelow(state, 3) === 0
        ? out.slice(0, at) + out.slice(at + 1 + nextBelow(state, 12))
        : out.slice(0, at) + (JUNK[nextBelow(state, JUNK.length)] ?? "") + out.slice(at);
    texts.push(out);
  }
  return texts;
}

/** Sixteen comment-only lines: the shortest run `flattenCommentRuns` blanks. */
const COMMENT_RUN = Array.from({ length: 16 }, (_, i) => `# note ${i}`).join("\n");

describe("TreeReuse", () => {
  test.each([
    ["an edit in a body", SERVICE, SERVICE.replace("y for y", "z for z")],
    ["a new import", SERVICE, SERVICE.replace("import os\n", "import os\nimport sys\n")],
    ["a deleted class line", SERVICE, SERVICE.replace("class OrderService:\n", "")],
    ["a dedent", SERVICE, SERVICE.replace("        else:", "    else:")],
    ["an opened string", SERVICE, SERVICE.replace('"""Places', '"""Places\n')],
    ["the same text", SERVICE, SERVICE],
    ["an empty text", SERVICE, ""],
    ["from empty", "", SERVICE],
    ["a comment run appears", SERVICE, `${COMMENT_RUN}\n${SERVICE}`],
    ["a comment run is cut", `${COMMENT_RUN}\n${SERVICE}`, `${COMMENT_RUN.slice(9)}\n${SERVICE}`],
    ["non-BMP text before the edit", `s = "😀😀"\n${SERVICE}`, `s = "😀😀"\n${SERVICE}x = 1\n`],
    ["an emoji replaced by another", 's = "😀"\nimport a\n', 's = "😃"\nimport a\n'],
    [
      "CRLF lines",
      SERVICE.replaceAll("\n", "\r\n"),
      SERVICE.replaceAll("\n", "\r\n").replace("os", "io"),
    ],
  ])("parses %s as a fresh parse does", (_, before, after) => {
    const reuse = createTreeReuse();
    try {
      expect(reused(reuse, before)).toEqual(fresh(before));
      expect(reused(reuse, after)).toEqual(fresh(after));
      expect(reused(reuse, before)).toEqual(fresh(before));
    } finally {
      reuse.clear();
    }
  });

  test("parses chains of syntax-breaking edits as fresh parses do", () => {
    const reuse = createTreeReuse();
    let broken = 0;
    try {
      for (let seed = 1; seed <= 12; seed += 1) {
        reused(reuse, SERVICE);
        for (const text of chain(SERVICE, seed, 25)) {
          const expected = fresh(text);
          broken += expected[0]?.endsWith("has-error") === true ? 1 : 0;
          expect({ text, nodes: reused(reuse, text) }).toEqual({ text, nodes: expected });
        }
      }
    } finally {
      reuse.clear();
    }
    expect(broken).toBeGreaterThan(100);
  });

  test("starts from scratch for another path", () => {
    const reuse = createTreeReuse();
    try {
      reused(reuse, SERVICE, "a.py");
      expect(reused(reuse, `${SERVICE}x = 1\n`, "b.py")).toEqual(fresh(`${SERVICE}x = 1\n`));
    } finally {
      reuse.clear();
    }
  });

  test("describes the edit in UTF-16 code units, rows and columns", () => {
    const edit = editBetween('a = "😀"\nb = 1\n', 'a = "😀"\nb = 22\n');
    expect(edit).toMatchObject({
      startIndex: 13,
      oldEndIndex: 14,
      newEndIndex: 15,
      startPosition: { row: 1, column: 4 },
      oldEndPosition: { row: 1, column: 5 },
      newEndPosition: { row: 1, column: 6 },
    });
  });

  test("never splits a surrogate pair", () => {
    // 😀 and 😃 share their high surrogate: the edit starts before it.
    const edit = editBetween('s = "😀"', 's = "😃"');
    expect(edit).toMatchObject({ startIndex: 5, oldEndIndex: 7, newEndIndex: 7 });
  });
});

describe("an engine with a TreeReuse", () => {
  const config = parseConfig(`
[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "application", modules = ["shop.application"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]
`);

  test("reports what an engine without one reports, check after check", async () => {
    const reuse = createTreeReuse();
    try {
      const plain = await Engine.create(grammars(), config);
      const now = await Engine.create(grammars(), config, { reuse });
      const before = await Engine.create(grammars(), config, { reuse });
      const texts = [SERVICE, ...chain(SERVICE, 7, 30)];
      for (const [i, text] of texts.entries()) {
        const src = file("shop/domain/order.py", text);
        // Two engines take turns, as the hook's check now and at session start do.
        const engine = i % 2 === 0 ? now : before;
        expect({ text, found: engine.checkFile(src, PROJECT) }).toEqual({
          text,
          found: plain.checkFile(file("shop/domain/order.py", text), PROJECT),
        });
      }
    } finally {
      reuse.clear();
    }
  });
});
