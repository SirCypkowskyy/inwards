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
import process from "node:process";
import { Glob } from "bun";
import { Language, Parser } from "web-tree-sitter";
import { skeletonImports } from "../src/prescan.ts";
import { extractImports, moduleNameFor, normalizeSource } from "../src/python.ts";
import type { ImportRef } from "../src/types.ts";

function wasm(spec: string): Uint8Array {
  return new Uint8Array(readFileSync(Bun.resolveSync(spec, import.meta.dir)));
}

await Parser.init({ wasmBinary: wasm("web-tree-sitter/web-tree-sitter.wasm") });
const parser = new Parser();
parser.setLanguage(await Language.load(wasm("tree-sitter-python/tree-sitter-python.wasm")));

/** Share of files, in percent, that the prescan declined. */
const PERCENT = 100;
/** Misses printed in full; the count covers the rest. */
const MISSES_SHOWN = 20;

function key(r: ImportRef): string {
  return `${r.line}:${r.target}`;
}

type Outcome = { refused: true } | { refused: false; missed: string[]; extra: number };

function compare(rel: string, raw: string): Outcome {
  const file = { path: rel, text: normalizeSource(raw), ...moduleNameFor(rel) };
  const fastRefs = skeletonImports(parser, file);
  if (!fastRefs) {
    return { refused: true };
  }
  const parsed = parser.parse(file.text);
  if (!parsed) {
    throw new Error(`no tree for ${rel}`);
  }
  const full = new Set(extractImports(parsed, file).map(key));
  parsed.delete();
  const fast = new Set(fastRefs.map(key));
  const missed = [...full]
    .filter((k) => !fast.has(k))
    .map((k) => `${rel} ${k}\n${JSON.stringify(raw)}`);
  const extra = [...fast].filter((k) => !full.has(k)).length;
  return { refused: false, missed, extra };
}

function check(corpus: string, entries: Iterable<[string, string]>): boolean {
  let files = 0;
  let refused = 0;
  let extra = 0;
  const missed: string[] = [];
  for (const [rel, raw] of entries) {
    files += 1;
    const outcome = compare(rel, raw);
    if (outcome.refused) {
      refused += 1;
      continue;
    }
    missed.push(...outcome.missed);
    extra += outcome.extra;
  }
  const pct = files ? ((PERCENT * refused) / files).toFixed(1) : "0";
  console.log(
    `${corpus}: files=${files} refused=${refused} (${pct}%) extra=${extra} missed=${missed.length}`,
  );
  if (missed.length > 0) {
    console.error(missed.slice(0, MISSES_SHOWN).join("\n"));
  }
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
const STRING_OR_COMMENT = /^(?:s = |#)|\r/u;
const CONTEXTS = FORMS.filter((f) => STRING_OR_COMMENT.exec(f) !== null);

function named(text: string, tag: string): string {
  return text.replaceAll("M", `pkg.m${tag}`);
}

function variants(name: string, text: string): [string, string][] {
  return [
    [`${name}.py`, text],
    [`${name}-crlf.py`, text.replaceAll("\n", "\r\n")],
    [`${name}-bom.py`, `\uFEFF${text}`],
  ];
}

function* generated(): Generator<[string, string]> {
  for (const [i, a] of FORMS.entries()) {
    for (const [j, b] of FORMS.entries()) {
      yield* variants(`pkg/pair_${i}_${j}`, `${named(a, "a")}\n${named(b, "b")}\n`);
    }
  }
  for (const [i, a] of CONTEXTS.entries()) {
    for (const [j, b] of FORMS.entries()) {
      for (const [k, c] of CONTEXTS.entries()) {
        yield* variants(
          `pkg/triple_${i}_${j}_${k}`,
          `${named(a, "a")}\n${named(b, "b")}\n${named(c, "c")}\n`,
        );
      }
    }
  }
}

function* pythonFilesUnder(dir: string): Generator<[string, string]> {
  for (const rel of new Glob("**/*.py").scanSync(dir)) {
    try {
      yield [rel, readFileSync(`${dir}/${rel}`, "utf8")];
    } catch {
      // unreadable or not UTF-8: not our problem here
    }
  }
}

let ok: boolean = check("generated", generated());
const [, , stdlibDir]: (string | undefined)[] = process.argv;
if (stdlibDir) {
  ok = check(stdlibDir, pythonFilesUnder(stdlibDir)) && ok;
}
if (!ok) {
  process.exit(1);
}
