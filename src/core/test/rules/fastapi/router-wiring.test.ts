/**
 * @file FAPI003 `router-wiring` (#184) on a fixture project: one app in
 * `main.py`, an app built by a factory, routers nested across files and
 * included through `from x import router as y`, a module attribute and a
 * loop over a list literal, one router nobody includes, and two routers that
 * include each other. Also the one-file findings (a router included above
 * its own routes, a router including itself), the per-edit mode, the
 * options, suppressions, and the JSON and SARIF output.
 */
import { describe, expect, test } from "bun:test";
import {
  type Diagnostic,
  Engine,
  parseConfig,
  render,
  type SourceFile,
} from "../../../src/index.ts";
import { file, grammars, indexOn } from "../../support/helpers.ts";

const MAIN = `from fastapi import FastAPI

from app.api import v1
from app.cycle import a
from app.orders.router import router as orders_router
from app.users import router as users

app = FastAPI(title="Shop")
app.include_router(orders_router)
app.include_router(users.router, prefix="/users")
app.include_router(v1.router, prefix="/v1")
app.include_router(a.router)
`;

const V1 = `from fastapi import APIRouter

from app.items import router as items
from app.tags.router import router as tags_router

router = APIRouter()
for child in [items.router, tags_router]:
    router.include_router(child)
`;

const FACTORY = `from fastapi import FastAPI

from app.admin.router import router


def create_app() -> FastAPI:
    admin = FastAPI()
    admin.include_router(router)
    return admin
`;

const CYCLE_A = `from fastapi import APIRouter

from app.cycle import b

router = APIRouter()


@router.get("/a")
async def read_a(): ...


router.include_router(b.router)
`;

const CYCLE_B = `from fastapi import APIRouter

from app.cycle import a

router = APIRouter()


@router.get("/b")
async def read_b(): ...


router.include_router(a.router)
`;

/**
 * Writes a router module with one path operation.
 *
 * @param path - the operation's path.
 * @returns the module's source.
 */
function routes(path: string): string {
  return `from fastapi import APIRouter\n\nrouter = APIRouter(prefix="${path}")\n\n\n@router.get("/")\nasync def index(): ...\n`;
}

const TEXTS: ReadonlyMap<string, string> = new Map([
  ["app/__init__.py", ""],
  ["app/main.py", MAIN],
  ["app/factory.py", FACTORY],
  ["app/api/__init__.py", ""],
  ["app/api/v1.py", V1],
  ["app/orders/__init__.py", ""],
  ["app/orders/router.py", routes("/orders")],
  ["app/users/__init__.py", ""],
  ["app/users/router.py", routes("/users")],
  ["app/items/__init__.py", ""],
  ["app/items/router.py", routes("/items")],
  ["app/tags/__init__.py", ""],
  ["app/tags/router.py", routes("/tags")],
  ["app/admin/__init__.py", ""],
  ["app/admin/router.py", routes("/admin")],
  ["app/invoices/__init__.py", ""],
  ["app/invoices/router.py", routes("/invoices")],
  ["app/cycle/__init__.py", ""],
  ["app/cycle/a.py", CYCLE_A],
  ["app/cycle/b.py", CYCLE_B],
  ["app/plain.py", "X = 1\n"],
]);

/**
 * Lists the directories that hold the given files.
 *
 * @param paths - root-relative file paths.
 * @returns every ancestor directory.
 */
function dirsOf(paths: Iterable<string>): string[] {
  return [...paths].flatMap((path) =>
    path
      .split("/")
      .slice(0, -1)
      .map((_, i, parts) => parts.slice(0, i + 1).join("/")),
  );
}

/**
 * Checks a project with FAPI003 on.
 *
 * @param opts - the project and how to check it.
 * @param opts.texts - the files, by path; the fixture by default.
 * @param opts.options - the body of `[tool.inwards.rules.router-wiring]`, TOML.
 * @param opts.only - check only these paths, as the Stop gate does; every file by default.
 * @param opts.edit - true for a per-edit check.
 * @param opts.rules - the body of `[tool.inwards.rules]`; FAPI003 on by default.
 * @returns the diagnostics and the suppressed findings.
 */
async function run({
  texts = TEXTS,
  options = "",
  only,
  edit = false,
  rules = 'extend-select = ["FAPI003"]',
}: {
  texts?: ReadonlyMap<string, string>;
  options?: string;
  only?: readonly string[];
  edit?: boolean;
  rules?: string;
}): Promise<{ diagnostics: Diagnostic[]; suppressed: string[] }> {
  const table = options === "" ? "" : `\n[tool.inwards.rules.router-wiring]\n${options}\n`;
  const config = parseConfig(
    `[tool.inwards]\nlayers = [{ name = "app", modules = ["app"] }]\n\n[tool.inwards.rules]\n${rules}\n${table}`,
  );
  const engine = await Engine.create(grammars(), config);
  const disk = new Map<string, "file" | "dir">([
    ...dirsOf(texts.keys()).map((d): [string, "dir"] => [d, "dir"]),
    ...[...texts.keys()].map((p): [string, "file"] => [p, "file"]),
  ]);
  const files: SourceFile[] = [...texts]
    .filter(([path]) => only === undefined || only.includes(path))
    .map(([path, text]) => file(path, text));
  const whole = only === undefined;
  const checked = engine.check(files, indexOn(disk, texts), undefined, { whole, edit });
  return {
    diagnostics: checked.diagnostics,
    suppressed: checked.suppressed.map((s) => `${s.diagnostic.file}:${s.diagnostic.line}`),
  };
}

/**
 * Lists FAPI003 findings as `file:line severity`, sorted.
 *
 * @param diagnostics - a check's findings.
 * @returns one entry per FAPI003 finding.
 */
function where(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics
    .filter((d) => d.code === "FAPI003")
    .map((d) => `${d.file}:${d.line} ${d.severity}`)
    .sort();
}

describe("FAPI003 on the fixture project", () => {
  test("is off by default", async () => {
    expect(where((await run({ rules: "" })).diagnostics)).toEqual([]);
  });

  test("reports the one router no app includes, on its APIRouter line, and the cycle", async () => {
    const { diagnostics } = await run({});
    expect(where(diagnostics)).toEqual([
      "app/cycle/b.py:12 error",
      "app/invoices/router.py:3 error",
    ]);
    const unmounted = diagnostics.find((d) => d.file === "app/invoices/router.py");
    expect(unmounted?.message).toBe(
      "APIRouter `app.invoices.router.router` has path operations, but no app includes it, directly or through another router, so its routes don't exist at runtime.",
    );
    expect(unmounted?.fix.steps[0]).toBe(
      "In app/main.py, which builds the app `app`, where its sibling routers are included: import `app.invoices.router.router` and add `app.include_router(...)` for it.",
    );
  });

  test("names both calls of the a -> b -> a cycle", async () => {
    const cycle = (await run({})).diagnostics.find((d) => d.file === "app/cycle/b.py");
    expect(cycle?.message).toBe(
      "Routers include each other in a cycle: app.cycle.a.router -> app.cycle.b.router -> app.cycle.a.router. The routes an app ends up with then depend on the order the include_router calls run in.",
    );
    expect(cycle?.fix.steps[0]).toBe(
      "The calls that make the cycle: `app.cycle.a.router` includes `app.cycle.b.router` at app/cycle/a.py:12; `app.cycle.b.router` includes `app.cycle.a.router` at app/cycle/b.py:12.",
    );
  });

  test("a partial run reports only in the files it checks, against the whole graph", async () => {
    const { diagnostics } = await run({ only: ["app/invoices/router.py", "app/items/router.py"] });
    expect(where(diagnostics)).toEqual(["app/invoices/router.py:3 error"]);
    const other = await run({ only: ["app/cycle/a.py"] });
    expect(where(other.diagnostics)).toEqual(["app/cycle/a.py:12 error"]);
  });

  test("a per-edit check leaves unmounted routers and cycles to the Stop gate", async () => {
    expect(where((await run({ edit: true })).diagnostics)).toEqual([]);
  });
});

describe("FAPI003 options", () => {
  test("entrypoints limit the roots; a factory function counts as an app's name", async () => {
    const main = await run({ options: 'entrypoints = ["app.main:app"]' });
    expect(where(main.diagnostics)).toEqual([
      "app/admin/router.py:3 error",
      "app/cycle/b.py:12 error",
      "app/invoices/router.py:3 error",
    ]);
    const both = await run({ options: 'entrypoints = ["app.main:app", "app.factory:create_app"]' });
    expect(where(both.diagnostics)).toEqual([
      "app/cycle/b.py:12 error",
      "app/invoices/router.py:3 error",
    ]);
  });

  test("allow-unmounted exempts matching routers", async () => {
    const { diagnostics } = await run({ options: 'allow-unmounted = ["app.invoices"]' });
    expect(where(diagnostics)).toEqual(["app/cycle/b.py:12 error"]);
  });

  test("an importlib include anywhere makes unmounted routers warnings that say why, or silent", async () => {
    const texts = new Map([
      ...TEXTS,
      [
        "app/plugins.py",
        'import importlib\n\nfrom app.main import app\n\napp.include_router(importlib.import_module("app.extra").router)\n',
      ],
    ]);
    const warned = await run({ texts });
    expect(where(warned.diagnostics)).toEqual([
      "app/cycle/b.py:12 error",
      "app/invoices/router.py:3 warning",
    ]);
    expect(warned.diagnostics.find((d) => d.severity === "warning")?.message).toEndWith(
      "Inwards can't follow the include_router call at app/plugins.py:5, so that call may include it.",
    );
    const silent = await run({ texts, options: 'unresolved-includes = "silent"' });
    expect(where(silent.diagnostics)).toEqual(["app/cycle/b.py:12 error"]);
  });
});

describe("FAPI003 in one file", () => {
  const Early = `from fastapi import FastAPI, APIRouter

app = FastAPI()
router = APIRouter()
app.include_router(router)


@router.get("/late")
async def late(): ...
`;

  test("an include_router above the router's own routes is reported, in the hook too", async () => {
    const texts = new Map([
      ["app/__init__.py", ""],
      ["app/main.py", Early],
    ]);
    const runs = await Promise.all([false, true].map((edit) => run({ texts, edit })));
    for (const { diagnostics } of runs) {
      expect(where(diagnostics)).toEqual(["app/main.py:5 error"]);
      expect(diagnostics[0]?.fix.summary).toBe(
        "Move this call below the last `@router.get(...)` decorator (line 8).",
      );
    }
    expect(where((await run({ texts, options: "check-order = false" })).diagnostics)).toEqual([]);
  });

  test("an include inside an app factory runs later, so it isn't early", async () => {
    const factory = Early.replace(
      "app = FastAPI()\nrouter = APIRouter()\napp.include_router(router)\n",
      "router = APIRouter()\n\n\ndef create_app():\n    app = FastAPI()\n    app.include_router(router)\n    return app\n",
    );
    const texts = new Map([
      ["app/__init__.py", ""],
      ["app/main.py", factory],
    ]);
    expect(where((await run({ texts })).diagnostics)).toEqual([]);
  });

  test("a router that includes itself is reported in the hook", async () => {
    const text = `${routes("/x")}\nrouter.include_router(router)\n`;
    const texts = new Map([
      ["app/__init__.py", ""],
      ["app/x.py", text],
    ]);
    const { diagnostics } = await run({ texts, edit: true });
    expect(where(diagnostics)).toEqual(["app/x.py:9 error"]);
    expect(diagnostics[0]?.message).toBe(
      "`app.x.router` includes itself, so its route set depends on when this call runs.",
    );
  });
});

describe("FAPI003 suppressions", () => {
  const Reason = 'reason="mounted by the gateway"';
  const suppressed = new Map([
    ...TEXTS,
    [
      "app/invoices/router.py",
      routes("/invoices").replace(
        'router = APIRouter(prefix="/invoices")',
        `router = APIRouter(prefix="/invoices")  # inwards: ignore[FAPI003] ${Reason}`,
      ),
    ],
  ]);

  test("hide an unmounted router on its line", async () => {
    const { diagnostics, suppressed: hidden } = await run({ texts: suppressed });
    expect(where(diagnostics)).toEqual(["app/cycle/b.py:12 error"]);
    expect(hidden).toEqual(["app/invoices/router.py:3"]);
  });

  test("still count as used in a per-edit check, which doesn't report the router", async () => {
    const { diagnostics, suppressed: hidden } = await run({
      texts: suppressed,
      only: ["app/invoices/router.py"],
      edit: true,
    });
    expect(diagnostics).toEqual([]);
    expect(hidden).toEqual([]);
  });
});

describe("FAPI003 output", () => {
  test("goes into JSON and SARIF like any finding", async () => {
    const { diagnostics } = await run({ only: ["app/invoices/router.py"] });
    const report = { diagnostics, filesChecked: 1, durationMs: 0 };
    const json = JSON.parse(render(report, "json"));
    expect(json.diagnostics.map((d: Diagnostic) => [d.code, d.rule, d.line])).toEqual([
      ["FAPI003", "router-wiring", 3],
    ]);
    const [result] = JSON.parse(render(report, "sarif")).runs[0].results;
    expect([
      result.ruleId,
      result.level,
      result.locations[0].physicalLocation.region.startLine,
    ]).toEqual(["FAPI003", "error", 3]);
  });
});
