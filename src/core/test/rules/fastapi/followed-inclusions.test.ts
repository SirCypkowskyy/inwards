/**
 * @file Inclusions the graph follows through one hop of first-party code
 * (#391): `include_router(<parameter>)` and `<parameter>.include_router(...)`
 * inside a module-level function, resolved through the arguments each
 * project call passes, and `include_router(make_router())`, which includes
 * the router the factory returns. Polar wires its API router through
 * `add_versioned_routers(app, api_router)` and its OAuth routers through
 * factories; fastapi-clean-example wires every router through factories.
 * Once followed, FAPI002 and FAPI003 judge those routers instead of staying quiet.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { WiringGraph } from "../../../src/rules/fastapi/graph.ts";
import { FastApiModel } from "../../../src/rules/fastapi/model.ts";
import type { FastApiFile } from "../../../src/rules/fastapi/records.ts";
import { ModuleTrees } from "../../../src/rules/shared/module-trees.ts";
import { indexOn, parser } from "../../support/helpers.ts";
import { ERRORS, reported } from "./fixture.ts";

/** What each test's model and trees hold, freed after the file's tests. */
const opened: { model: FastApiModel; trees: ModuleTrees }[] = [];

afterAll(() => {
  for (const { model, trees } of opened) {
    model.dispose();
    trees.dispose();
  }
});

/**
 * Builds the wiring graph of an in-memory project.
 *
 * @param texts - file texts by path; every directory above them is added.
 * @returns the graph, with its model kept alive until the tests end.
 */
function graphOf(texts: Readonly<Record<string, string>>): WiringGraph {
  const disk = new Map<string, "file" | "dir">();
  for (const path of Object.keys(texts)) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i += 1) {
      disk.set(parts.slice(0, i).join("/"), "dir");
    }
    disk.set(path, "file");
  }
  const index = indexOn(disk, new Map(Object.entries(texts)));
  const trees = new ModuleTrees(parser, index);
  const model = new FastApiModel(trees, index);
  opened.push({ model, trees });
  const files = [...index.modules].flatMap((m): FastApiFile[] => {
    const found = model.moduleModel(m);
    return found === null ? [] : [found];
  });
  return WiringGraph.build(model, files, index.ownerOf);
}

/**
 * Spells a graph's include edges and its unresolved inclusions.
 *
 * @param graph - the graph built from a test project.
 * @returns `from -> to` per edge, and `? path:line` per inclusion it can't follow.
 */
function wiring(graph: WiringGraph): string[] {
  return [
    ...graph.edges.map((e) => `${e.from ?? "?"} -> ${e.to}`),
    ...graph.unresolved.map((u) => `? ${u.file.path}:${u.wiring.node.startPosition.row + 1}`),
  ];
}

const API = `from fastapi import APIRouter

from app import orders

router = APIRouter(prefix="/api")
router.include_router(orders.router)
`;

const ORDERS = `from fastapi import APIRouter

router = APIRouter(prefix="/orders")


@router.get("/", summary="List", response_model=list[int])
async def list_orders(): ...
`;

const WIRE = `from fastapi import FastAPI


def wire(app: FastAPI, api_router) -> None:
    app.include_router(api_router)
`;

/**
 * Writes an app module that builds the app in a factory and wires it through `wire`.
 *
 * @param call - the call that wires it, inside `create_app`.
 * @returns the module.
 */
function main(call: string): string {
  return `from fastapi import FastAPI

from app import api
from app.wiring import wire


def create_app() -> FastAPI:
    app = FastAPI()
    ${call}
    return app
`;
}

/** The project of the parameter tests, with `app/main.py` to fill in. */
const BASE: Readonly<Record<string, string>> = {
  "app/__init__.py": "",
  "app/api.py": API,
  "app/orders.py": ORDERS,
  "app/wiring.py": WIRE,
};

describe("an inclusion through a function's parameters (#391)", () => {
  test("follows the receiver and the target to what each call passes", () => {
    const graph = graphOf({ ...BASE, "app/main.py": main("wire(app, api.router)") });
    expect(wiring(graph)).toEqual([
      "app.api.router -> app.orders.router",
      "app.main.app -> app.api.router",
    ]);
  });

  test("reads keyword arguments and keeps each call's pair apart", () => {
    const two = `from fastapi import FastAPI

from app import api, orders
from app.wiring import wire

public = FastAPI()
admin = FastAPI()
wire(api_router=api.router, app=public)
wire(admin, orders.router)
`;
    expect(wiring(graphOf({ ...BASE, "app/main.py": two }))).toEqual([
      "app.api.router -> app.orders.router",
      "app.main.public -> app.api.router",
      "app.main.admin -> app.orders.router",
    ]);
  });

  test("a call in the function's own module counts", () => {
    const own = `${WIRE}

from app import api

app = FastAPI()
wire(app, api.router)
`;
    expect(wiring(graphOf({ ...BASE, "app/wiring.py": own }))).toEqual([
      "app.api.router -> app.orders.router",
      "app.wiring.app -> app.api.router",
    ]);
  });

  test("stays unknown when a call can't be read or the function is used another way", () => {
    const unknown = [
      // A splat may pass anything.
      main("wire(*parts)"),
      // The router comes from a call, not a name.
      main("wire(app, api.build())"),
      // Passed as a value: it may be called anywhere.
      main("hooks = [wire]"),
      // Imported under another name, whose calls don't spell `wire`.
      main("wire(app, api.router)").replace(
        "from app.wiring import wire",
        "from app.wiring import wire\nfrom app.wiring import wire as hook",
      ),
    ];
    for (const text of unknown) {
      const graph = graphOf({ ...BASE, "app/main.py": text });
      expect(wiring(graph)).toContain("? app/wiring.py:5");
    }
    // No call at all.
    expect(wiring(graphOf(BASE))).toEqual([
      "app.api.router -> app.orders.router",
      "? app/wiring.py:5",
    ]);
  });

  test("a parameter rebound in the body isn't followed", () => {
    const rebound = WIRE.replace(
      "    app.include_router(api_router)",
      "    api_router = pick()\n    app.include_router(api_router)",
    );
    const graph = graphOf({
      ...BASE,
      "app/wiring.py": rebound,
      "app/main.py": main("wire(app, api.router)"),
    });
    expect(wiring(graph)).toEqual(["app.api.router -> app.orders.router", "? app/wiring.py:6"]);
  });

  test("a mount on a parameter is followed too", () => {
    const mount = `from fastapi import FastAPI


def attach(app: FastAPI, admin) -> None:
    app.mount("/admin", admin)
`;
    const caller = `from fastapi import FastAPI

from app.mounting import attach

app = FastAPI()
admin = FastAPI()
attach(app, admin)
`;
    const graph = graphOf({
      "app/__init__.py": "",
      "app/mounting.py": mount,
      "app/main.py": caller,
    });
    expect(graph.edges.map((e) => `${e.kind} ${e.from} -> ${e.to}`)).toEqual([
      "mount app.main.app -> app.main.admin",
    ]);
  });
});

describe("an inclusion of a router factory's result (#391)", () => {
  test("includes the router the factory returns", () => {
    const factory = `from fastapi import APIRouter


def make_router(name: str) -> APIRouter:
    router = APIRouter(prefix=f"/{name}")

    @router.get("/login", summary="Log in", response_model=int)
    async def login(): ...

    return router
`;
    const api = `from fastapi import APIRouter

from app.factory import make_router

router = APIRouter()
router.include_router(make_router("github"))
`;
    const graph = graphOf({ "app/__init__.py": "", "app/factory.py": factory, "app/api.py": api });
    expect(wiring(graph)).toEqual(["app.api.router -> app.factory.router"]);
    expect(graph.nodes.get("app.factory.router")?.operations.map((op) => op.name)).toEqual([
      "login",
    ]);
  });

  test("stays unknown when the factory returns no router it builds", () => {
    const factory = "def make_router():\n    return build()\n";
    const api = `from fastapi import APIRouter

from app.factory import make_router

router = APIRouter()
router.include_router(make_router())
`;
    const graph = graphOf({ "app/__init__.py": "", "app/factory.py": factory, "app/api.py": api });
    expect(wiring(graph)).toEqual(["? app/api.py:6"]);
  });
});

describe("the rules judge a followed inclusion (#391)", () => {
  /** A router module whose route raises an error the app maps to 409. */
  const raising = `from fastapi import APIRouter

from app.errors import OutOfStock

router = APIRouter()


@router.post("/orders", status_code=201, summary="Create", response_model=int)
async def create_order(id: int):
    raise OutOfStock()
`;
  const app = `from fastapi import FastAPI
from fastapi.responses import JSONResponse

from app import orders
from app.errors import OutOfStock
from app.wiring import wire


def create_app() -> FastAPI:
    app = FastAPI()
    app.add_exception_handler(OutOfStock, out_of_stock)
    wire(app, orders.router)
    return app


async def out_of_stock(request, exc):
    return JSONResponse(status_code=409, content={})
`;
  const files = {
    "app/__init__.py": "",
    "app/errors.py": `from fastapi import HTTPException\n\n${ERRORS}`,
    "app/orders.py": raising,
    "app/wiring.py": WIRE,
    "app/main.py": app,
  };

  test("FAPI002 reads the handlers of the app a parameter leads to", async () => {
    const found = await reported(files, "FAPI002");
    expect(found).toHaveLength(1);
    expect(found[0]).toStartWith("app/orders.py:8 ");
    expect(found[0]).toContain("409");
  });

  test("FAPI003 counts a router included through a parameter or a factory as mounted", async () => {
    const extra = `from fastapi import APIRouter

router = APIRouter()


@router.get("/extra")
async def extra(): ...
`;
    // Nothing includes app/extra.py's router: with every inclusion followed, it is an error.
    const found = await reported({ ...files, "app/extra.py": extra }, "FAPI003");
    expect(found).toEqual([
      "app/extra.py:3 APIRouter `app.extra.router` has path operations, but no app includes it, directly or through another router, so its routes don't exist at runtime.",
    ]);
  });
});

describe("an app that serves its own schema (#391)", () => {
  /** A route FAPI001 reports: no summary, docstring or response model. */
  const bare = `from fastapi import APIRouter

router = APIRouter()


@router.get("/orders")
async def list_orders(): ...
`;

  /**
   * Writes Polar's wiring: an app built with `openapi_url=None` that a function adds the routers and a schema route to.
   *
   * @param schemaRoute - the line that adds the schema route, inside `wire`.
   * @returns the module.
   */
  function wired(schemaRoute: string): string {
    return `from fastapi import FastAPI

from app import orders


def wire(app: FastAPI, api_router, version: str) -> None:
    app.include_router(api_router)
    ${schemaRoute}


def create_app() -> FastAPI:
    app = FastAPI(openapi_url=None)
    wire(app, orders.router, "2025-01-01")
    return app
`;
  }

  const base = { "app/__init__.py": "", "app/orders.py": bare };

  test("openapi_url=None hides nothing when the app adds a route that serves openapi.json", async () => {
    const own = wired(
      'app.add_api_route(f"/{version}/openapi.json", schema, include_in_schema=False)',
    );
    expect(await reported({ ...base, "app/main.py": own }, "FAPI001")).toHaveLength(1);
  });

  test("openapi_url=None still hides the routes of an app without such a route", async () => {
    const none = wired('app.add_api_route("/ping", ping)');
    expect(await reported({ ...base, "app/main.py": none }, "FAPI001")).toEqual([]);
  });
});
