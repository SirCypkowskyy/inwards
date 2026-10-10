/**
 * @file INW012 `thin-endpoint` beyond one function body (#271): the
 * module-level helpers an endpoint calls in its own file are counted into it,
 * up to three calls deep and each once, and the finding names them; a
 * `Depends` target and another endpoint are not followed. Handlers registered
 * by `add_api_route`, Starlette's `Route` or FastAPI's `APIRoute` are
 * endpoints too: in the same file the finding sits on the `def` line, and for
 * a first-party handler in another module it sits on the registration.
 */
import { describe, expect, test } from "bun:test";
import { Engine, parseConfig } from "../../src/index.ts";
import { file, grammars, indexOn } from "../support/helpers.ts";

const CONFIG = `[tool.inwards]
layers = [
  { name = "application", modules = ["shop.application"] },
  { name = "api", modules = ["shop.api"] },
]

[tool.inwards.rules]
extend-select = ["INW012"]
`;

const TAIL = "Endpoints parse the request, call one use case, and shape the response.";

/**
 * Checks a few files together with INW012 on and keeps its findings.
 *
 * @param files - each file's text by path; the first one is the one checked.
 * @param options - the `[tool.inwards.rules.thin-endpoint]` body, TOML.
 * @returns `path:line message` for each INW012 finding.
 */
async function findings(files: Record<string, string>, options = ""): Promise<string[]> {
  const table = options === "" ? "" : `[tool.inwards.rules.thin-endpoint]\n${options}\n`;
  const engine = await Engine.create(grammars(), parseConfig(`${CONFIG}${table}`));
  const texts = new Map(Object.entries(files));
  const disk = new Map<string, "file" | "dir">([
    ["shop", "dir"],
    ["shop/__init__.py", "file"],
    ["shop/api", "dir"],
    ["shop/api/__init__.py", "file"],
    ["shop/application", "dir"],
    ["shop/application/__init__.py", "file"],
    ...[...texts.keys()].map((path): [string, "file"] => [path, "file"]),
  ]);
  const [checked = ""] = Object.keys(files);
  return engine
    .checkFiles([file(checked, texts.get(checked) ?? "")], indexOn(disk, texts))
    .filter((d) => d.code === "INW012")
    .map((d) => `${d.file}:${d.line} ${d.message}`);
}

/**
 * Writes `count` plain statements, one per line, indented for a function body.
 *
 * @param count - how many statements.
 * @returns the lines, e.g. `    x0 = 0`.
 */
function statements(count: number): string {
  return Array.from({ length: count }, (_, i) => `    x${i} = ${i}\n`).join("");
}

/**
 * Writes the finding for a handler in `shop/api/orders.py` that only calls `httpx.get`.
 *
 * @param name - the handler's name.
 * @param line - its `def` line.
 * @returns the finding as `findings` lists it.
 */
function getsHttp(name: string, line: number): string {
  return `shop/api/orders.py:${line} \`${name}\` is an HTTP endpoint with a direct call to \`httpx.get\`. ${TAIL}`;
}

const HEAD = `from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from shop.application.orders import place_order

router = APIRouter()
`;

describe("INW012 same-file helpers", () => {
  test("an endpoint that only calls a fat helper reports, naming the helper and its line", async () => {
    const text = `${HEAD}

@router.post("/orders")
async def create_order(body: dict):
    return _create_order_impl(body)


def _create_order_impl(body):
${statements(20)}`;
    expect(await findings({ "shop/api/orders.py": text })).toEqual([
      `shop/api/orders.py:12 \`create_order\` is an HTTP endpoint with 21 statements (max 10), counting the same-module helper \`_create_order_impl\` (line 16). ${TAIL}`,
    ]);
  });

  test("follows helpers of helpers up to three deep, each once, and stops at recursion", async () => {
    const text = `${HEAD}

@router.get("/a")
def a():
    return _one()


def _one():
    _two()
    _one()
    return _two()


def _two():
    _three()
    return _one()


def _three():
    _four()
    return 1


def _four():
${statements(30)}`;
    expect(await findings({ "shop/api/orders.py": text }, "max-statements = 7")).toEqual([
      `shop/api/orders.py:12 \`a\` is an HTTP endpoint with 8 statements (max 7), counting the same-module helpers \`_one\` (line 16), \`_two\` (line 22) and \`_three\` (line 27). ${TAIL}`,
    ]);
  });

  test("reads a helper's session calls through its own annotations and the arguments passed to it", async () => {
    const text = `${HEAD}

@router.get("/a")
async def a(db: Annotated[AsyncSession, Depends(get_db)]):
    return await _load(db, 1)


@router.get("/b")
async def b(session: AsyncSession):
    return await _typed(1, s=session)


async def _load(conn, id):
    return await conn.get(Order, id)


async def _typed(id, s: AsyncSession | None = None):
    return await s.scalar(id)
`;
    expect(await findings({ "shop/api/orders.py": text })).toEqual([
      `shop/api/orders.py:12 \`a\` is an HTTP endpoint with a direct call to \`conn.get\`, counting the same-module helper \`_load\` (line 21). ${TAIL}`,
      `shop/api/orders.py:17 \`b\` is an HTTP endpoint with a direct call to \`s.scalar\`, counting the same-module helper \`_typed\` (line 25). ${TAIL}`,
    ]);
  });

  test("a call into delegate-to inside a helper counts for the endpoint", async () => {
    const text = `${HEAD}

@router.post("/orders")
async def create_order(body: dict):
    return await _go(body)


async def _go(body):
    return await place_order(body)
`;
    expect(await findings({ "shop/api/orders.py": text }, 'delegate-to = ["application"]')).toEqual(
      [],
    );
  });

  test("doesn't follow Depends targets, other endpoints, nested functions or imported names", async () => {
    const text = `${HEAD}
from shop.application.reports import build_report


def get_service():
${statements(20)}


@router.get("/a")
def a(service: Annotated[object, Depends(get_service)]):
    def local():
        return 1
    b()
    local()
    return build_report()


@router.get("/b")
def b():
${statements(5)}`;
    expect(await findings({ "shop/api/orders.py": text }, "max-statements = 5")).toEqual([]);
  });

  test("the fix lists the helper's lines with the endpoint's", async () => {
    const engine = await Engine.create(grammars(), parseConfig(CONFIG));
    const path = "shop/api/orders.py";
    const text = `${HEAD}

@router.post("/orders")
async def create_order(body: dict):
    data = body["x"]
    return _impl(data)


def _impl(data):
${statements(12)}`;
    const [found] = engine.checkFiles(
      [file(path, text)],
      indexOn(new Map([[path, "file"]]), new Map([[path, text]])),
    );
    expect(found?.fix?.steps[0]).toBe(
      "Move the logic (lines 13 to 14, and `_impl` at lines 18 to 29) into a function in a service or use-case module that takes plain arguments and returns a domain object or a result the endpoint maps to the response.",
    );
  });
});

describe("INW012 registered routes", () => {
  test("add_api_route and Route make a same-file function an endpoint", async () => {
    const text = `from fastapi import APIRouter
from fastapi.routing import APIRoute
from starlette.routing import Route

import httpx

router = APIRouter()


def by_router():
    return httpx.get("x")


def by_keyword():
    return httpx.get("x")


async def by_route(request):
    return httpx.get("x")


def by_api_route():
    return httpx.get("x")


def not_registered():
    return httpx.get("x")


router.add_api_route("/a", by_router, methods=["GET"])
router.add_api_route("/b", endpoint=by_keyword)
routes = [Route("/c", by_route), APIRoute("/d", by_api_route)]
`;
    expect(await findings({ "shop/api/orders.py": text })).toEqual([
      getsHttp("by_router", 10),
      getsHttp("by_keyword", 14),
      getsHttp("by_route", 18),
      getsHttp("by_api_route", 22),
    ]);
  });

  test("a decorated endpoint that is also registered reports once", async () => {
    const text = `from fastapi import APIRouter
import httpx

router = APIRouter()


@router.get("/a")
def a():
    return httpx.get("x")


router.add_api_route("/b", a)
`;
    expect(await findings({ "shop/api/orders.py": text })).toHaveLength(1);
  });

  test("a first-party handler in another module reports on the registration", async () => {
    const routes = `from fastapi import APIRouter
from starlette.routing import Route

from shop.api import views
from shop.api.views import create_order
from somewhere.else import external

router = APIRouter()
router.add_api_route("/orders", create_order, methods=["POST"])
router.add_api_route("/external", external)
routes = [Route("/list", views.list_orders), Route("/missing", views.missing)]
`;
    const views = `import httpx


def create_order(body):
    _check(body)
    return httpx.post("x")


def _check(body):
${statements(10)}

async def list_orders(request):
    return 1
`;
    expect(await findings({ "shop/api/routes.py": routes, "shop/api/views.py": views })).toEqual([
      `shop/api/routes.py:9 \`create_order\` (shop/api/views.py, line 4), which \`add_api_route\` registers here, is an HTTP endpoint with 12 statements (max 10) and a direct call to \`httpx.post\`, counting the same-module helper \`_check\` (shop/api/views.py, line 9). ${TAIL}`,
    ]);
  });

  test("follows a re-export to the handler's module", async () => {
    const routes = `from fastapi import FastAPI

from shop.api import create_order

app = FastAPI()
app.add_api_route("/orders", create_order)
`;
    const init = "from shop.api.views import create_order\n";
    const views = "import httpx\n\n\ndef create_order():\n    return httpx.post('x')\n";
    expect(
      await findings({
        "shop/api/routes.py": routes,
        "shop/api/__init__.py": init,
        "shop/api/views.py": views,
      }),
    ).toEqual([
      `shop/api/routes.py:6 \`create_order\` (shop/api/views.py, line 4), which \`add_api_route\` registers here, is an HTTP endpoint with a direct call to \`httpx.post\`. ${TAIL}`,
    ]);
  });

  test("a registered handler that is a decorated endpoint in its own module isn't reported twice", async () => {
    const routes = `from fastapi import APIRouter

from shop.api.views import create_order

router = APIRouter()
router.add_api_route("/orders", create_order)
`;
    const views = `import httpx
from fastapi import APIRouter

other = APIRouter()


@other.post("/x")
def create_order():
    return httpx.post("x")
`;
    expect(await findings({ "shop/api/routes.py": routes, "shop/api/views.py": views })).toEqual(
      [],
    );
  });

  test("a per-edit check of the registering file reports it, and a suppression there hides it", async () => {
    const engine = await Engine.create(grammars(), parseConfig(CONFIG));
    const routes = `from fastapi import APIRouter

from shop.api.views import create_order

router = APIRouter()
router.add_api_route("/orders", create_order)
`;
    const views = "import httpx\n\n\ndef create_order():\n    return httpx.post('x')\n";
    const texts = new Map([
      ["shop/api/routes.py", routes],
      ["shop/api/views.py", views],
    ]);
    const disk = new Map<string, "file" | "dir">([
      ["shop", "dir"],
      ["shop/api", "dir"],
      ["shop/api/routes.py", "file"],
      ["shop/api/views.py", "file"],
    ]);
    const suppressed = routes.replace(
      "create_order)\n",
      'create_order)  # inwards: ignore[INW012] reason="legacy route"\n',
    );
    const found = [routes, suppressed].map((text) =>
      engine
        .checkFile(file("shop/api/routes.py", text), indexOn(disk, texts))
        .map((d) => `${d.code}:${d.line}:${d.column}`),
    );
    expect(found).toEqual([["INW012:6:33"], []]);
  });
});
