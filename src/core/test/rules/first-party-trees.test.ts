/**
 * @file The run's first-party modules (#359): `ModuleTrees` reads and parses
 * each module at most once, whichever rule or checked file asks, and hands
 * a checked file its tree back only for the same path and text. A call to a
 * method of a module-level object reads nothing, and a run of many files
 * gives INW013 the findings each file gets when it is checked alone, the
 * helper's own module included, which reuses the tree its callers parsed.
 */
import { describe, expect, test } from "bun:test";
import type { SourceFile } from "../../src/contracts/records.ts";
import { Engine, parseConfig } from "../../src/index.ts";
import { type ModuleNames, ParsedModules } from "../../src/rules/shared/first-party.ts";
import { ModuleTrees } from "../../src/rules/shared/module-trees.ts";
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

  test("hands a checked file its tree back only for the same path and text", () => {
    const { trees } = counted();
    try {
      const users = MODULES.get("shop.users");
      expect(users && trees.parsedAs(users)).toBeUndefined(); // not parsed yet
      const parsed = trees.moduleOf("shop.users");
      expect(users && trees.parsedAs(users)).toBe(parsed?.tree);
      expect(
        users && trees.parsedAs({ ...users, text: `${users.text}\n# edited\n` }),
      ).toBeUndefined();
      expect(users && trees.parsedAs({ ...users, path: "shop/users.pyi" })).toBeUndefined();
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
