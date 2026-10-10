/**
 * @file The shared FastAPI model (#186): from a project with one app and three
 * routers across four files, it extracts the apps and routers, the path
 * operations, the `include_router` and `mount` edges and the exception
 * handlers (a snapshot of all of it). It also resolves names across files
 * through the project index, re-exports included, without importing anything.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { returnedStatusCodes } from "../../../src/rules/fastapi/handlers.ts";
import { FastApiModel, mentionsFastApi } from "../../../src/rules/fastapi/model.ts";
import type { FastApiFile } from "../../../src/rules/fastapi/records.ts";
import type { Value } from "../../../src/rules/fastapi/values.ts";
import { file, indexOn, parser } from "../../support/helpers.ts";

const MAIN = `from fastapi import Depends, FastAPI, status
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.routers import items, users
from app.routers.admin import router as admin_router, verify
from app.routers.items import OutOfStock, out_of_stock


async def not_found(request, exc):
    return JSONResponse(status_code=status.HTTP_404_NOT_FOUND, content={})


app = FastAPI(title="Shop", exception_handlers={404: not_found})
app.include_router(users.router)
app.include_router(items.router, prefix="/v1")
app.include_router(admin_router, dependencies=[Depends(verify)])
app.add_exception_handler(OutOfStock, out_of_stock)
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.exception_handler(ValueError)
async def bad_value(request, exc):
    return JSONResponse({"detail": str(exc)}, status_code=422)


@app.get("/health", include_in_schema=False)
async def health() -> dict[str, str]:
    return {"status": "ok"}
`;

const USERS = `from fastapi import APIRouter

router = APIRouter(prefix="/users", tags=["users"], responses={404: {"description": "Not found"}})


@router.get("/{user_id}", summary="Read a user")
async def read_user(user_id: int): ...


@router.post("/", status_code=201)
async def create_user(): ...
`;

const ITEMS = `import fastapi
from fastapi.responses import JSONResponse

PREFIX = "/items"
router = fastapi.APIRouter(prefix=PREFIX, tags=["items"])


class OutOfStock(Exception): ...


async def out_of_stock(request, exc):
    return JSONResponse(status_code=409, content={})


@router.api_route("/{item_id}", methods=["GET", "PUT"])
async def item(item_id: int): ...


@router.delete(f"{PREFIX}/{{item_id}}", **extra)
async def remove(item_id: int): ...
`;

const ADMIN = `from fastapi import APIRouter, Depends

COMMON = {401: {"description": "Not signed in"}}


async def verify(): ...


router = APIRouter(prefix="/admin", dependencies=[Depends(verify)])


@router.get("/stats", responses={**COMMON, 403: {"description": "Forbidden"}})
async def stats(): ...
`;

const TEXTS = new Map([
  ["app/__init__.py", ""],
  ["app/main.py", MAIN],
  ["app/routers/__init__.py", "from .users import router as users_router\n"],
  ["app/routers/users.py", USERS],
  ["app/routers/items.py", ITEMS],
  ["app/routers/admin.py", ADMIN],
  ["app/plain.py", "import requests\n\nsession = requests.Session()\n"],
]);
const DISK = new Map<string, "file" | "dir">([
  ["app", "dir"],
  ["app/routers", "dir"],
  ...[...TEXTS.keys()].map((path) => [path, "file"] as const),
]);

const model = new FastApiModel(parser, indexOn(DISK, TEXTS));

afterAll(() => {
  model.dispose();
});

/**
 * Spells a value compactly for the snapshot.
 *
 * @param value - a value the model read.
 * @returns Python-like text, with `?` for an unknown value.
 */
function show(value: Value | null): string {
  switch (value?.kind) {
    case undefined:
      return "-";
    case "str":
      return JSON.stringify(value.value);
    case "int":
    case "bool":
      return String(value.value);
    case "none":
      return "None";
    case "list":
      return `[${value.items.map(show).join(", ")}]`;
    case "dict":
      return `{${[
        ...value.entries.map(([k, v]) => `${show(k)}: ${show(v)}`),
        ...value.spread.map((s) => `**${show(s)}`),
      ].join(", ")}}`;
    case "name":
      return value.name;
    case "call": {
      const keywords = [...value.keywords].map(([k, v]) => `${k}=${show(v)}`);
      return `${value.callee ?? "?"}(${[...value.args.map(show), ...keywords].join(", ")})`;
    }
    default:
      return "?";
  }
}

/**
 * Spells a call's keyword arguments for the snapshot.
 *
 * @param keywords - the keywords the model read.
 * @param splat - whether a splat may hide more.
 * @returns `k=v` pairs, and `**?` for a splat.
 */
function args(keywords: ReadonlyMap<string, { value: Value }>, splat: boolean): string {
  const pairs = [...keywords].map(([k, { value }]) => `${k}=${show(value)}`);
  return [...pairs, ...(splat ? ["**?"] : [])].join(", ");
}

/**
 * Gives a node's 1-based line.
 *
 * @param node - a syntax node.
 * @param node.startPosition - where it starts, 0-based.
 * @param node.startPosition.row - its first row.
 * @returns the line an editor shows.
 */
function line(node: { startPosition: { row: number } }): number {
  return node.startPosition.row + 1;
}

/**
 * Summarises one file's model, a line per record with its source line.
 *
 * @param m - the file's model.
 * @returns the lines.
 */
function summary(m: FastApiFile | null): string[] {
  if (m === null) {
    return ["not a FastAPI file"];
  }
  return [
    ...m.objects.map(
      (o) =>
        `${line(o.node)} ${o.kind} ${o.name}${o.topLevel ? "" : " (nested)"}: ${args(o.keywords, o.splat)}`,
    ),
    ...m.operations.map(
      (op) =>
        `${line(op.node)} ${op.receiver}.${op.decorator} ${show(op.path)} ${op.methods === "unknown" ? "?" : op.methods.join("|")} -> ${op.name} (def on ${line(op.function)}): ${args(op.keywords, op.splat)}`,
    ),
    ...m.wiring.map(
      (w) =>
        `${line(w.node)} ${w.kind} ${w.receiver} <- ${w.target ?? "?"} at ${show(w.path)}: ${args(w.keywords, w.splat)}`,
    ),
    ...m.handlers.map(
      (h) =>
        `${line(h.node)} handler on ${h.app} via ${h.via}: ${show(h.exception)} -> ${h.handler ?? "?"} (${h.function ? `def on ${line(h.function)}` : "elsewhere"}) status ${h.statusCodes.join(",") || "-"}`,
    ),
  ];
}

describe("the FastAPI model", () => {
  test("reads the app, three routers, their operations, the wiring and the handlers", () => {
    const files = ["app.main", "app.routers.users", "app.routers.items", "app.routers.admin"];
    expect(files.map((m) => [m, summary(model.moduleModel(m))])).toMatchInlineSnapshot(`
      [
        [
          "app.main",
          [
            "14 app app.main.app: title="Shop", exception_handlers={404: app.main.not_found}",
            "27 app.main.app.get "/health" get -> health (def on 28): include_in_schema=false",
            "15 include app.main.app <- app.routers.users.router at -: ",
            "16 include app.main.app <- app.routers.items.router at "/v1": prefix="/v1"",
            "17 include app.main.app <- app.routers.admin.router at -: dependencies=[fastapi.Depends(app.routers.admin.verify)]",
            "19 mount app.main.app <- ? at "/static": name="static"",
            "14 handler on app.main.app via exception_handlers: 404 -> app.main.not_found (def on 10) status 404",
            "18 handler on app.main.app via add_exception_handler: app.routers.items.OutOfStock -> app.routers.items.out_of_stock (elsewhere) status -",
            "22 handler on app.main.app via decorator: app.main.ValueError -> app.main.bad_value (def on 23) status 422",
          ],
        ],
        [
          "app.routers.users",
          [
            "3 router app.routers.users.router: prefix="/users", tags=["users"], responses={404: {"description": "Not found"}}",
            "6 app.routers.users.router.get "/{user_id}" get -> read_user (def on 7): summary="Read a user"",
            "10 app.routers.users.router.post "/" post -> create_user (def on 11): status_code=201",
          ],
        ],
        [
          "app.routers.items",
          [
            "5 router app.routers.items.router: prefix=app.routers.items.PREFIX, tags=["items"]",
            "15 app.routers.items.router.api_route "/{item_id}" get|put -> item (def on 16): methods=["GET", "PUT"]",
            "19 app.routers.items.router.delete ? delete -> remove (def on 20): **?",
          ],
        ],
        [
          "app.routers.admin",
          [
            "9 router app.routers.admin.router: prefix="/admin", dependencies=[fastapi.Depends(app.routers.admin.verify)]",
            "12 app.routers.admin.router.get "/stats" get -> stats (def on 13): responses={403: {"description": "Forbidden"}, **app.routers.admin.COMMON}",
          ],
        ],
      ]
    `);
  });

  test("skips a file that doesn't mention FastAPI, and a local session's mount", () => {
    expect(mentionsFastApi(TEXTS.get("app/plain.py") ?? "")).toBe(false);
    expect(model.moduleModel("app.plain")).toBeNull();
    const own = model.fileModel(
      file(
        "app/client.py",
        "import fastapi\nimport requests\n\ns = requests.Session()\ns.mount('https://', adapter)\n",
      ),
    );
    expect(own?.wiring).toEqual([]);
  });

  test("finds an app built in a factory function", () => {
    const factory = model.fileModel(
      file(
        "app/factory.py",
        "from fastapi import FastAPI\n\ndef create_app():\n    app = FastAPI()\n    app.include_router(r)\n    return app\n",
      ),
    );
    expect(summary(factory)).toEqual([
      "4 app app.factory.app (nested): ",
      "5 include app.factory.app <- app.factory.r at -: ",
    ]);
  });
});

describe("handler registrations the model unrolls or follows (#242)", () => {
  test("a loop over a list literal registers each item", () => {
    const loop = model.fileModel(
      file(
        "app/looped.py",
        "from fastapi import FastAPI\n\napp = FastAPI()\n\nasync def h(request, exc):\n    return JSONResponse(status_code=409, content={})\n\nfor exc in [KeyError, OutOfStock]:\n    app.add_exception_handler(exc, h)\nfor exc in ERRORS:\n    app.add_exception_handler(exc, h)\n",
      ),
    );
    expect(summary(loop)).toEqual([
      "3 app app.looped.app: ",
      "9 handler on app.looped.app via add_exception_handler: app.looped.KeyError -> app.looped.h (def on 5) status 409",
      "9 handler on app.looped.app via add_exception_handler: app.looped.OutOfStock -> app.looped.h (def on 5) status 409",
      "11 handler on app.looped.app via add_exception_handler: app.looped.exc -> app.looped.h (def on 5) status 409",
    ]);
  });

  test("exception_handlers splatted from a module dict or a factory's caller", () => {
    const splat = model.fileModel(
      file(
        "app/splat.py",
        [
          "from fastapi import FastAPI",
          "",
          'KWARGS = {"exception_handlers": {Gone: h}}',
          'app = FastAPI(title="Shop", **KWARGS)',
          "",
          "def create(kwargs=None):",
          "    kwargs = kwargs or {}",
          "    api = FastAPI(**kwargs)",
          "    return api",
          "",
          'one = create(kwargs={"exception_handlers": {Exception: h, Gone: h}})',
          "two = create()",
          'other = FastAPI(**{"debug": True, "exception_handlers": TABLE})',
          "TABLE = {Gone: h}",
          "lost = FastAPI(**settings())",
          "",
        ].join("\n"),
      ),
    );
    expect(summary(splat)).toEqual([
      '4 app app.splat.app: title="Shop"',
      "8 app app.splat.api (nested): ",
      "13 app app.splat.other: ",
      "15 app app.splat.lost: **?",
      "3 handler on app.splat.app via exception_handlers: app.splat.Gone -> app.splat.h (elsewhere) status -",
      "11 handler on app.splat.api via exception_handlers: app.splat.Exception -> app.splat.h (elsewhere) status -",
      "11 handler on app.splat.api via exception_handlers: app.splat.Gone -> app.splat.h (elsewhere) status -",
      "14 handler on app.splat.other via exception_handlers: app.splat.Gone -> app.splat.h (elsewhere) status -",
      "15 handler on app.splat.lost via exception_handlers: ? -> ? (elsewhere) status -",
    ]);
  });

  test("a mutated dict, or a factory no caller in the file reaches, is unknown", () => {
    const mutated = model.fileModel(
      file(
        "app/mutated.py",
        'from fastapi import FastAPI\n\nKW = {"exception_handlers": {}}\nKW.update(extra)\napp = FastAPI(**KW)\n\ndef build(kw):\n    return FastAPI(**kw)\n\ndef make(kw):\n    api = FastAPI(**kw)\n',
      ),
    );
    expect(summary(mutated)).toEqual([
      "5 app app.mutated.app: **?",
      "11 app app.mutated.api (nested): **?",
      "5 handler on app.mutated.app via exception_handlers: ? -> ? (elsewhere) status -",
      "11 handler on app.mutated.api via exception_handlers: ? -> ? (elsewhere) status -",
    ]);
  });
});

describe("name resolution across files", () => {
  test("resolves every inclusion in main to its router, through the project index", () => {
    const targets = model.moduleModel("app.main")?.wiring.map((w) => w.target ?? "") ?? [];
    const resolved = targets.map((t) => {
      const d = model.resolve(t);
      return d?.kind === "object" ? `${d.object.kind} ${d.object.name} in ${d.file.path}` : null;
    });
    expect(resolved).toEqual([
      "router app.routers.users.router in app/routers/users.py",
      "router app.routers.items.router in app/routers/items.py",
      "router app.routers.admin.router in app/routers/admin.py",
      null, // mount(StaticFiles(...)): not a name
    ]);
  });

  test("follows a re-export in a package's __init__.py", () => {
    const d = model.resolve("app.routers.users_router");
    expect(d?.kind === "object" ? d.object.name : null).toBe("app.routers.users.router");
  });

  test("resolves a handler registered in another file, and reads its status codes", () => {
    const [, added] = model.moduleModel("app.main")?.handlers ?? [];
    const d = added?.handler ? model.resolve(added.handler) : null;
    expect(d?.kind === "function" ? [d.file.path, returnedStatusCodes(d.node)] : null).toEqual([
      "app/routers/items.py",
      [409],
    ]);
  });

  test("returns null for a third-party name, a module, or a name no file defines", () => {
    expect(model.resolve("fastapi.FastAPI")).toBeNull();
    expect(model.resolve("app.routers.users")).toBeNull();
    expect(model.resolve("app.routers.users.missing")).toBeNull();
  });
});
