/**
 * @file INW013's prefilter for a run over many files (#369): a checked file
 * that names no blocking type and no blocking helper (or an alias of one) is
 * skipped unparsed, and a run that skips gives exactly the findings each
 * file gets when it is checked alone, without the prefilter. The project
 * covers what the prefilter must not miss: renaming re-exports (one spread
 * over lines with a comment), a call through a module alias, relative
 * imports, a receiver passed to a helper whose module names nothing, and a
 * helper name spelled in fullwidth letters, which NFKC folds.
 */
import { describe, expect, test } from "bun:test";
import type { RuleOptions } from "../../src/config/_rule-settings.ts";
import { Engine, parseConfig } from "../../src/index.ts";
import { AsyncBlockingRun } from "../../src/rules/async-blocking/_check.ts";
import { ModuleTrees } from "../../src/rules/shared/module-trees.ts";
import type { SourceFile } from "../../src/shared/contracts/records.ts";
import { file, grammars, indexOn, parser } from "../support/helpers.ts";

const CONFIG = `[tool.inwards]
layers = [
  { name = "app", modules = ["shop"] },
]

[tool.inwards.rules]
extend-select = ["INW013"]
`;

/** How many empty async modules pad the run past the prefilter's threshold. */
const FILLERS = 210;

const TEXTS = new Map<string, string>([
  ["shop/__init__.py", ""],
  [
    "shop/blocking/__init__.py",
    `from .impl import save_order as persist_order, plain_helper
from .sub import (
    deep_helper  # re-exported under another name
    as renamed_deep,
)
`,
  ],
  [
    "shop/blocking/impl.py",
    `from sqlalchemy.orm import Session
import redis

cache = redis.Redis()


def save_order(order):
    with Session(engine) as session:
        session.execute(order)


def plain_helper(key):
    return cache.get(key)


def takes_session(db, q):
    return db.execute(q)


@decorated
def decorated_helper(key):
    return cache.get(key)
`,
  ],
  ["shop/blocking/sub/__init__.py", "from .deeper import deep_helper\n"],
  [
    "shop/blocking/sub/deeper.py",
    `import sqlite3


def deep_helper(path):
    conn = sqlite3.connect(path)
    return conn.execute("select 1")
`,
  ],
  [
    "shop/callers.py",
    `from shop.blocking import persist_order, renamed_deep
from shop.blocking.impl import plain_helper as ph, decorated_helper
import shop.blocking.impl as impl_mod


async def a1(order):
    persist_order(order)


async def a2(p):
    renamed_deep(p)


async def a3(k):
    ph(k)
    impl_mod.save_order(k)
    decorated_helper(k)
`,
  ],
  [
    "shop/passes.py",
    `from sqlalchemy.orm import Session
from shop.blocking.impl import takes_session


async def handler(db: Session, q):
    takes_session(db, q)
    db.commit()
`,
  ],
  [
    "shop/relative.py",
    `from .blocking.impl import save_order
from .blocking import impl


async def r1(o):
    save_order(o)
    impl.plain_helper(o)
`,
  ],
  [
    "shop/fullwidth.py",
    "from shop.blocking import ｐersist_order\n\n\nasync def f(o):\n    ｐersist_order(o)\n",
  ],
  [
    "shop/unrelated.py",
    `from shop.blocking.impl import cache, takes_session


async def nothing(k, q):
    await other(k)
    takes_session(k, q)
`,
  ],
  ...Array.from({ length: FILLERS }, (_, n): [string, string] => [
    `shop/filler/m${n}.py`,
    `async def f${n}():\n    return ${n}\n`,
  ]),
]);

const DISK = new Map<string, "file" | "dir">([
  ["shop", "dir"],
  ["shop/blocking", "dir"],
  ["shop/blocking/sub", "dir"],
  ["shop/filler", "dir"],
  ...[...TEXTS.keys()].map((path): [string, "file"] => [path, "file"]),
]);

/**
 * Checks files in one run and keeps INW013's findings.
 *
 * @param paths - the files to check, in order.
 * @returns `path:line:column` for each finding.
 */
async function run(paths: readonly string[]): Promise<string[]> {
  const engine = await Engine.create(grammars(), parseConfig(CONFIG));
  return engine
    .checkFiles(
      paths.map((path) => file(path, TEXTS.get(path) ?? "")),
      indexOn(DISK, TEXTS),
    )
    .filter((d) => d.code === "INW013")
    .map((d) => `${d.file}:${d.line}:${d.column}`);
}

/**
 * Builds INW013's run state with the prefilter on, over the test project.
 *
 * @param options - `[tool.inwards.rules.async-blocking]`, if any.
 * @returns the run, and the trees to free.
 */
function blockingRun(options?: RuleOptions): {
  run: AsyncBlockingRun;
  trees: ModuleTrees;
} {
  const trees = new ModuleTrees(parser, indexOn(DISK, TEXTS));
  return { run: new AsyncBlockingRun(options, trees, [...TEXTS.keys()].map(source)), trees };
}

/**
 * Reads one of the test files.
 *
 * @param path - its root-relative path.
 * @returns the source file.
 */
function source(path: string): SourceFile {
  return file(path, TEXTS.get(path) ?? "");
}

describe("INW013's prefilter", () => {
  test("a run that skips files finds what each file finds alone", async () => {
    const paths = [...TEXTS.keys()];
    const alone = (await Promise.all(paths.map((path) => run([path])))).flat();
    expect(alone).toEqual([
      "shop/callers.py:7:5",
      "shop/callers.py:11:5",
      "shop/callers.py:15:5",
      "shop/callers.py:16:5",
      "shop/passes.py:6:5",
      "shop/passes.py:7:5",
      "shop/relative.py:6:5",
      "shop/relative.py:7:5",
      "shop/fullwidth.py:5:5",
    ]);
    expect(await run(paths)).toEqual(alone);
  });

  test("skips a file that names no blocking type and no blocking helper", () => {
    const { run: blocking, trees } = blockingRun();
    try {
      expect(blocking.mayFind(source("shop/unrelated.py"))).toBe(false);
      expect(blocking.mayFind(source("shop/filler/m0.py"))).toBe(false);
      for (const path of ["shop/callers.py", "shop/passes.py", "shop/fullwidth.py"]) {
        expect(blocking.mayFind(source(path))).toBe(true);
      }
      // `ph` is a caller's own alias: any `name as alias` counts.
      expect([...(blocking.helpers() ?? [])].sort()).toEqual([
        "deep_helper",
        "persist_order",
        "ph",
        "plain_helper",
        "renamed_deep",
        "save_order",
      ]);
    } finally {
      trees.dispose();
    }
  });

  test("a configured pattern with a wildcard turns the prefilter off", () => {
    const { run: blocking, trees } = blockingRun({ "extend-blocking-calls": ["shop.*.slow"] });
    try {
      expect(blocking.mayFind(source("shop/filler/m0.py"))).toBe(true);
      expect(blocking.helpers()).toBeUndefined();
    } finally {
      trees.dispose();
    }
  });

  test("an exact configured pattern counts like a built-in name", () => {
    const { run: blocking, trees } = blockingRun({
      "extend-blocking-calls": ["shop.filler.m1.f1"],
    });
    try {
      // `f1` is m1's own name, so m1 may spell the pattern; m0 can't.
      expect(blocking.mayFind(source("shop/filler/m1.py"))).toBe(true);
      expect(blocking.mayFind(source("shop/filler/m0.py"))).toBe(false);
    } finally {
      trees.dispose();
    }
  });
});
