/**
 * @file The engine's extraction cache (#56) saves work and never changes a
 * result. The same files are checked with no cache, an empty cache and a warm
 * one, and every result must match, baseline shortcut included. A warm run
 * stores nothing new; the identity includes the module name and package flag;
 * a file that skipped the prescan isn't recorded as refused; and results that
 * depend on other files (an import's target existing, a rebound `eval`)
 * follow the project, not the cache.
 */
import { describe, expect, test } from "bun:test";
import {
  baselineKey,
  type CachedExtraction,
  type Checked,
  Engine,
  type ExtractionCache,
  type ExtractionIdentity,
  type ProjectFiles,
  type ProjectIndex,
  parseConfig,
  type SourceFile,
} from "../../src/index.ts";
import { file, grammars, indexOn, PROJECT } from "../support/helpers.ts";

const CONFIG = parseConfig(`
[tool.inwards]
ignore = ["scripts"]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "application", modules = ["shop.application"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]
`);

/** An in-memory cache that counts what it stores. */
class CountingCache implements ExtractionCache {
  readonly entries: Map<string, CachedExtraction> = new Map();
  writes = 0;

  /**
   * Looks a file up by its whole identity.
   *
   * @param identity - the file and the extraction revision.
   * @returns the stored components, or undefined.
   */
  get(identity: ExtractionIdentity): CachedExtraction | undefined {
    return this.entries.get(JSON.stringify(identity));
  }

  /**
   * Stores a file's components and counts the write.
   *
   * @param identity - the file and the extraction revision.
   * @param value - every component known so far.
   */
  set(identity: ExtractionIdentity, value: CachedExtraction): void {
    this.writes += 1;
    this.entries.set(JSON.stringify(identity), value);
  }
}

/** Files that take every path through the engine. */
const FILES: SourceFile[] = [
  file("shop/domain/clean.py", "from shop.domain import order\n"),
  file("shop/domain/outward.py", "import shop.infrastructure.db\n"),
  file("shop/domain/missing.py", "import shop.domain.pricing\n"),
  file(
    "shop/domain/loader.py",
    'import importlib\nimportlib.import_module("shop.infrastructure.db")\n',
  ),
  file(
    "shop/domain/allowed.py",
    'import shop.infrastructure.db  # inwards: ignore[INW001] reason="legacy"\n',
  ),
  file("shop/domain/bad_comment.py", "import os  # inwards: ignore[INW001]\n"),
  file(
    "shop/persistence/repo.py",
    'import shop.domain.order  # inwards: ignore[INW006] reason="moving"\nx = 1\n',
  ),
  file("shop/domain/encoded.py", "# coding: utf-16\nimport shop.infrastructure.db\n"),
  file("shop/domain/relative.py", "from ..infrastructure import db\n"),
  file("shop/domain/pkg/__init__.py", "from . import db\nfrom ..infrastructure import db\n"),
  file("shop/domain/crlf.py", "import shop.infrastructure.db\r\nx = 1\r\n"),
  file("shop/domain/bom.py", "﻿import shop.infrastructure.db\n"),
  file("shop/domain/quoted.py", 'x = """\nimport shop.infrastructure.db\n"""\n'),
  file("shop/domain/unicode.py", "import shop.infrastructure.dbé\n"),
];

/**
 * Checks the files with a fresh engine.
 *
 * @param cache - the cache to give the engine, if any.
 * @param project - the module index to check against.
 * @param accepted - baseline copies by key, for the shortcut.
 * @returns what the engine found.
 */
async function run(
  cache: ExtractionCache | undefined,
  project: ProjectIndex = PROJECT,
  accepted?: ReadonlyMap<string, number>,
): Promise<Checked> {
  const engine = await Engine.create(grammars(), CONFIG, cache ? { cache } : {});
  return engine.check(FILES, project, accepted);
}

describe("a cache never changes a result", () => {
  test("no cache, an empty cache and a warm cache agree", async () => {
    const cache = new CountingCache();
    const none = await run(undefined);
    expect(await run(cache)).toEqual(none);
    expect(await run(cache)).toEqual(none);
    expect(none.diagnostics.length).toBeGreaterThan(5);
    expect(none.suppressed.length).toBeGreaterThan(0);
  });

  test("with a baseline, the shortcut gives the same answer", async () => {
    const none = await run(undefined);
    const accepted = new Map<string, number>();
    for (const d of none.diagnostics) {
      accepted.set(baselineKey(d), (accepted.get(baselineKey(d)) ?? 0) + 1);
    }
    const cache = new CountingCache();
    const expected = await run(undefined, PROJECT, accepted);
    expect(await run(cache, PROJECT, accepted)).toEqual(expected);
    expect(await run(cache, PROJECT, accepted)).toEqual(expected);
  });

  test("a warm run stores nothing new", async () => {
    const cache = new CountingCache();
    await run(cache);
    cache.writes = 0;
    await run(cache);
    expect(cache.writes).toBe(0);
  });
});

/** Files on disk for the index tests: a package whose modules import each other. */
const DISK = new Map<string, string>([
  ["shop/__init__.py", ""],
  ["shop/domain/__init__.py", "from . import order\n"],
  ["shop/domain/order.py", "import shop.domain.pricing\n"],
  ["shop/domain/pricing.py", "x = 1\n"],
  ["shop/infrastructure/db.py", "from shop.domain import order, pricing\n"],
  ["shop/infrastructure/weird.py", "x = (\nimport shop.domain.order\n"],
]);

/**
 * The index test files as an adapter would give them.
 *
 * @returns a ProjectFiles over `DISK`, directories derived from the paths.
 */
function diskFiles(): ProjectFiles {
  const dirs = new Set(
    [...DISK.keys()].flatMap((p) =>
      p
        .split("/")
        .slice(0, -1)
        .map((_, i, a) => a.slice(0, i + 1).join("/")),
    ),
  );
  return {
    kind(rel: string): "file" | "dir" | undefined {
      if (DISK.has(rel)) {
        return "file";
      }
      return dirs.has(rel) ? "dir" : undefined;
    },
    list: (): string[] => [...DISK.keys()],
    read: (rel: string): string => DISK.get(rel) ?? "",
    listDir: (): undefined => undefined,
  };
}

describe("the module index reads through the cache", () => {
  test("importers agree with no cache, an empty cache and a warm one", async () => {
    const cache = new CountingCache();
    const modules = ["shop.domain.order", "shop.domain.pricing", "shop.domain"];
    /**
     * Lists who imports each module, through a fresh engine.
     *
     * @param store - the cache to give the engine, if any.
     * @returns the importers of each module, sorted.
     */
    async function importers(store?: ExtractionCache): Promise<string[][]> {
      const engine = await Engine.create(grammars(), CONFIG, store ? { cache: store } : {});
      const index = engine.index(diskFiles());
      return modules.map((m) => [...index.importersOf(m)].sort());
    }
    const none = await importers();
    expect(await importers(cache)).toEqual(none);
    expect(cache.writes).toBeGreaterThan(0);
    cache.writes = 0;
    expect(await importers(cache)).toEqual(none);
    expect(cache.writes).toBe(0);
    expect(none.flat().length).toBeGreaterThan(2);
  });
});

describe("what the cache holds", () => {
  test("the identity includes the module and the package flag", async () => {
    const cache = new CountingCache();
    const engine = await Engine.create(grammars(), CONFIG, { cache });
    const text = "from . import db\n";
    engine.checkFiles([file("shop/domain/a.py", text)], PROJECT);
    engine.checkFiles([file("shop/domain/a/__init__.py", text)], PROJECT);
    engine.checkFiles([file("shop/application/a.py", text)], PROJECT);
    expect(cache.entries.size).toBe(3);
  });

  test("a file that skipped the prescan isn't recorded as refused", async () => {
    const cache = new CountingCache();
    const engine = await Engine.create(grammars(), CONFIG, { cache });
    const text = 'import shop.infrastructure.db  # inwards: ignore[INW001] reason="r"\n';
    engine.checkFiles([file("shop/domain/s.py", text)], PROJECT);
    const [entry] = cache.entries.values();
    expect(entry?.skeleton).toBeUndefined();
    expect(entry?.full?.length).toBe(1);
    expect(entry?.comments?.length).toBe(1);
  });

  test("an empty result is kept apart from a missing one", async () => {
    const cache = new CountingCache();
    const engine = await Engine.create(grammars(), CONFIG, { cache });
    engine.checkFiles([file("shop/domain/empty.py", "x = 1\n")], PROJECT);
    const [entry] = cache.entries.values();
    expect(entry?.skeleton).toEqual([]);
    expect(entry?.full).toBeUndefined();
  });
});

describe("results that depend on other files follow the project", () => {
  test("INW010 follows whether the target exists", async () => {
    const cache = new CountingCache();
    /**
     * Checks the files and lists the codes reported on the missing-module file.
     *
     * @param project - the module index to check against.
     * @returns the codes on `shop/domain/missing.py`.
     */
    async function codes(project: ProjectIndex): Promise<string[]> {
      return (await run(cache, project)).diagnostics
        .filter((d) => d.file === "shop/domain/missing.py")
        .map((d) => d.code);
    }
    expect(await codes(PROJECT)).toEqual(["INW010"]);
    const withPricing = indexOn(
      new Map([
        ["shop", "dir"],
        ["shop/__init__.py", "file"],
        ["shop/domain", "dir"],
        ["shop/domain/pricing.py", "file"],
        ["shop/infrastructure", "dir"],
        ["shop/infrastructure/db.py", "file"],
      ]),
    );
    expect(await codes(withPricing)).toEqual([]);
  });

  test("a rebound eval is judged against the current project, never cached", async () => {
    const text = "from mylib import eval\neval(expr)\n";
    const src = file("shop/domain/rebound.py", text);
    const cache = new CountingCache();
    const engine = await Engine.create(grammars(), CONFIG, { cache });
    const without = engine.checkFiles([src], PROJECT).map((d) => d.code);
    const mylib = indexOn(
      new Map([
        ["shop", "dir"],
        ["shop/__init__.py", "file"],
        ["shop/domain", "dir"],
        ["mylib.py", "file"],
      ]),
    );
    const plain = await Engine.create(grammars(), CONFIG);
    const withMylib = engine.checkFiles([src], mylib).map((d) => d.code);
    // A first-party mylib may re-export the builtin, so INW011 reports the call.
    expect(withMylib).toContain("INW011");
    expect(without).not.toContain("INW011");
    expect(withMylib).toEqual(plain.checkFiles([src], mylib).map((d) => d.code));
    expect(engine.checkFiles([src], PROJECT).map((d) => d.code)).toEqual(without);
  });
});
