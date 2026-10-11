/**
 * @file FAPI001 `endpoint-metadata` (#183): the issue's bad example reports a
 * missing summary, response model and status code in one finding on the
 * decorator, the good one reports nothing, and each option turns its check
 * off. Routes left out of the schema, and decorators Inwards can't read, are
 * skipped; tags from an inclusion in another file count.
 */
import { describe, expect, test } from "bun:test";
import { checkProject, reported } from "./fixture.ts";

const HEAD = `from fastapi import APIRouter, FastAPI, Response, status
from fastapi.responses import JSONResponse

router = APIRouter()
`;

/**
 * Checks one router module with FAPI001 on.
 *
 * @param body - the module's routes, after the imports and `router = APIRouter()`.
 * @param options - the options table's body, TOML.
 * @returns what FAPI001 reports.
 */
function fapi001(body: string, options = ""): Promise<string[]> {
  const table = options === "" ? "" : `[tool.inwards.rules.endpoint-metadata]\n${options}\n`;
  return reported({ "app/__init__.py": "", "app/orders.py": `${HEAD}${body}` }, "FAPI001", table);
}

const BAD = `
@router.post("/orders")
async def create_order(body: OrderIn):
    ...
`;

const GOOD = `
@router.post("/orders", status_code=201, summary="Place an order",
             responses={409: {"model": Problem, "description": "A product is out of stock"}})
async def create_order(body: OrderIn) -> OrderOut:
    ...
`;

/**
 * Builds a project whose router module an app in `app/main.py` includes.
 *
 * @param orders - the text of `app/orders.py`.
 * @param args - what follows `orders.router` in the `include_router` call.
 * @returns the files by path.
 */
function mountedProject(orders: string, args: string): Record<string, string> {
  return {
    "app/__init__.py": "",
    "app/orders.py": orders,
    "app/main.py": `from fastapi import FastAPI\nfrom app import orders\n\napp = FastAPI()\napp.include_router(orders.router${args})\n`,
  };
}

describe("FAPI001", () => {
  test("is off by default, and extend-select turns it on alone", async () => {
    const files = { "app/__init__.py": "", "app/orders.py": `${HEAD}${BAD}` };
    expect(await checkProject(files, "")).toEqual([]);
    const on = await checkProject(files, '[tool.inwards.rules]\nextend-select = ["FAPI001"]');
    expect(on.map((d) => d.code)).toEqual(["FAPI001"]);
  });

  test("reports the bad example once, on the decorator, with everything missing", async () => {
    const [d, ...rest] = await checkProject(
      { "app/__init__.py": "", "app/orders.py": `${HEAD}${BAD}` },
      '[tool.inwards.rules]\nextend-select = ["FAPI001"]',
    );
    expect(rest).toEqual([]);
    expect(d).toMatchObject({
      code: "FAPI001",
      rule: "endpoint-metadata",
      severity: "error",
      file: "app/orders.py",
      line: 6,
      column: 1,
      endLine: 6,
      endColumn: 24,
      message:
        "`create_order` (POST /orders) has no summary, explicit status code or response model in its OpenAPI metadata.",
      docs: "https://sircypkowskyy.github.io/inwards/rules/FAPI001/",
    });
    expect(d?.fix.summary).toBe(
      'Declare the missing OpenAPI metadata on `@router.post("/orders")`.',
    );
    expect(d?.fix.steps[0]).toBe(
      'Add `summary="..."` (or a docstring) and `status_code=201` to `@router.post("/orders")`, and a return annotation or `response_model=...`.',
    );
  });

  test("the good example reports nothing", async () => {
    expect(await fapi001(GOOD)).toEqual([]);
  });

  test.each([
    ["require-summary = false", "explicit status code or response model"],
    ["require-response-model = false", "summary or explicit status code"],
    ["require-status-code = []", "summary or response model"],
  ])("%s turns its check off", async (option, left) => {
    expect(await fapi001(BAD, option)).toEqual([
      `app/orders.py:6 \`create_order\` (POST /orders) has no ${left} in its OpenAPI metadata.`,
    ]);
  });

  test('a docstring counts as a summary unless require-summary is "summary"', async () => {
    const route = `
@router.get("/orders")
async def list_orders() -> list[OrderOut]:
    """List the orders."""
`;
    expect(await fapi001(route)).toEqual([]);
    expect(await fapi001(route, 'require-summary = "summary"')).toEqual([
      "app/orders.py:6 `list_orders` (GET /orders) has no summary in its OpenAPI metadata.",
    ]);
  });

  test("require-response-fields checks each responses= entry, and [] turns it off", async () => {
    const route = `
@router.get("/orders/{id}", summary="Read", responses={404: {"model": Problem}, "409": {"description": "x"}})
async def read(id: int) -> OrderOut: ...
`;
    expect(await fapi001(route)).toEqual([
      'app/orders.py:6 `read` (GET /orders/{id}) has no "description" in responses[404] in its OpenAPI metadata.',
    ]);
    expect(await fapi001(route, 'require-response-fields = ["description", "model"]')).toEqual([
      'app/orders.py:6 `read` (GET /orders/{id}) has no "description" in responses[404] or "model" in responses["409"] in its OpenAPI metadata.',
    ]);
    expect(await fapi001(route, "require-response-fields = []")).toEqual([]);
  });

  test("a Response return annotation isn't a model, but 204 needs none", async () => {
    const routes = `
@router.get("/a", summary="A")
async def a() -> Response: ...

@router.get("/b", summary="B")
async def b() -> JSONResponse: ...

@router.delete("/c", summary="C", status_code=status.HTTP_204_NO_CONTENT)
async def c() -> Response: ...

@router.get("/d", summary="D", response_model=None)
async def d(): ...
`;
    expect(await fapi001(routes)).toEqual([
      "app/orders.py:6 `a` (GET /a) has no response model in its OpenAPI metadata.",
      "app/orders.py:9 `b` (GET /b) has no response model in its OpenAPI metadata.",
    ]);
  });

  test("require-operation-id and require-tags are off by default", async () => {
    const route = `
@router.get("/orders", summary="List")
async def list_orders() -> list[OrderOut]: ...
`;
    expect(await fapi001(route)).toEqual([]);
    expect(await fapi001(route, "require-operation-id = true\nrequire-tags = true")).toEqual([
      "app/orders.py:6 `list_orders` (GET /orders) has no operation_id or tags in its OpenAPI metadata.",
    ]);
  });

  test("tags on the router, or on an include_router in another file, count", async () => {
    const route = `
@router.get("/orders", summary="List")
async def list_orders() -> list[OrderOut]: ...
`;
    const tagged = HEAD.replace("APIRouter()", 'APIRouter(tags=["orders"])');
    const table = "[tool.inwards.rules.endpoint-metadata]\nrequire-tags = true\n";
    expect(await reported(mountedProject(`${tagged}${route}`, ""), "FAPI001", table)).toEqual([]);
    expect(
      await reported(mountedProject(`${HEAD}${route}`, ', tags=["orders"]'), "FAPI001", table),
    ).toEqual([]);
    expect(await reported(mountedProject(`${HEAD}${route}`, ", **opts"), "FAPI001", table)).toEqual(
      [],
    );
    expect(await reported(mountedProject(`${HEAD}${route}`, ""), "FAPI001", table)).toEqual([
      "app/orders.py:6 `list_orders` (GET /orders) has no tags in its OpenAPI metadata.",
    ]);
  });

  test("skips routes left out of the schema, and decorators it can't read", async () => {
    const routes = `
@router.post("/a", include_in_schema=False)
async def a(): ...

@router.post("/b", **extra)
async def b(): ...
`;
    expect(await fapi001(routes)).toEqual([]);
    const hidden = HEAD.replace("APIRouter()", "APIRouter(include_in_schema=False)");
    const files = { "app/__init__.py": "", "app/orders.py": `${hidden}${BAD}` };
    expect(await reported(files, "FAPI001")).toEqual([]);
  });

  test("skips an app that serves no OpenAPI schema, openapi_url=None", async () => {
    // Polar's server-rendered backoffice (#182 corpus run) is such an app.
    const app = `from fastapi import FastAPI

app = FastAPI(openapi_url=None)


@app.post("/orders")
async def create(): ...
`;
    expect(await reported({ "app/__init__.py": "", "app/main.py": app }, "FAPI001")).toEqual([]);
    const served = app.replace("FastAPI(openapi_url=None)", 'FastAPI(openapi_url="/schema.json")');
    expect(
      await reported({ "app/__init__.py": "", "app/main.py": served }, "FAPI001"),
    ).toHaveLength(1);
  });

  test("api_route checks every method it lists", async () => {
    const route = `
@router.api_route("/orders", methods=["GET", "POST"], summary="Orders")
async def orders() -> OrderOut: ...
`;
    expect(await fapi001(route)).toEqual([
      "app/orders.py:6 `orders` (GET, POST /orders) has no explicit status code in its OpenAPI metadata.",
    ]);
  });

  test("an inline suppression on the decorator line hides the finding", async () => {
    const suppressed = BAD.replace(
      '@router.post("/orders")',
      '@router.post("/orders")  # inwards: ignore[FAPI001] reason="internal endpoint"',
    );
    expect(await fapi001(suppressed)).toEqual([]);
  });
});
