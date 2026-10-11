/**
 * @file One parse per text per run across the content rules (#387): INW012,
 * INW013, INW014, INW016, FAPI007 and the FastAPI model all read a checked
 * file's tree from the run's `ModuleTrees`, so a file every one of them
 * reads is parsed once, and a module a hop or a name resolution reads
 * shares the tree of the checked file with the same text. The parser is
 * wrapped to count its parses; the findings are compared with a check of
 * each file alone, so sharing changes nothing a rule reports.
 */
import { describe, expect, test } from "bun:test";
import type { Parser } from "web-tree-sitter";
import { parseConfig } from "../src/config/parse.ts";
import type { Diagnostic, SourceFile } from "../src/contracts/records.ts";
import { ContentRun, contentFindings } from "../src/engine/content-rules.ts";
import { fastApiFindings } from "../src/engine/fastapi.ts";
import { ormConventionFindings } from "../src/engine/orm-naming.ts";
import { Engine } from "../src/index.ts";
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
        ...ormConventionFindings(run.trees, files, CONFIG),
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
