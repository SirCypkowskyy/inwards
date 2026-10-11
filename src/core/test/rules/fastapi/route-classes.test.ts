/**
 * @file Route classes that change what FastAPI does with a route (#392): a
 * first-party `APIRoute` subclass whose `__init__` sets
 * `self.include_in_schema` from the route's tags (Polar's
 * `IncludedInSchemaAPIRoute`), which FAPI001 and FAPI002 read to skip the
 * routes the schema leaves out, and one that overrides `matches` (Polar's
 * `VersionedAPIRoute`), which picks a route by more than method and path, so
 * FAPI005 doesn't read the order of its routes. Each case builds a small
 * project in memory and lists the functions a rule reports.
 */
import { describe, expect, test } from "bun:test";
import { checkProject } from "./fixture.ts";

/** Tags as Polar spells them: a `StrEnum` whose members are strings. */
const TAGS = `from enum import StrEnum


class Tag(StrEnum):
    public = "public"
    private = "private"
`;

/** A route class that keeps private routes out of the production schema, as Polar's does. */
const SCHEMA_ROUTE = `from fastapi.routing import APIRoute

from app.settings import is_development
from app.tags import Tag


class SchemaRoute(APIRoute):
    def __init__(self, path, endpoint, **kwargs):
        super().__init__(path, endpoint, **kwargs)
        tags = self.tags
        if self.include_in_schema:
            if Tag.private in tags:
                self.include_in_schema = is_development()
            elif Tag.public in tags:
                self.include_in_schema = True
            else:
                self.include_in_schema = False
`;

/** A route class that picks a route by API version as well as method and path. */
const VERSIONED_ROUTE = `from fastapi.routing import APIRoute


class VersionedRoute(APIRoute):
    def matches(self, scope):
        match, child = super().matches(scope)
        return match, child
`;

/** A route class that only wraps the handler: it changes neither the schema nor matching. */
const TRANSACTIONAL_ROUTE = `from fastapi.routing import APIRoute


class TransactionalRoute(APIRoute):
    def get_route_handler(self):
        return super().get_route_handler()
`;

/** A router class built at run time around a route class, as Polar's `get_api_router_class`. */
const KIT = `from fastapi import APIRouter as _APIRouter


def get_router_class(route_class):
    class _Router(_APIRouter):
        def __init__(self, *args, **kwargs):
            kwargs["route_class"] = route_class
            super().__init__(*args, **kwargs)

    return _Router
`;

/** The name of a route's function, found below its decorator. */
const FUNCTION = /async def (?<name>\w+)/u;

const MAIN = `from fastapi import FastAPI

from app import orders

app = FastAPI()
app.include_router(orders.router)
`;

/**
 * Writes the routes module: one route per tag set, each lacking every piece of metadata FAPI001 asks for.
 *
 * @param head - the lines that import and build `router`.
 * @returns the module; the public route's decorator is on the line after `head`'s last plus 3.
 */
function orders(head: string): string {
  return `from app.tags import Tag
${head}


@router.get("/public", tags=[Tag.public])
async def public_route(): ...


@router.get("/private", tags=[Tag.private])
async def private_route(): ...


@router.get("/untagged")
async def untagged_route(): ...
`;
}

/**
 * Checks a project with one rule on.
 *
 * @param code - the rule's code.
 * @param files - the files besides `app/__init__.py`, the tags, the route classes and the app.
 * @returns the names of the functions the rule reports, in file order.
 */
async function reportedRoutes(
  code: string,
  files: Readonly<Record<string, string>>,
): Promise<string[]> {
  const all = {
    "app/__init__.py": "",
    "app/settings.py": "def is_development() -> bool: ...\n",
    "app/tags.py": TAGS,
    "app/schema_route.py": SCHEMA_ROUTE,
    "app/versioned.py": VERSIONED_ROUTE,
    "app/transactional.py": TRANSACTIONAL_ROUTE,
    "app/kit.py": KIT,
    "app/main.py": MAIN,
    ...files,
  };
  const found = await checkProject(all, `[tool.inwards.rules]\nextend-select = ["${code}"]`);
  return found
    .filter((d) => d.code === code)
    .map((d) => {
      const text = new Map(Object.entries(all)).get(d.file) ?? "";
      const lines = text
        .split("\n")
        .slice(d.line - 1, d.line + 2)
        .join("\n");
      return FUNCTION.exec(lines)?.groups?.["name"] ?? `${d.file}:${d.line}`;
    });
}

describe("a route class that sets include_in_schema from tags (#392)", () => {
  test("FAPI001 reports only the routes the class keeps in the schema", async () => {
    const viaKeyword = `from fastapi import APIRouter

from app.schema_route import SchemaRoute

router = APIRouter(route_class=SchemaRoute)`;
    expect(await reportedRoutes("FAPI001", { "app/orders.py": orders(viaKeyword) })).toEqual([
      "public_route",
    ]);
  });

  test("the route class of a router class built at run time counts too", async () => {
    const routing = `from app.kit import get_router_class
from app.schema_route import SchemaRoute

APIRouter = get_router_class(SchemaRoute)
`;
    const viaClass = `from app.routing import APIRouter

router = APIRouter()`;
    const files = { "app/routing.py": routing, "app/orders.py": orders(viaClass) };
    expect(await reportedRoutes("FAPI001", files)).toEqual(["public_route"]);
  });

  test("tags from the router and from include_router count", async () => {
    const tagged = `from fastapi import APIRouter

from app.schema_route import SchemaRoute

router = APIRouter(route_class=SchemaRoute, tags=[Tag.public])`;
    // Every route gets the router's public tag; the private one is still checked first.
    expect(await reportedRoutes("FAPI001", { "app/orders.py": orders(tagged) })).toEqual([
      "public_route",
      "untagged_route",
    ]);
    const plain = `from fastapi import APIRouter

from app.schema_route import SchemaRoute

router = APIRouter(route_class=SchemaRoute)`;
    const main = MAIN.replace(
      "app.include_router(orders.router)",
      'from app.tags import Tag\n\napp.include_router(orders.router, tags=["orders", Tag.public])',
    );
    expect(
      await reportedRoutes("FAPI001", { "app/orders.py": orders(plain), "app/main.py": main }),
    ).toEqual(["public_route", "untagged_route"]);
  });

  test("a string tag matches the enum member it spells", async () => {
    const strings = `from fastapi import APIRouter

from app.schema_route import SchemaRoute

router = APIRouter(route_class=SchemaRoute, tags=["public"])`;
    expect(await reportedRoutes("FAPI001", { "app/orders.py": orders(strings) })).toEqual([
      "public_route",
      "untagged_route",
    ]);
  });

  test("a route class it can't read keeps every route unknown, one that doesn't touch the schema none", async () => {
    const opaque = SCHEMA_ROUTE.replace(
      "        tags = self.tags",
      "        self.include_in_schema = decide(self)\n        tags = self.tags",
    );
    const keyword = `from fastapi import APIRouter

from app.schema_route import SchemaRoute

router = APIRouter(route_class=SchemaRoute)`;
    expect(
      await reportedRoutes("FAPI001", {
        "app/schema_route.py": opaque,
        "app/orders.py": orders(keyword),
      }),
    ).toEqual([]);
    const transactional = `from fastapi import APIRouter

from app.transactional import TransactionalRoute

router = APIRouter(route_class=TransactionalRoute)`;
    expect(await reportedRoutes("FAPI001", { "app/orders.py": orders(transactional) })).toEqual([
      "public_route",
      "private_route",
      "untagged_route",
    ]);
  });

  test("FAPI002 skips the routes the class leaves out", async () => {
    const raising = `from fastapi import APIRouter, HTTPException

from app.schema_route import SchemaRoute
from app.tags import Tag

router = APIRouter(route_class=SchemaRoute)


@router.get("/public", tags=[Tag.public])
async def public_route():
    raise HTTPException(status_code=404)


@router.get("/private", tags=[Tag.private])
async def private_route():
    raise HTTPException(status_code=404)
`;
    expect(await reportedRoutes("FAPI002", { "app/orders.py": raising })).toEqual(["public_route"]);
  });
});

describe("a route class that overrides matches (#392)", () => {
  /**
   * Writes a routes module with one method and path declared twice.
   *
   * @param head - the lines that import and build `router`.
   * @returns the module.
   */
  function twice(head: string): string {
    return `${head}


@router.post("/endpoints", summary="Create")
async def create() -> int: ...


@router.post("/endpoints", summary="Create v2")
async def create_v2() -> int: ...
`;
  }

  test("FAPI005 doesn't read the order of its routes, and does for any other route class", async () => {
    const versioned = `from fastapi import APIRouter

from app.versioned import VersionedRoute

router = APIRouter(route_class=VersionedRoute)`;
    expect(await reportedRoutes("FAPI005", { "app/orders.py": twice(versioned) })).toEqual([]);
    const routing = `from app.kit import get_router_class
from app.versioned import VersionedRoute

APIRouter = get_router_class(VersionedRoute)
`;
    const viaClass = "from app.routing import APIRouter\n\nrouter = APIRouter()";
    expect(
      await reportedRoutes("FAPI005", {
        "app/routing.py": routing,
        "app/orders.py": twice(viaClass),
      }),
    ).toEqual([]);
    // A route class that only wraps the handler matches like FastAPI's own.
    const transactional = routing
      .replaceAll("VersionedRoute", "TransactionalRoute")
      .replace("app.versioned", "app.transactional");
    expect(
      await reportedRoutes("FAPI005", {
        "app/routing.py": transactional,
        "app/orders.py": twice(viaClass),
      }),
    ).toEqual(["create_v2"]);
  });

  test("a router class whose route class can't be found stays unknown to FAPI005", async () => {
    const routing = `from app.kit import get_router_class
from app.versioned import pick

APIRouter = get_router_class(pick())
`;
    const viaClass = "from app.routing import APIRouter\n\nrouter = APIRouter()";
    expect(
      await reportedRoutes("FAPI005", {
        "app/routing.py": routing,
        "app/orders.py": twice(viaClass),
      }),
    ).toEqual([]);
  });
});
