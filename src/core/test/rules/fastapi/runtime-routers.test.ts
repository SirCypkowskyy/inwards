/**
 * @file Routers that aren't built by calling FastAPI's own `APIRouter` (#358):
 * a router class built at run time (Polar's `APIRouter =
 * get_api_router_class(APIRoute)`), a first-party subclass, a first-party
 * function that returns a router, and routes declared inside a router
 * factory whose return annotation says it builds a router
 * (fastapi-clean-example). FAPI001 and INW012 must see their routes, in a
 * whole-project check and in a one-file check, and a first-party class that
 * only shares the name (OpenStack's WSGI `APIRouter`) must not count.
 */
import { describe, expect, test } from "bun:test";
import { checkProject } from "./fixture.ts";

/** A route that trips FAPI001 (no summary, model or status code) and INW012 (a loop, 3 branches, 14 statements). */
const FAT = `
@router.post("/")
async def create_order(lines: list[int]):
    total = 0
    for line in lines:
        if line < 0:
            total -= line
        elif line > 100:
            total += 100
        else:
            total += line
    if total > 1000:
        total = 1000
    count = len(lines)
    average = total / count
    rounded = round(average)
    label = str(rounded)
    prefix = "avg"
    text = prefix + label
    return {"text": text}
`;

/** A router class built at run time, as Polar's `polar/routing.py` builds it. */
const KIT = `from fastapi import APIRouter as _APIRouter


def make_router_class(route_class):
    class _Router(_APIRouter):
        def __init__(self, *args, **kwargs):
            kwargs["route_class"] = route_class
            super().__init__(*args, **kwargs)

    return _Router
`;

const ROUTING = `from fastapi.routing import APIRoute

from app.kit import make_router_class

APIRouter = make_router_class(APIRoute)
`;

const MAIN = `from fastapi import FastAPI

from app import orders

app = FastAPI()
app.include_router(orders.router)
`;

const RULES = '[tool.inwards.rules]\nextend-select = ["FAPI001", "INW012"]';

/**
 * Checks a project with FAPI001 and INW012 on, as a whole or one edited file.
 *
 * @param files - file texts by path; `app/__init__.py` and `app/main.py` are added.
 * @param edited - the one file to check, if not the whole project.
 * @returns `code path:line` for each FAPI001 and INW012 finding.
 */
async function found(files: Readonly<Record<string, string>>, edited?: string): Promise<string[]> {
  const all = { "app/__init__.py": "", "app/main.py": MAIN, ...files };
  const diagnostics = await checkProject(all, RULES, edited);
  return diagnostics
    .filter((d) => d.code === "FAPI001" || d.code === "INW012")
    .map((d) => `${d.code} ${d.file}:${d.line}`);
}

/**
 * Writes a router module whose router a factory from `app/factories.py` builds.
 *
 * @param factory - the factory's name.
 * @returns the module, with the fat route on line 7.
 */
function ordersFrom(factory: string): string {
  return `from fastapi import status

from app.factories import ${factory}

router = ${factory}("/orders")
${FAT}`;
}

/**
 * Checks a project with FAPI003 on and lists where it reports.
 *
 * @param files - file texts by path; `app/__init__.py` is added.
 * @returns `path:line` for each FAPI003 finding.
 */
async function lines(files: Readonly<Record<string, string>>): Promise<string[]> {
  const diagnostics = await checkProject(
    { "app/__init__.py": "", ...files },
    '[tool.inwards.rules]\nextend-select = ["FAPI003"]',
  );
  return diagnostics.filter((d) => d.code === "FAPI003").map((d) => `${d.file}:${d.line}`);
}

/**
 * Writes a router module that declares one method and path twice, as Polar's versioned routes do.
 *
 * @param head - the import that brings `APIRouter` in.
 * @returns the module.
 */
function twice(head: string): string {
  return `${head}

router = APIRouter()


@router.post("/endpoints", summary="Create")
async def create() -> int: ...


@router.post("/endpoints", summary="Create v2")
async def create_v2() -> int: ...
`;
}

/**
 * Counts FAPI005's findings on a project whose `app/orders.py` is given.
 *
 * @param orders - the router module.
 * @returns how many FAPI005 findings there are.
 */
async function shadowed(orders: string): Promise<number> {
  const files = { "app/__init__.py": "", "app/kit.py": KIT, "app/routing.py": ROUTING };
  const diagnostics = await checkProject(
    { ...files, "app/orders.py": orders },
    '[tool.inwards.rules]\nextend-select = ["FAPI005"]',
  );
  return diagnostics.filter((d) => d.code === "FAPI005").length;
}

describe("routers built at run time (#358)", () => {
  test("a first-party `APIRouter = <call>` builds routers in the modules that import it", async () => {
    // The router module never names fastapi, as Polar's `customer_portal/endpoints/__init__.py`.
    const orders = `from app.routing import APIRouter

router = APIRouter(prefix="/orders")
${FAT}`;
    const files = { "app/kit.py": KIT, "app/routing.py": ROUTING, "app/orders.py": orders };
    const expected = ["FAPI001 app/orders.py:5", "INW012 app/orders.py:6"];
    expect(await found(files)).toEqual(expected);
    expect(await found(files, "app/orders.py")).toEqual(expected);
  });

  test("a class factory's router class counts under any name", async () => {
    // Polar's back office: `BackofficeRouter = get_api_router_class(TransactionalAPIRoute)`.
    const typed = `import fastapi


def make_router_class(route_class) -> type[fastapi.APIRouter]:
    return build(route_class)
`;
    const routing = `from fastapi.routing import APIRoute

from app.kit import make_router_class

AdminRouter = make_router_class(APIRoute)
`;
    const orders = `from fastapi import status

from app.routing import AdminRouter

router = AdminRouter()
${FAT}`;
    const files = { "app/routing.py": routing, "app/orders.py": orders };
    const expected = ["FAPI001 app/orders.py:7", "INW012 app/orders.py:8"];
    expect(await found({ ...files, "app/kit.py": KIT })).toEqual(expected);
    expect(await found({ ...files, "app/kit.py": typed })).toEqual(expected);
    // A factory whose class can't be read builds no router unless the name says APIRouter.
    const opaque = typed.replace(" -> type[fastapi.APIRouter]", "");
    expect(await found({ ...files, "app/kit.py": opaque })).toEqual([]);
  });

  test("a router built by calling the class a factory returns counts", async () => {
    // Polar's checkout links: `router = get_api_router_class(TransactionalAPIRoute)()`.
    const orders = `from fastapi.routing import APIRoute

from app.kit import make_router_class

router = make_router_class(APIRoute)()
${FAT}`;
    expect(await found({ "app/kit.py": KIT, "app/orders.py": orders })).toEqual([
      "FAPI001 app/orders.py:7",
      "INW012 app/orders.py:8",
    ]);
  });

  test("a router every known inclusion hides stays hidden when another inclusion can't be followed", async () => {
    // Polar's back office app has openapi_url=None; elsewhere routers come from factories and parameters.
    const office = `from fastapi import FastAPI

from app.routing import APIRouter

router = APIRouter()
${FAT}
app = FastAPI(openapi_url=None)
app.include_router(router)
`;
    const main = `from fastapi import FastAPI

from app.factories import make_router


def mount(app: FastAPI, api_router) -> None:
    app.include_router(api_router)


app = FastAPI()
app.include_router(make_router())
`;
    const files = {
      "app/kit.py": KIT,
      "app/routing.py": ROUTING,
      "app/office.py": office,
      "app/factories.py": "def make_router(): ...\n",
      "app/main.py": main,
    };
    expect(await found(files)).toEqual(["INW012 app/office.py:8"]);
  });

  test("a re-exported run-time class and a first-party subclass count too", async () => {
    const sub = `import fastapi


class APIRouter(fastapi.APIRouter):
    pass


class VersionedRouter(APIRouter):
    pass
`;
    const orders = `from fastapi import status

from app.routing import VersionedRouter

router = VersionedRouter()
${FAT}`;
    const files = { "app/routing/__init__.py": "from .base import VersionedRouter\n" };
    expect(await found({ ...files, "app/routing/base.py": sub, "app/orders.py": orders })).toEqual([
      "FAPI001 app/orders.py:7",
      "INW012 app/orders.py:8",
    ]);
  });

  test("a first-party class that only shares the name isn't a router", async () => {
    // OpenStack's WSGI routers are first-party classes named APIRouter (tacker, manila, nova).
    const wsgi = `from app.wsgi import Router


class APIRouter(Router):
    pass
`;
    const orders = `from fastapi import Depends

from app.routing import APIRouter

router = APIRouter()
${FAT}`;
    const files = { "app/wsgi.py": "class Router: ...\n", "app/routing.py": wsgi };
    expect(await found({ ...files, "app/orders.py": orders })).toEqual([]);
  });

  test("a first-party function that returns a router builds one, one hop deep", async () => {
    const factories = `from fastapi import APIRouter


def make_router(prefix: str):
    return APIRouter(prefix=prefix, tags=["shop"])


def make_named(prefix: str):
    router = APIRouter(prefix=prefix)
    return router


def make_twice(prefix: str):
    return make_router(prefix)
`;
    const files = { "app/factories.py": factories };
    const [router, named, twoHops] = await Promise.all(
      ["make_router", "make_named", "make_twice"].map((factory) =>
        found({ ...files, "app/orders.py": ordersFrom(factory) }),
      ),
    );
    expect(router).toEqual(["FAPI001 app/orders.py:7", "INW012 app/orders.py:8"]);
    expect(named).toEqual(["FAPI001 app/orders.py:7", "INW012 app/orders.py:8"]);
    // A factory that calls another factory is two hops: not followed.
    expect(twoHops).toEqual([]);
  });

  test("routes declared inside a router factory report", async () => {
    // fastapi-clean-example: `make_*_router() -> APIRouter` around a third-party router wrapper.
    const wrapper = `from fastapi_error_map import ErrorAwareRouter


def make_error_aware_router(**kwargs) -> ErrorAwareRouter:
    return ErrorAwareRouter(**kwargs)
`;
    const orders = `from fastapi import APIRouter

from app.errors import make_error_aware_router


def make_orders_router() -> APIRouter:
    router = make_error_aware_router()
${FAT.replace(/\n(?=.)/gu, "\n    ")}
    return router
`;
    const main = `from fastapi import FastAPI

from app.orders import make_orders_router

app = FastAPI()
app.include_router(make_orders_router())
`;
    const files = { "app/errors.py": wrapper, "app/orders.py": orders, "app/main.py": main };
    expect(await found(files)).toEqual(["FAPI001 app/orders.py:9", "INW012 app/orders.py:10"]);
    expect(await found(files, "app/orders.py")).toEqual([
      "FAPI001 app/orders.py:9",
      "INW012 app/orders.py:10",
    ]);
    // Without the annotation nothing says the wrapper's result is a router.
    const bare = orders.replace(" -> APIRouter:", ":");
    expect(await found({ ...files, "app/orders.py": bare })).toEqual([]);
  });

  test("an unfollowable inclusion makes a newly recognised router unknown to FAPI003", async () => {
    // Polar: `add_versioned_routers(app, api_router)` and `include_router(get_oauth_login_router())`.
    const orders = `from app.routing import APIRouter

router = APIRouter(prefix="/orders")


@router.get("/", summary="List")
async def list_orders() -> list[int]: ...
`;
    const factory = `from app.routing import APIRouter


def make_auth_router() -> APIRouter:
    router = APIRouter(prefix="/auth")

    @router.get("/login", summary="Log in")
    async def login() -> int: ...

    return router
`;
    const viaParameter = `from fastapi import FastAPI

from app import orders


def wire(app: FastAPI, api_router) -> None:
    app.include_router(api_router)


app = FastAPI()
wire(app, orders.router)
`;
    const viaFactory = `from fastapi import FastAPI

from app.auth import make_auth_router

app = FastAPI()
app.include_router(make_auth_router())
`;
    const base = { "app/kit.py": KIT, "app/routing.py": ROUTING, "app/auth.py": factory };
    expect(await lines({ ...base, "app/orders.py": orders, "app/main.py": viaParameter })).toEqual(
      [],
    );
    // Only the factory's own router could be the target: a router nothing includes still reports.
    expect(await lines({ ...base, "app/orders.py": orders, "app/main.py": viaFactory })).toEqual([
      "app/orders.py:3",
    ]);
  });

  test("FAPI005 doesn't read route order on a router a first-party class builds", async () => {
    // Polar's VersionedAPIRoute dispatches two routes with one method and path by API version.
    expect(await shadowed(twice("from app.routing import APIRouter"))).toBe(0);
    expect(await shadowed(twice("from fastapi import APIRouter"))).toBe(1);
  });
});
