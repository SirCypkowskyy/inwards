/**
 * @file FAPI002 `undocumented-error-response` (#183), ring by ring: a direct
 * `raise HTTPException(404)` and one in a same-file helper report, and
 * `responses=` on the decorator, the router or through `**COMMON` clears them
 * (rings 0 and 1); an imported helper reports until `max-depth = 0` (ring 2);
 * a custom exception an app handler maps to 409 reports, subclasses too, until
 * `handled-counts-as-documented` (ring 3). Unknown codes or `responses=`
 * report nothing, a parent inclusion's `responses=` counts, and the fix names
 * where each code comes from.
 */
import { describe, expect, test } from "bun:test";
import { checkProject, ERRORS, fapi002, HEAD, MAIN, raising, reported } from "./fixture.ts";

const DIRECT = `
@router.get("/orders/{id}")
async def read_order(id: int) -> OrderOut:
    raise HTTPException(status_code=404)
`;

const HELPER = `
def load_or_404(id):
    raise HTTPException(404, "no such order")


@router.get("/orders/{id}")
async def read_order(id: int) -> OrderOut:
    return load_or_404(id)
`;

describe("FAPI002 rings 0 and 1", () => {
  test("is off by default", async () => {
    const files = { "app/__init__.py": "", "app/orders.py": `${HEAD}${DIRECT}` };
    expect(await checkProject(files, "")).toEqual([]);
  });

  test("a direct raise and one in a same-file helper each report", async () => {
    expect(await fapi002(DIRECT)).toEqual([
      "app/orders.py:7 `read_order` can return 404, which its OpenAPI entry doesn't declare.",
    ]);
    expect(await fapi002(HELPER)).toEqual([
      "app/orders.py:11 `read_order` can return 404, which its OpenAPI entry doesn't declare.",
    ]);
  });

  test.each([
    [
      "on the decorator",
      DIRECT.replace('"/orders/{id}"', '"/orders/{id}", responses={404: {}}'),
      HEAD,
    ],
    [
      "as a string key",
      DIRECT.replace('"/orders/{id}"', '"/orders/{id}", responses={"404": {}}'),
      HEAD,
    ],
    [
      "as a 4XX wildcard",
      DIRECT.replace('"/orders/{id}"', '"/orders/{id}", responses={"4XX": {}}'),
      HEAD,
    ],
    [
      "as default",
      DIRECT.replace('"/orders/{id}"', '"/orders/{id}", responses={"default": {}}'),
      HEAD,
    ],
    [
      "as a status constant",
      DIRECT.replace('"/orders/{id}"', '"/orders/{id}", responses={status.HTTP_404_NOT_FOUND: {}}'),
      HEAD,
    ],
    [
      "in openapi_extra",
      DIRECT.replace('"/orders/{id}"', '"/orders/{id}", openapi_extra={"responses": {"404": {}}}'),
      HEAD,
    ],
    [
      "on the same-file APIRouter",
      DIRECT,
      HEAD.replace("APIRouter()", "APIRouter(responses={404: {}})"),
    ],
    [
      "through **COMMON",
      DIRECT.replace('"/orders/{id}"', '"/orders/{id}", responses={**COMMON}'),
      `${HEAD}COMMON = {404: {"description": "Not found"}}\n`,
    ],
  ])("responses= %s clears it", async (_, body, head) => {
    const files = { "app/__init__.py": "", "app/orders.py": `${head}${body}` };
    expect(await reported(files, "FAPI002")).toEqual([]);
  });

  test("**COMMON imported from another module clears it too", async () => {
    const body = `from app.common import COMMON\n${DIRECT.replace('"/orders/{id}"', '"/orders/{id}", responses={**COMMON}')}`;
    expect(await fapi002(body, { "app/common.py": "COMMON = {404: {}}\n" })).toEqual([]);
  });

  test("codes spelled as constants report", async () => {
    const body = `
from http import HTTPStatus

GONE = 410


@router.get("/a")
async def a() -> OrderOut:
    raise HTTPException(status.HTTP_403_FORBIDDEN)


@router.get("/b")
async def b() -> OrderOut:
    raise HTTPException(HTTPStatus.CONFLICT)


@router.get("/c")
async def c() -> OrderOut:
    raise HTTPException(status_code=GONE)
`;
    expect(await fapi002(body)).toEqual([
      "app/orders.py:12 `a` can return 403, which its OpenAPI entry doesn't declare.",
      "app/orders.py:17 `b` can return 409, which its OpenAPI entry doesn't declare.",
      "app/orders.py:22 `c` can return 410, which its OpenAPI entry doesn't declare.",
    ]);
  });

  test("a returned response with a status code reports", async () => {
    const body = `
from fastapi.responses import JSONResponse


@router.get("/a")
async def a() -> OrderOut:
    return JSONResponse({"detail": "gone"}, status_code=410)
`;
    expect(await fapi002(body)).toEqual([
      "app/orders.py:10 `a` can return 410, which its OpenAPI entry doesn't declare.",
    ]);
  });

  test("dependencies count: Depends default, Annotated and dependencies=", async () => {
    const body = `
def current_user():
    raise HTTPException(401)


def admin_only():
    raise HTTPException(403)


def quota():
    raise HTTPException(429)


@router.get("/a")
async def a(user=Depends(current_user)) -> OrderOut: ...


@router.get("/b")
async def b(user: Annotated[User, Depends(admin_only)]) -> OrderOut: ...


@router.get("/c", dependencies=[Depends(quota)])
async def c() -> OrderOut: ...
`;
    expect(await fapi002(body)).toEqual([
      "app/orders.py:19 `a` can return 401, which its OpenAPI entry doesn't declare.",
      "app/orders.py:23 `b` can return 403, which its OpenAPI entry doesn't declare.",
      "app/orders.py:27 `c` can return 429, which its OpenAPI entry doesn't declare.",
    ]);
  });

  test("router-level dependencies count for every route under it", async () => {
    const head = `${HEAD.replace("router = APIRouter()", "")}
def verify():
    raise HTTPException(401)


router = APIRouter(dependencies=[Depends(verify)])
`;
    const files = {
      "app/__init__.py": "",
      "app/orders.py": `${head}${DIRECT.replace("raise HTTPException(status_code=404)", "...")}`,
    };
    expect(await reported(files, "FAPI002")).toEqual([
      "app/orders.py:13 `read_order` can return 401, which its OpenAPI entry doesn't declare.",
    ]);
  });

  test("report-direct-raises = false leaves direct raises to Ruff FAST004, not helpers", async () => {
    expect(await fapi002(DIRECT, {}, "report-direct-raises = false")).toEqual([]);
    expect(await fapi002(HELPER, {}, "report-direct-raises = false")).toHaveLength(1);
  });

  test('codes = "4xx-5xx" adds server errors', async () => {
    const body = DIRECT.replace("status_code=404", "status_code=503");
    expect(await fapi002(body)).toEqual([]);
    expect(await fapi002(body, {}, 'codes = "4xx-5xx"')).toEqual([
      "app/orders.py:7 `read_order` can return 503, which its OpenAPI entry doesn't declare.",
    ]);
  });

  test('422 counts as documented for an operation with parameters, unless explicit-422 = "report"', async () => {
    const body = DIRECT.replace("status_code=404", "status_code=422");
    expect(await fapi002(body)).toEqual([]);
    expect(await fapi002(body, {}, 'explicit-422 = "report"')).toHaveLength(1);
    expect(await fapi002(body.replace("id: int", ""))).toHaveLength(1);
  });

  test("a raise inside a nested function isn't the endpoint's", async () => {
    const body = `
@router.get("/a")
async def a() -> OrderOut:
    def later():
        raise HTTPException(404)
    return OrderOut()
`;
    expect(await fapi002(body)).toEqual([]);
  });
});

describe("FAPI002 ring 2", () => {
  const imported = `
from app.helpers import load_or_409


@router.post("/orders", status_code=201)
async def create_order(id: int) -> OrderOut:
    return load_or_409(id)
`;
  const helpers = {
    "app/helpers.py": `from fastapi import HTTPException


def load_or_409(id):
    return check(id)


def check(id):
    raise HTTPException(409)
`,
  };

  test("a helper imported from another module, two calls deep, reports", async () => {
    expect(await fapi002(imported, helpers)).toEqual([
      "app/orders.py:10 `create_order` can return 409, which its OpenAPI entry doesn't declare.",
    ]);
  });

  test("max-depth bounds the calls followed", async () => {
    expect(await fapi002(imported, helpers, "max-depth = 1")).toEqual([]);
    expect(await fapi002(imported, helpers, "max-depth = 0")).toEqual([]);
  });

  test("a method on an injected object isn't followed (ring 4)", async () => {
    const body = `
@router.post("/orders", status_code=201)
async def create_order(svc: Annotated[Service, Depends(Service)]) -> OrderOut:
    return svc.place()
`;
    expect(await fapi002(body)).toEqual([]);
  });
});

/**
 * Writes an `app/main.py` that includes the orders router.
 *
 * @param args - what follows `orders.router` in the `include_router` call.
 * @returns the file by path.
 */
function mainWith(args: string): Record<string, string> {
  return {
    "app/main.py": `from fastapi import FastAPI\n\nfrom app import orders\n\napp = FastAPI()\napp.include_router(orders.router${args})\n`,
  };
}

describe("FAPI002 ring 3", () => {
  test("a custom exception an app handler maps to 409 reports 409", async () => {
    const files = {
      "app/main.py": MAIN,
      "app/errors.py": `from fastapi import HTTPException\n\n${ERRORS}`,
    };
    expect(await fapi002(raising("OutOfStock"), files)).toEqual([
      "app/orders.py:10 `create_order` can return 409, which its OpenAPI entry doesn't declare.",
    ]);
    expect(await fapi002(raising("LastItemGone"), files)).toHaveLength(1);
    expect(await fapi002(raising("DomainError"), files)).toEqual([]);
  });

  test("handled-counts-as-documented = true clears it", async () => {
    const files = {
      "app/main.py": MAIN,
      "app/errors.py": `from fastapi import HTTPException\n\n${ERRORS}`,
    };
    expect(
      await fapi002(raising("OutOfStock"), files, "handled-counts-as-documented = true"),
    ).toEqual([]);
  });

  test("an HTTPException subclass that fixes its code reports that code", async () => {
    const files = { "app/errors.py": `from fastapi import HTTPException\n\n${ERRORS}` };
    const body = raising("ItemNotFound").replace("ItemNotFound()", "ItemNotFound(3)");
    expect(await fapi002(body, files)).toEqual([
      "app/orders.py:10 `create_order` can return 404, which its OpenAPI entry doesn't declare.",
    ]);
  });

  test("a dynamic handler registration or a third-party base keeps it quiet (#185)", async () => {
    const files = {
      "app/main.py": MAIN,
      "app/errors.py": `from fastapi import HTTPException\n\n${ERRORS}`,
    };
    const dynamic = `${MAIN}\nfor exc, handler in HANDLERS.items():\n    app.add_exception_handler(exc, handler)\n`;
    expect(await fapi002(raising("OutOfStock"), { ...files, "app/main.py": dynamic })).toEqual([]);
    const foreign = files["app/errors.py"].replace(
      "class DomainError(Exception): ...",
      "from authlib.oauth2 import OAuth2Error\n\n\nclass DomainError(OAuth2Error): ...",
    );
    expect(await fapi002(raising("OutOfStock"), { ...files, "app/errors.py": foreign })).toEqual(
      [],
    );
  });

  test("a generator called by name isn't run by the call (#185)", async () => {
    const body = `
from fastapi.responses import StreamingResponse


def rows():
    yield b"x"
    raise HTTPException(404)


@router.get("/export")
async def export() -> StreamingResponse:
    return StreamingResponse(rows())
`;
    expect(await fapi002(body)).toEqual([]);
  });

  test("an except clause around the call drops what it catches", async () => {
    const body = `
from app.errors import DomainError, OutOfStock


def place():
    raise OutOfStock()


@router.post("/orders", status_code=201)
async def create_order(id: int) -> OrderOut:
    try:
        place()
    except DomainError:
        return OrderOut()
`;
    const files = {
      "app/main.py": MAIN,
      "app/errors.py": `from fastapi import HTTPException\n\n${ERRORS}`,
    };
    expect(await fapi002(body, files)).toEqual([]);
    expect(
      await fapi002(body.replace("except DomainError", "except KeyError"), files),
    ).toHaveLength(1);
  });
});

describe("FAPI002 stays quiet when it can't know", () => {
  test("an unknown status code or responses= reports nothing", async () => {
    const body = `
@router.get("/a", responses=build())
async def a() -> OrderOut:
    raise HTTPException(404)


@router.get("/b")
async def b(code: int) -> OrderOut:
    raise HTTPException(code)


@router.get("/c", **extra)
async def c() -> OrderOut:
    raise HTTPException(404)
`;
    expect(await fapi002(body)).toEqual([]);
  });

  test("a parent include_router(..., responses=) in another file counts", async () => {
    expect(await fapi002(DIRECT, mainWith(", responses={404: {}}"))).toEqual([]);
    expect(await fapi002(DIRECT, mainWith(", **opts"))).toEqual([]);
    expect(await fapi002(DIRECT, mainWith(""))).toHaveLength(1);
  });

  test("a router included in a loop over a literal list counts, per edit too", async () => {
    const main = {
      "app/main.py":
        "from fastapi import FastAPI\n\nfrom app import orders\n\napp = FastAPI()\nfor r in [orders.router]:\n    app.include_router(r, responses={404: {}})\n",
    };
    expect(await fapi002(DIRECT, main)).toEqual([]);
    const files = { "app/__init__.py": "", "app/orders.py": `${HEAD}${DIRECT}`, ...main };
    const rules = '[tool.inwards.rules]\nextend-select = ["FAPI002"]';
    expect(await checkProject(files, rules, "app/orders.py")).toEqual([]);
    const bare = {
      ...files,
      "app/main.py": files["app/main.py"].replace(", responses={404: {}}", ""),
    };
    expect((await checkProject(bare, rules, "app/orders.py")).map((d) => d.code)).toEqual([
      "FAPI002",
    ]);
  });

  test("responses= on FastAPI() counts for every route under it", async () => {
    const files = {
      "app/main.py":
        "from fastapi import FastAPI\n\nfrom app import orders\n\napp = FastAPI(responses={404: {}})\napp.include_router(orders.router)\n",
    };
    expect(await fapi002(DIRECT, files)).toEqual([]);
  });

  test("an inclusion Inwards can't resolve makes routes on routers unknown", async () => {
    const files = {
      "app/main.py":
        'from fastapi import FastAPI\n\nfrom app import orders\n\napp = FastAPI()\napp.include_router(getattr(orders, "router"))\n',
    };
    expect(await fapi002(DIRECT, files)).toEqual([]);
  });
});
