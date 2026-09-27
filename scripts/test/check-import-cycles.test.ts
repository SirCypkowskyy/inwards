/**
 * @file The import graph behind `check-import-cycles.ts`, built on small
 * throwaway projects. Edges come from the syntax tree and the compiler's own
 * resolution, so extensionless, `index` and type-position imports count, and
 * comments or strings that merely mention an import neither hide nor invent one.
 */
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cycles, importGraph, isInside, pathKey } from "../check-import-cycles.ts";

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    strict: true,
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    allowImportingTsExtensions: true,
    noEmit: true,
  },
  include: ["src"],
});

const made: string[] = [];

afterAll(() => {
  for (const dir of made) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Writes a throwaway TypeScript project and returns the cycles in its `src`.
 *
 * @param files - source text by path relative to `src`.
 * @returns each cycle as the member paths relative to `src`, sorted.
 */
async function cyclesIn(files: Record<string, string>): Promise<string[][]> {
  const root = mkdtempSync(join(tmpdir(), "inwards-cycles-"));
  made.push(root);
  writeFileSync(join(root, "tsconfig.json"), TSCONFIG);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, "src", path)), { recursive: true });
    writeFileSync(join(root, "src", path), text);
  }
  const src = join(root, "src");
  const graph = await importGraph(join(root, "tsconfig.json"), src);
  // TypeScript may spell src through a symlink or in lower case (macOS, Windows).
  const prefix = `${pathKey(src)}/`;
  return cycles(graph).map((group) => group.map((file) => pathKey(file).slice(prefix.length)));
}

test("type-only imports without an extension form a cycle", async () => {
  const found = await cyclesIn({
    "a.ts": 'import type { B } from "./b";\n/** One side. */\nexport interface A { b: B }\n',
    "b.ts": 'import type { A } from "./a";\n/** The other side. */\nexport interface B { a: A }\n',
  });
  expect(found).toEqual([["a.ts", "b.ts"]]);
});

test("a comment inside the import doesn't hide the edge", async () => {
  const found = await cyclesIn({
    "a.ts": 'import type { B } from /* the other */ "./b.ts";\nexport type A = { b: B };\n',
    "b.ts": 'import type { A } from "./a.ts";\nexport type B = { a: A };\n',
  });
  expect(found).toEqual([["a.ts", "b.ts"]]);
});

test("commented-out imports and imports quoted in strings make no edge", async () => {
  const found = await cyclesIn({
    "a.ts": '// import { b } from "./b.ts";\n/* import "./b.ts" */\nexport const a = 1;\n',
    "b.ts":
      'import { a } from "./a.ts";\nexport const b = a;\nexport const doc = `import { b } from "./b.ts"`;\n',
  });
  expect(found).toEqual([]);
});

test("index modules and import() types resolve like the compiler resolves them", async () => {
  const found = await cyclesIn({
    "a.ts": 'export type A = import("./pkg").P;\n',
    "pkg/index.ts": 'import type { A } from "../a.ts";\nexport type P = { a: A };\n',
  });
  expect(found).toEqual([["a.ts", "pkg/index.ts"]]);
});

test("containment ignores case, as TypeScript lower-cases paths on macOS and Windows", () => {
  expect(isInside("c:/repo/src/cli/src/a.ts", "C:\\Repo\\src\\cli\\src")).toBe(true);
  expect(isInside("/users/runner/work/src/a.ts", "/Users/runner/work/src")).toBe(true);
});

test("containment holds across separators, as TypeScript reports paths on Windows", () => {
  expect(isInside("C:/repo/src/cli/src/a.ts", "C:\\repo\\src\\cli\\src")).toBe(true);
  expect(isInside("C:/repo/src/cli/srcx/a.ts", "C:\\repo\\src\\cli\\src")).toBe(false);
  expect(isInside("/repo/src/a.ts", "/repo/src/")).toBe(true);
  expect(isInside("/repo/src", "/repo/src")).toBe(false);
});
