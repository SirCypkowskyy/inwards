/**
 * Differential test for the import-skeleton prescan (ADR-004).
 *
 * For every .py file under DIR, extract imports twice: from the full parse and
 * from the skeleton. The skeleton may find extra imports (the engine confirms
 * those against a full parse) but must never miss one. Exits 1 if it does.
 *
 *   bun run src/core/scripts/prescan-diff.ts "$(python3 -c 'import sysconfig; print(sysconfig.get_paths()["stdlib"])')"
 */
import { readFileSync } from "node:fs";
import { Glob } from "bun";
import { Language, Parser } from "web-tree-sitter";
import { importSkeleton } from "../src/prescan.ts";
import { extractImports, moduleNameFor } from "../src/python.ts";

const dir = process.argv[2];
if (!dir) throw new Error("usage: prescan-diff.ts DIR");

const wasm = (spec: string) => new Uint8Array(readFileSync(Bun.resolveSync(spec, import.meta.dir)));
await Parser.init({ wasmBinary: wasm("web-tree-sitter/web-tree-sitter.wasm") });
const parser = new Parser();
parser.setLanguage(await Language.load(wasm("tree-sitter-python/tree-sitter-python.wasm")));

const importsOf = (text: string, file: Parameters<typeof extractImports>[1]) => {
  const tree = parser.parse(text);
  if (!tree) throw new Error(`no tree for ${file.path}`);
  try {
    return new Set(extractImports(tree, file).map((r) => `${r.line}:${r.target}`));
  } finally {
    tree.delete();
  }
};

let files = 0;
let refused = 0;
let extra = 0;
const missed: string[] = [];
for (const rel of new Glob("**/*.py").scanSync(dir)) {
  let text: string;
  try {
    text = readFileSync(`${dir}/${rel}`, "utf8");
  } catch {
    continue; // unreadable or not UTF-8: not our problem here
  }
  files++;
  const file = { path: rel, text, ...moduleNameFor(rel) };
  const skeleton = importSkeleton(text);
  if (!skeleton) {
    refused++;
    continue;
  }
  const full = importsOf(text, file);
  const fast = importsOf(skeleton.text, file);
  for (const k of full) if (!fast.has(k)) missed.push(`${rel} ${k}`);
  for (const k of fast) if (!full.has(k)) extra++;
}

const pct = files ? ((100 * refused) / files).toFixed(1) : "0";
console.log(`files=${files} refused=${refused} (${pct}%) extra=${extra} missed=${missed.length}`);
if (missed.length > 0) {
  console.error(missed.slice(0, 20).join("\n"));
  process.exit(1);
}
