/**
 * @file The run's first-party modules (#359): `ModuleTrees` reads and parses
 * each text at most once, whichever rule, hop or checked file asks, and a
 * checked file shares the tree of the module with the same text. A call to a
 * method of a module-level object reads nothing, and a run of many files
 * gives INW013 the findings each file gets when it is checked alone, the
 * helper's own module included, which reuses the tree its callers parsed.
 */
import { describe, expect, test } from "bun:test";
import { Engine, parseConfig } from "../../src/index.ts";
import { type ModuleNames, ParsedModules } from "../../src/rules/shared/first-party.ts";
import { ModuleTrees } from "../../src/rules/shared/module-trees.ts";
import type { SourceFile } from "../../src/shared/contracts/records.ts";
import { file, grammars, indexOn, parser } from "../support/helpers.ts";

/** The test modules by name. */
const MODULES = new Map<string, SourceFile>([
  [
    "shop.users",
    {
      path: "shop/users.py",
      module: "shop.users",
      isPackage: false,
      text: "def create_user(db):\n    db.commit()\n",
    },
  ],
  [
    "shop",
    {
      path: "shop/__init__.py",
      module: "shop",
      isPackage: true,
      text: "from shop.users import create_user\nservice = object()\n",
    },
  ],
]);

/**
 * Builds a run over `MODULES` that counts how often each module is read.
 *
 * @returns the run's trees, and the reads by module.
 */
function counted(): { trees: ModuleTrees; reads: Map<string, number> } {
  const reads = new Map<string, number>();
  const trees = new ModuleTrees(parser, {
    ownerOf: (target: string): string | undefined =>
      [...MODULES.keys()]
        .filter((m) => target === m || target.startsWith(`${m}.`))
        .sort((a, b) => b.length - a.length)[0],
    sourceOf: (module: string): SourceFile | undefined => {
      reads.set(module, (reads.get(module) ?? 0) + 1);
      return MODULES.get(module);
    },
  });
  return { trees, reads };
}

/**
 * Reads a module as a view that keeps only its source, for `ParsedModules`.
 *
 * @param _tree - the module's tree, unused.
 * @param src - the module's file.
 * @returns a view with no imported names.
 */
function plain(_tree: unknown, src: SourceFile): ModuleNames {
  return { src, names: new Map() };
}

describe("ModuleTrees", () => {
  test("parses a module once however many views ask for it", () => {
    const { trees, reads } = counted();
    try {
      const first = trees.moduleOf("shop.users");
      const views = [new ParsedModules(trees, plain), new ParsedModules(trees, plain)];
      for (const view of views) {
        view.viewOf("shop.users");
      }
      expect(trees.moduleOf("shop.users")?.tree).toBe(first?.tree);
      expect(trees.moduleOf("shop.missing")).toBeUndefined();
      expect(trees.moduleOf("shop.missing")).toBeUndefined();
      expect(Object.fromEntries(reads)).toEqual({ "shop.users": 1, "shop.missing": 1 });
    } finally {
      trees.dispose();
    }
  });

  test("parses each text once, for a module a hop reads and a checked file alike", () => {
    const { trees } = counted();
    try {
      const users = MODULES.get("shop.users");
      const checked = users && trees.treeOf(users); // a content rule asks first
      expect(trees.moduleOf("shop.users")?.tree).toBe(checked);
      // The CLI names a checked file from the working directory, the index from the root:
      // the tree depends on the text alone.
      expect(users && trees.treeOf({ ...users, path: "server/shop/users.py" })).toBe(checked);
      const edited = users && trees.treeOf({ ...users, text: `${users.text}\n# edited\n` });
      expect(edited).toBeDefined();
      expect(edited).not.toBe(checked);
    } finally {
      trees.dispose();
    }
  });

  test("a method of a module-level object reads nothing", () => {
    const { trees, reads } = counted();
    try {
      const views = new ParsedModules(trees, plain);
      expect(views.follow("shop.service.create", () => undefined)).toBeUndefined();
      expect(reads.size).toBe(0);
    } finally {
      trees.dispose();
    }
  });
});

const CONFIG = `[tool.inwards]
layers = [
  { name = "application", modules = ["shop.application"] },
  { name = "api", modules = ["shop.api"] },
]

[tool.inwards.rules]
extend-select = ["INW013"]
`;

/**
 * An async route module that calls the blocking helper.
 *
 * @param name - the route's function name.
 * @returns the module's text.
 */
function route(name: string): string {
  return `from sqlalchemy.orm import Session

from shop.application import users


async def ${name}(db: Session):
    return users.create_user(db)
`;
}

const USERS = `from sqlalchemy.orm import Session


def create_user(db):
    db.execute("insert")


async def purge(db: Session):
    db.commit()
`;

const TEXTS = new Map([
  ["shop/api/orders.py", route("order")],
  ["shop/api/admin.py", route("admin")],
  ["shop/application/users.py", USERS],
]);

const DISK = new Map<string, "file" | "dir">([
  ["shop", "dir"],
  ["shop/__init__.py", "file"],
  ["shop/api", "dir"],
  ["shop/api/__init__.py", "file"],
  ["shop/application", "dir"],
  ["shop/application/__init__.py", "file"],
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

describe("INW013 over a run of many files", () => {
  test("every caller and the helper's own module get the findings they get alone", async () => {
    const paths = [...TEXTS.keys()];
    const alone = (await Promise.all(paths.map((path) => run([path])))).flat();
    expect(alone).toEqual([
      "shop/api/orders.py:7:12",
      "shop/api/admin.py:7:12",
      "shop/application/users.py:9:5",
    ]);
    expect(await run(paths)).toEqual(alone);
  });
});
