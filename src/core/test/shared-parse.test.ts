/**
 * @file One parse per text per run across the content rules (#387): INW012,
 * INW013, INW014, INW016 (per file and project-wide), FAPI007 and the
 * FastAPI model all read a checked file's tree from the run's
 * `ModuleTrees`, so a file every one of them reads is parsed once, and a module a hop or a name resolution reads
 * shares the tree of the checked file with the same text. The parser is
 * wrapped to count its parses; the findings are compared with a check of
 * each file alone, so sharing changes nothing a rule reports.
 */
import { describe, expect, test } from "bun:test";
import type { Parser } from "web-tree-sitter";
import { parseConfig } from "../src/config/_parse.ts";
import { ContentRun, contentFindings } from "../src/engine/content-rules.ts";
import { fastApiFindings } from "../src/engine/fastapi.ts";
import { ormProjectFindings } from "../src/engine/orm-naming.ts";
import { Engine } from "../src/index.ts";
import type { Diagnostic, SourceFile } from "../src/shared/contracts/records.ts";
import { moduleNodes } from "../src/shared/python/nodes.ts";
import { importedNames } from "../src/shared/python/parser.ts";
import { skeletonNames } from "../src/shared/python/prescan.ts";
import { file, grammars, indexOn, parser } from "./support/helpers.ts";

const CONFIG = parseConfig(`[tool.inwards]
layers = [
  { name = "core", modules = ["app.core"] },
  { name = "api", modules = ["app.api"] },
]

[tool.inwards.rules]
extend-select = ["INW012", "INW013", "INW014", "INW015", "INW016", "FAPI001", "FAPI002", "FAPI003", "FAPI005", "FAPI006", "FAPI007", "FAPI008", "FAPI009"]

[tool.inwards.rules.thin-endpoint]
max-statements = 1

[tool.inwards.rules.ports-abstract]
modules = ["app.api"]
`);

/** A router module that every content rule and the FastAPI model read. */
const ORDERS = `import time

from fastapi import APIRouter, Depends
from sqlalchemy import Column, DateTime
from sqlalchemy.orm import Session

from app.core.db import Base, helper

router = APIRouter()


def get_db():
    try:
        yield Session()
    except Exception:
        pass


class Orders(Base):
    __tablename__ = "Orders"
    created = Column(DateTime)


@router.get("/orders")
async def list_orders(db: Session = Depends(get_db)):
    time.sleep(1)
    total = 0
    for order in db.query(Orders):
        total += 1
    return helper(total)
`;

/** The module the router imports from, which name resolution and INW013's hop read. */
const DB = `import time


class Base:
    pass


def helper(total):
    time.sleep(total)
    return total
`;

const TEXTS = new Map([
  ["app/api/orders.py", ORDERS],
  ["app/core/db.py", DB],
]);

const DISK = new Map<string, "file" | "dir">([
  ["app", "dir"],
  ["app/__init__.py", "file"],
  ["app/api", "dir"],
  ["app/api/__init__.py", "file"],
  ["app/core", "dir"],
  ["app/core/__init__.py", "file"],
  ...[...TEXTS.keys()].map((path): [string, "file"] => [path, "file"]),
]);

/**
 * Wraps the test parser so every parse is counted by the text it was given.
 *
 * @param counts - parses by text, filled in as the wrapper parses.
 * @returns a parser that parses as the test parser does.
 */
function counting(counts: Map<string, number>): Parser {
  return new Proxy(parser, {
    get(target: Parser, key: string | symbol): unknown {
      if (key === "parse") {
        return (...args: Parameters<Parser["parse"]>): ReturnType<Parser["parse"]> => {
          const [input] = args;
          const text = typeof input === "string" ? input : "";
          counts.set(text, (counts.get(text) ?? 0) + 1);
          return target.parse(...args);
        };
      }
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * Lists findings as `code path:line`, sorted.
 *
 * @param found - findings.
 * @returns one line per finding.
 */
function lines(found: readonly Diagnostic[]): string[] {
  return found.map((d) => `${d.code} ${d.file}:${d.line}`).sort();
}

describe("one parse per text across the content rules", () => {
  test("a file every content rule reads, and the module it imports, are parsed once each", () => {
    const counts = new Map<string, number>();
    const project = indexOn(DISK, TEXTS);
    const files: SourceFile[] = [...TEXTS].map(([path, text]) => file(path, text));
    const run = new ContentRun(counting(counts), project, CONFIG, files);
    let found: Diagnostic[];
    try {
      const wired = fastApiFindings(run.trees, project, files, { config: CONFIG, edit: false });
      found = [
        ...[...wired.found.values()].flat(),
        ...files.flatMap((src) => contentFindings(src, CONFIG, run)),
        ...ormProjectFindings(run.trees, files, CONFIG, run.ormModels).findings,
      ];
    } finally {
      run.dispose();
    }
    const codes = new Set(found.map((d) => d.code));
    for (const code of ["INW012", "INW013", "INW016", "FAPI007"]) {
      expect(codes).toContain(code);
    }
    expect(counts.size).toBe(2);
    expect([...counts.values()]).toEqual([1, 1]);
  });

  test("a run of both files reports what each file reports alone", async () => {
    const engine = await Engine.create(grammars(), CONFIG);
    const files = [...TEXTS].map(([path, text]) => file(path, text));
    const alone = files.flatMap((src) => engine.checkFile(src, indexOn(DISK, TEXTS)));
    const together = engine.check(files, indexOn(DISK, TEXTS), undefined, { edit: true });
    expect(lines(together.diagnostics)).toEqual(lines(alone));
  });
});

/** A router whose endpoint calls through two first-party names (#395). */
const ITEMS = `from fastapi import APIRouter

from app.core.service import items
from app.core.shim import tools

router = APIRouter()


@router.get("/items/{item_id}", summary="Item", response_model=dict)
def read_item(item_id: int) -> dict:
    tools.not_found(item_id)
    return items.load(item_id)
`;

/** Defines \`items\` itself, so \`items.load\` leads nowhere the model can follow. */
const SERVICE = `class ItemService:
    def load(self, item_id):
        return {"id": item_id}


items = ItemService()
`;

/** Re-exports a module under another name, so \`tools.not_found\` goes on through it. */
const SHIM = `from app.core import real as tools

VERSION = 1
`;

/** The function the re-export leads to, which raises a code the route doesn't declare. */
const REAL = `from fastapi import HTTPException


def not_found(item_id):
    raise HTTPException(status_code=404, detail="missing")
`;

const LOOKUPS = new Map([
  ["app/api/items.py", ITEMS],
  ["app/core/service.py", SERVICE],
  ["app/core/shim.py", SHIM],
  ["app/core/real.py", REAL],
]);

describe("lookups that skip a parse (#395)", () => {
  test("moduleNodes lists what descendantsOfType lists, once per tree", () => {
    const tree = parser.parse(ORDERS);
    if (tree === null) {
      throw new Error("no tree");
    }
    try {
      const root = tree.rootNode;
      for (const type of [
        "call",
        "assignment",
        "function_definition",
        "class_definition",
      ] as const) {
        const want = root.descendantsOfType(type).flatMap((n) => (n ? [n.startIndex] : []));
        expect(moduleNodes(root, type).map((n) => n.startIndex)).toEqual(want);
      }
      expect(moduleNodes(tree.rootNode, "call")).toBe(moduleNodes(root, "call"));
    } finally {
      tree.delete();
    }
  });

  test("the import skeleton binds the names the full parse binds", () => {
    const src = file(
      "app/api/orders.py",
      "from . import views as v\nimport os.path\n\n\ndef f():\n    from app.core.db import helper as h\n    return h\n",
    );
    const tree = parser.parse(src.text);
    if (tree === null) {
      throw new Error("no tree");
    }
    try {
      expect(skeletonNames(parser, src)).toEqual(importedNames(tree, src));
    } finally {
      tree.delete();
    }
    expect(skeletonNames(parser, file("app/x.py", "x = 1; import os\n"))).toBeNull();
  });

  test("FAPI002 follows a name an import binds and parses no module it only passes through", () => {
    const config = parseConfig(`[tool.inwards]
layers = [
  { name = "core", modules = ["app.core"] },
  { name = "api", modules = ["app.api"] },
]

[tool.inwards.rules]
extend-select = ["FAPI002"]
`);
    const disk = new Map<string, "file" | "dir">([
      ...[...DISK].filter(([path]) => !TEXTS.has(path)),
      ...[...LOOKUPS.keys()].map((path): [string, "file"] => [path, "file"]),
    ]);
    const counts = new Map<string, number>();
    const project = indexOn(disk, LOOKUPS);
    const files = [file("app/api/items.py", ITEMS)];
    const run = new ContentRun(counting(counts), project, config, files);
    let found: Diagnostic[];
    try {
      found = [
        ...fastApiFindings(run.trees, project, files, { config, edit: false }).found.values(),
      ].flat();
    } finally {
      run.dispose();
    }
    expect(found.map((d) => d.code)).toEqual(["FAPI002"]);
    expect(found[0]?.message).toContain("404");
    expect(counts.has(SERVICE)).toBe(false);
    expect([ITEMS, SHIM, REAL].map((text) => counts.get(text))).toEqual([1, 1, 1]);
  });
});
