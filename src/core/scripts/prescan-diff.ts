/**
 * Differential test for the import-skeleton prescan (ADR-004).
 *
 * Every file has its imports extracted twice: from the full parse and from the
 * skeleton. The skeleton may find extra imports (the engine confirms those
 * against a full parse) but must never miss one. Exits 1 if it does.
 *
 * Two corpora: a generated one of adversarial import spellings (always), and
 * every .py file under DIR when given (CI passes the Python stdlib).
 *
 *   bun run src/core/scripts/prescan-diff.ts "$(python3 -c 'import sysconfig; print(sysconfig.get_paths()["stdlib"])')"
 */
import { readFileSync } from "node:fs";
import { Glob } from "bun";
import { Language, Parser } from "web-tree-sitter";
import { skeletonImports } from "../src/prescan.ts";
import { extractImports, moduleNameFor, normalizeSource } from "../src/python.ts";
import type { ImportRef } from "../src/types.ts";

const wasm = (spec: string) => new Uint8Array(readFileSync(Bun.resolveSync(spec, import.meta.dir)));
await Parser.init({ wasmBinary: wasm("web-tree-sitter/web-tree-sitter.wasm") });
const parser = new Parser();
parser.setLanguage(await Language.load(wasm("tree-sitter-python/tree-sitter-python.wasm")));

const key = (r: ImportRef) => `${r.line}:${r.target}`;

function check(corpus: string, entries: Iterable<[string, string]>): boolean {
  let files = 0;
  let refused = 0;
  let extra = 0;
  const missed: string[] = [];
  for (const [rel, raw] of entries) {
    files++;
    const file = { path: rel, text: normalizeSource(raw), ...moduleNameFor(rel) };
    const fastRefs = skeletonImports(parser, file);
    if (!fastRefs) {
      refused++;
      continue;
    }
    const tree = parser.parse(file.text);
    if (!tree) throw new Error(`no tree for ${rel}`);
    const full = new Set(extractImports(tree, file).map(key));
    tree.delete();
    const fast = new Set(fastRefs.map(key));
    for (const k of full) if (!fast.has(k)) missed.push(`${rel} ${k}\n${JSON.stringify(raw)}`);
    for (const k of fast) if (!full.has(k)) extra++;
  }
  const pct = files ? ((100 * refused) / files).toFixed(1) : "0";
  console.log(
    `${corpus}: files=${files} refused=${refused} (${pct}%) extra=${extra} missed=${missed.length}`,
  );
  if (missed.length > 0) console.error(missed.slice(0, 20).join("\n"));
  return missed.length === 0;
}

// Each form imports M somewhere. Forms are combined in pairs and in
// string-context triples, since most misses come from one line changing how
// the prescan reads the next (continuations, strings, comments).
const FORMS = [
  "import M",
  "import M as alias",
  "import M, os",
  "from M import x",
  "from M import x as y, z",
  "from M import *",
  "from M import (\n    x,\n    y,\n)",
  "from M import (x,\n    y)",
  "from M import (x,  # comment )\n    y)",
  "from M import (x, y)  # )",
  "from M import (\n    x,  # it's\n)",
  "from M \\\n    import x",
  "from \\\n    M import x",
  "import \\\n    M",
  "from M import x, \\\n    y",
  "from M import x \\\n    , y",
  "x = 1; import M",
  "import os; import M",
  "import M; x = 1",
  "x = [1] \\\n    ; import M",
  "if True: import M",
  "if x:\n    pass\nelse: import M",
  "try: import M\nexcept ImportError: pass",
  "while False: import M",
  "for _ in (): import M",
  "with ctx: import M",
  "def f(): import M",
  "class C: import M",
  "async def f():\n    import M",
  "@decorator\ndef f(): import M",
  "def f():\n\timport M",
  "def f():\n \t  import M",
  "if x:\n    if y:\n        from M import (\n            z)",
  "match x:\n    case 1:\n        import M",
  "\fimport M",
  "from.M import x",
  "from . import M",
  "from .M import x",
  "# import M",
  "x = 1  # import M",
  "# c\rimport M",
  "x = 1\rimport M",
  "s = 'import M'",
  's = "from M import x"',
  's = """\nimport M\n"""',
  "s = '''\nfrom M import (\n'''",
  's = """\nfrom a import (\n"""',
  's = """\n)\n"""',
  's = """\nimport os \\\n"""',
  `s = """\nimport M; t = '''\n"""`,
  `s = """\nfrom M import x; t = '''\n"""`,
  `s = """\nimport M \\\n    ; t = '''\n"""`,
  's = f"""\n{x}\nimport M\n"""',
  "s = r'\\\nimport M'",
  "x = (\n  1)\nimport M",
  "x = (\nimport_ := 1)\nimport M",
  "lambda: __import__('M')",
  "print(1) ; from M import x",
];

// Strings and comments: the forms that can swallow or be swallowed by their neighbours.
const CONTEXTS = FORMS.filter((f) => /^(s = |#)|\r/.test(f));

function* generated(): Generator<[string, string]> {
  const n = (text: string, tag: string) => text.replaceAll("M", `pkg.m${tag}`);
  const variants = (name: string, text: string): [string, string][] => [
    [`${name}.py`, text],
    [`${name}-crlf.py`, text.replaceAll("\n", "\r\n")],
    [`${name}-bom.py`, `\uFEFF${text}`],
  ];
  for (const [i, a] of FORMS.entries()) {
    for (const [j, b] of FORMS.entries()) {
      yield* variants(`pkg/pair_${i}_${j}`, `${n(a, "a")}\n${n(b, "b")}\n`);
    }
  }
  for (const [i, a] of CONTEXTS.entries()) {
    for (const [j, b] of FORMS.entries()) {
      for (const [k, c] of CONTEXTS.entries()) {
        yield* variants(`pkg/triple_${i}_${j}_${k}`, `${n(a, "a")}\n${n(b, "b")}\n${n(c, "c")}\n`);
      }
    }
  }
}

function* tree(dir: string): Generator<[string, string]> {
  for (const rel of new Glob("**/*.py").scanSync(dir)) {
    try {
      yield [rel, readFileSync(`${dir}/${rel}`, "utf8")];
    } catch {
      // unreadable or not UTF-8: not our problem here
    }
  }
}

let ok = check("generated", generated());
const dir = process.argv[2];
if (dir) ok = check(dir, tree(dir)) && ok;
if (!ok) process.exit(1);
