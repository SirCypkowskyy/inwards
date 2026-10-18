/**
 * @file Test modules cost the content rules nothing (#362). A test file that
 * every content rule and the FastAPI model would read is never parsed when
 * the rules skip test modules. With `check-tests = true` it is parsed, once,
 * as any other checked file is (#387).
 */
import { describe, expect, test } from "bun:test";
import type { Parser } from "web-tree-sitter";
import { parseConfig } from "../../src/config/_parse.ts";
import { applyRules } from "../../src/config/_rule-settings.ts";
import type { Diagnostic, SourceFile } from "../../src/contracts/records.ts";
import { ContentRun, contentFindings } from "../../src/engine/content-rules.ts";
import { fastApiFindings } from "../../src/engine/fastapi.ts";
import { ormProjectFindings } from "../../src/engine/orm-naming.ts";
import { file, indexOn, parser } from "../support/helpers.ts";

const CODES = [
  "INW012",
  "INW013",
  "INW014",
  "INW016",
  "INW020",
  "FAPI001",
  "FAPI002",
  "FAPI003",
  "FAPI005",
  "FAPI006",
  "FAPI007",
  "FAPI008",
  "FAPI009",
];

/** A test module that every content rule and the FastAPI model would read. */
const TEST_APP = `import time

from fastapi import APIRouter, FastAPI
from sqlalchemy import Column, DateTime
from sqlalchemy.orm import Session

router = APIRouter()
app = FastAPI()
app.include_router(router)


def get_db():
    try:
        yield Session()
    except Exception:
        pass


class Orders:
    __tablename__ = "Orders"
    created = Column(DateTime)


@router.post("/orders")
async def create(db: Session):
    time.sleep(1)
    for order in db.query(Orders):
        print(order)
`;

const PATH = "app/tests/test_app.py";
const DISK = new Map<string, "file" | "dir">([
  ["app", "dir"],
  ["app/__init__.py", "file"],
  ["app/tests", "dir"],
  ["app/tests/__init__.py", "file"],
  [PATH, "file"],
]);

/**
 * Wraps the test parser so every parse of the test module's text is counted.
 *
 * @param seen - holds the count, filled in as the wrapper parses.
 * @param seen.count - parses of `TEST_APP` so far.
 * @returns a parser that parses as the test parser does.
 */
function counting(seen: { count: number }): Parser {
  return new Proxy(parser, {
    get(target: Parser, key: string | symbol): unknown {
      if (key === "parse") {
        return (...args: Parameters<Parser["parse"]>): ReturnType<Parser["parse"]> => {
          if (args[0] === TEST_APP) {
            seen.count += 1;
          }
          return target.parse(...args);
        };
      }
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * Runs every content rule and the FAPI rules over the test module alone, as a
 * whole-project run does.
 *
 * @param extra - options tables to add, TOML.
 * @returns how often the test module was parsed, and what the rules report.
 */
function run(extra: string): { parses: number; found: Diagnostic[] } {
  const config = parseConfig(`[tool.inwards]
layers = [{ name = "app", modules = ["app"] }]

[tool.inwards.rules]
extend-select = ${JSON.stringify(CODES)}
[tool.inwards.rules.adapter-conformance]
modules = ["app"]
${extra}`);
  const seen = { count: 0 };
  const project = indexOn(DISK, new Map([[PATH, TEST_APP]]));
  const files: SourceFile[] = [file(PATH, TEST_APP)];
  const content = new ContentRun(counting(seen), project, config, files);
  try {
    const wired = fastApiFindings(content.trees, project, files, { config, edit: false });
    const found = [
      ...[...wired.found.values()].flat(),
      ...files.flatMap((src) => contentFindings(src, config, content)),
      ...ormProjectFindings(content.trees, files, config, content.ormModels).findings,
    ];
    return { parses: seen.count, found: applyRules(found, config.rules) };
  } finally {
    content.dispose();
  }
}

describe("a test module", () => {
  test("isn't parsed by any content rule or the FastAPI model", () => {
    expect(run("")).toEqual({ parses: 0, found: [] });
  });

  test("is parsed once with check-tests = true on the rules that want it", () => {
    const tables = ["thin-endpoint", "orm-naming", "endpoint-metadata", "yield-dependency-swallows"]
      .map((name) => `[tool.inwards.rules.${name}]\ncheck-tests = true\n`)
      .join("");
    const { parses, found } = run(tables);
    expect(parses).toBe(1);
    expect(new Set(found.map((d) => d.code))).toEqual(
      new Set(["INW012", "INW016", "FAPI001", "FAPI007"]),
    );
  });
});
