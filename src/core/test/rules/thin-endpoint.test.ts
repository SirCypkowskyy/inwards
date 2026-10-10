/**
 * @file INW012 `thin-endpoint` (#182): a FastAPI endpoint that holds the
 * feature (statements, branches, loops, session and HTTP calls of its own, no
 * call into `delegate-to`) gets one warning on its `def` line that lists every
 * tripped signal; the thin version of the same endpoint, a plain function
 * with the same body, guards that map errors to HTTP, and endpoints outside
 * `modules` report nothing. It is opt-in, takes custom decorators, and a
 * suppression on the `def` line hides it.
 */
import { describe, expect, test } from "bun:test";
import type { Diagnostic } from "../../src/index.ts";
import { Engine, parseConfig } from "../../src/index.ts";
import { file, grammars, indexOn } from "../support/helpers.ts";

const LAYERS = `[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "application", modules = ["shop.application"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
  { name = "api", modules = ["shop.api"] },
]
`;

const HEAD = `from decimal import Decimal
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shop.application.orders import PlaceOrder, OutOfStock, place_order
from shop.infrastructure.db import get_db, get_place_order

router = APIRouter()
`;

const FAT = `
@router.post("/orders", status_code=201)
async def create_order(body: OrderIn, db: Annotated[AsyncSession, Depends(get_db)]) -> OrderOut:
    customer = (await db.execute(select(Customer).where(Customer.id == body.customer_id))).scalar_one_or_none()
    if customer is None:
        raise HTTPException(404, "customer not found")
    total = Decimal(0)
    for line in body.lines:
        product = await db.get(Product, line.product_id)
        if product.stock < line.qty:
            raise HTTPException(409, "out of stock")
        product.stock -= line.qty
        total += product.price * line.qty
    if customer.is_vip:
        total *= Decimal("0.9")
    order = Order(customer_id=customer.id, total=total)
    db.add(order)
    await db.commit()
    httpx.post(settings.WEBHOOK_URL, json={"order": order.id})
    return OutOut.model_validate(order)
`;

const THIN = `
@router.post("/orders", status_code=201)
async def create_order(body: OrderIn, place_order: Annotated[PlaceOrder, Depends(get_place_order)]) -> OrderOut:
    try:
        order = await place_order(body.to_command())
    except OutOfStock as e:
        raise HTTPException(409, str(e)) from e
    return OrderOut.from_domain(order)
`;

/**
 * Checks `shop/api/orders.py` with a `[tool.inwards.rules]` body.
 *
 * @param body - the module after its imports and `router = APIRouter()`.
 * @param rules - the rules table's body and any options tables, TOML.
 * @param path - where the module lives.
 * @returns every diagnostic.
 */
async function check(
  body: string,
  rules: string,
  path = "shop/api/orders.py",
): Promise<Diagnostic[]> {
  const engine = await Engine.create(grammars(), parseConfig(`${LAYERS}\n${rules}\n`));
  const files = new Map([[path, `${HEAD}${body}`]]);
  const kinds = new Map<string, "file" | "dir">([[path, "file"]]);
  return engine.checkFiles([file(path, `${HEAD}${body}`)], indexOn(kinds, files));
}

/**
 * Checks a module with INW012 on and keeps its findings.
 *
 * @param body - the module after its imports.
 * @param options - the `[tool.inwards.rules.thin-endpoint]` body, TOML.
 * @param path - where the module lives.
 * @returns `line severity message` for each INW012 finding.
 */
async function inw012(body: string, options = "", path?: string): Promise<string[]> {
  const table = options === "" ? "" : `[tool.inwards.rules.thin-endpoint]\n${options}\n`;
  const found = await check(
    body,
    `[tool.inwards.rules]\nextend-select = ["INW012"]\n${table}`,
    path,
  );
  return found
    .filter((d) => d.code === "INW012")
    .map((d) => `${d.line} ${d.severity} ${d.message}`);
}

const TAIL = "Endpoints parse the request, call one use case, and shape the response.";

/** A fat endpoint in a package-per-domain layout, as the \`fastapi\` preset scaffolds it. */
const DOMAIN_ROUTER = `from fastapi import APIRouter

router = APIRouter()


@router.get("/{post_id}/words")
async def count_words(post_id: int) -> dict[str, int]:
    counts: dict[str, int] = {}
    for word in str(post_id).split():
        counts[word] = counts.get(word, 0) + 1
    return counts
`;

/**
 * Checks \`DOMAIN_ROUTER\` as \`src/posts/router.py\`, with selector layers
 * per domain like the \`fastapi\` preset's template, and one \`delegate-to\` entry.
 *
 * @param delegate - the \`delegate-to\` entry: a layer name or a selector.
 * @returns the INW012 finding.
 */
async function perDomain(delegate: string): Promise<Diagnostic | undefined> {
  const config = `[tool.inwards]
layers = [
  { name = "domain.service", modules = ["src.*.service"] },
  { name = "domain.router", modules = ["src.*.router"] },
]

[tool.inwards.rules]
extend-select = ["INW012"]

[tool.inwards.rules.thin-endpoint]
delegate-to = ["${delegate}"]
`;
  const path = "src/posts/router.py";
  const engine = await Engine.create(grammars(), parseConfig(config));
  const [found] = engine.checkFiles(
    [file(path, DOMAIN_ROUTER)],
    indexOn(new Map([[path, "file"]]), new Map([[path, DOMAIN_ROUTER]])),
  );
  return found;
}

describe("INW012 thin-endpoint", () => {
  test("is off by default", async () => {
    expect((await check(FAT, "")).filter((d) => d.code === "INW012")).toEqual([]);
  });

  test("reports the fat handler once, on its def line, with every signal", async () => {
    expect(await inw012(FAT)).toEqual([
      `15 warning \`create_order\` is an HTTP endpoint with 13 statements (max 10), 1 loop over data and direct calls (\`db.execute\`, \`select\`, \`db.get\`, \`db.add\`, \`db.commit\`, \`httpx.post\`). ${TAIL}`,
    ]);
  });

  test("passes the thin handler", async () => {
    expect(await inw012(THIN)).toEqual([]);
    expect(await inw012(THIN, 'delegate-to = ["application"]')).toEqual([]);
  });

  test("passes a function that isn't an endpoint, with the same body", async () => {
    expect(await inw012(FAT.replace('@router.post("/orders", status_code=201)\n', ""))).toEqual([]);
  });

  test("doesn't count guards or handlers that map errors to HTTP", async () => {
    const guards = `
@router.get("/orders/{id}")
async def read(id: int, place_order: Annotated[PlaceOrder, Depends(get_place_order)]):
    """Reads an order."""
    if id < 0:
        raise HTTPException(400, "negative id")
    if id == 0:
        raise HTTPException(404)
    try:
        order = await place_order(id)
    except OutOfStock as e:
        raise HTTPException(409) from e
    except KeyError:
        raise HTTPException(404)
    return order
`;
    expect(await inw012(guards, "max-statements = 3\nmax-branches = 0\nmax-nesting = 1")).toEqual(
      [],
    );
    expect(await inw012(guards, "max-statements = 2")).toEqual([
      `15 warning \`read\` is an HTTP endpoint with 3 statements (max 2). ${TAIL}`,
    ]);
  });

  test("counts branches, nesting and loops, each against its own limit", async () => {
    const body = `
@router.get("/")
async def report(rows: list[int]):
    if rows:
        for row in rows:
            with lock:
                total = row
    elif total:
        match total:
            case 1:
                pass
            case _:
                pass
    while False:
        pass
    return [r for r in rows]
`;
    expect(await inw012(body)).toEqual([
      `15 warning \`report\` is an HTTP endpoint with 4 branches (max 2), 3 levels of nested blocks (max 2) and 2 loops over data. ${TAIL}`,
    ]);
    const loose =
      "max-statements = false\nmax-branches = 4\nmax-nesting = 3\nallow-loops = true\nallow-comprehensions = false";
    expect(await inw012(body, loose)).toEqual([]);
    expect(
      await inw012(
        body,
        "max-statements = false\nmax-branches = false\nmax-nesting = false\nallow-comprehensions = false",
      ),
    ).toEqual([`15 warning \`report\` is an HTTP endpoint with 3 loops over data. ${TAIL}`]);
  });

  test("counts a nested function as one statement and skips its body", async () => {
    const body = `
@router.get("/")
async def nested():
    def helper():
        for i in range(10):
            httpx.get(str(i))
    return helper
`;
    expect(await inw012(body)).toEqual([]);
  });

  test("reads session types through aliases, Optional and | None, and untyped names", async () => {
    const body = `
DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.get("/a")
async def a(db: DbSession):
    return await db.get(Order, 1)


@router.get("/b")
async def b(db: AsyncSession | None = None):
    return await db.scalar(1)


@router.get("/c")
async def c(session):
    return session.query(Order).all()
`;
    expect(await inw012(body)).toEqual([
      `18 warning \`a\` is an HTTP endpoint with a direct call to \`db.get\`. ${TAIL}`,
      `23 warning \`b\` is an HTTP endpoint with a direct call to \`db.scalar\`. ${TAIL}`,
    ]);
    expect(await inw012(body, 'deny-receiver-params = ["session"]')).toContain(
      `28 warning \`c\` is an HTTP endpoint with a direct call to \`session.query\`. ${TAIL}`,
    );
  });

  test("deny-calls replaces the default list and extend-deny-calls adds to it", async () => {
    const body = `
from shop.infrastructure import stripe


@router.post("/pay")
async def pay():
    stripe.charge(1)
    return httpx.post("https://example.com")
`;
    expect(await inw012(body)).toEqual([
      `18 warning \`pay\` is an HTTP endpoint with a direct call to \`httpx.post\`. ${TAIL}`,
    ]);
    expect(await inw012(body, 'extend-deny-calls = ["shop.infrastructure.stripe.*"]')).toEqual([
      `18 warning \`pay\` is an HTTP endpoint with direct calls (\`stripe.charge\`, \`httpx.post\`). ${TAIL}`,
    ]);
    expect(await inw012(body, "deny-calls = []")).toEqual([]);
  });

  test("delegate-to reports a handler that calls nothing from the target", async () => {
    const body = `
@router.get("/health")
async def health():
    return {"ok": True}


@router.post("/direct")
async def direct(body: OrderIn):
    return await place_order(body)
`;
    expect(await inw012(body, 'delegate-to = ["application"]')).toEqual([
      `15 warning \`health\` is an HTTP endpoint with no call into the \`application\` layer (\`shop.application\`). ${TAIL}`,
    ]);
    expect(await inw012(body, 'delegate-to = ["shop.*.orders"]')).toEqual([
      `15 warning \`health\` is an HTTP endpoint with no call into a module matching \`shop.*.orders\`. ${TAIL}`,
    ]);
    expect(await inw012(body, 'delegate-to = ["infrastructure"]')).toHaveLength(2);
  });

  test("the fix names the target from delegate-to and the moved calls", async () => {
    const engine = await Engine.create(
      grammars(),
      parseConfig(
        `${LAYERS}\n[tool.inwards.rules]\nextend-select = ["INW012"]\n[tool.inwards.rules.thin-endpoint]\ndelegate-to = ["application"]\n`,
      ),
    );
    const path = "shop/api/orders.py";
    const [found] = engine.checkFiles(
      [file(path, `${HEAD}${FAT}`)],
      indexOn(new Map([[path, "file"]]), new Map([[path, `${HEAD}${FAT}`]])),
    );
    expect(found?.message).toContain(
      "and no call into the `application` layer (`shop.application`).",
    );
    expect(found?.fix).toMatchSnapshot();
  });

  test("the fix names the concrete module a selector target or layer has for the endpoint's package", async () => {
    const layer = await perDomain("domain.service");
    expect(layer?.message).toContain(
      "and no call into the `domain.service` layer (`src.posts.service`).",
    );
    expect(layer?.fix?.summary).toBe(
      "Move the work out of `count_words` into the `domain.service` layer (`src.posts.service`), and keep the endpoint to HTTP.",
    );
    expect(layer?.fix?.steps[0]).toContain(
      "into a function in the `domain.service` layer (`src.posts.service`) that",
    );
    expect((await perDomain("src.*.service"))?.fix?.summary).toBe(
      "Move the work out of `count_words` into `src.posts.service` (a module matching `src.*.service`), and keep the endpoint to HTTP.",
    );
    expect((await perDomain("lib.*.service"))?.fix?.summary).toBe(
      "Move the work out of `count_words` into a module matching `lib.*.service`, and keep the endpoint to HTTP.",
    );
  });

  test("a custom decorator marks an endpoint", async () => {
    const body = `
from shop.api.http import endpoint


@endpoint("/legacy")
def legacy():
    return httpx.get("https://example.com")
`;
    expect(await inw012(body)).toEqual([]);
    expect(await inw012(body, 'decorators = ["shop.api.http.endpoint"]')).toEqual([
      `18 warning \`legacy\` is an HTTP endpoint with a direct call to \`httpx.get\`. ${TAIL}`,
    ]);
    expect(await inw012(body, 'decorators = ["*.endpoint"]')).toHaveLength(1);
  });

  test("a custom decorator works in a file that doesn't mention FastAPI", async () => {
    const engine = await Engine.create(
      grammars(),
      parseConfig(
        `${LAYERS}\n[tool.inwards.rules]\nextend-select = ["INW012"]\n[tool.inwards.rules.thin-endpoint]\ndecorators = ["shop.api.http.endpoint"]\n`,
      ),
    );
    const path = "shop/api/legacy.py";
    const text =
      'import requests\nfrom shop.api.http import endpoint\n\n\n@endpoint\ndef legacy():\n    return requests.get("x")\n';
    const found = engine.checkFiles(
      [file(path, text)],
      indexOn(new Map([[path, "file"]]), new Map([[path, text]])),
    );
    expect(found.map((d) => `${d.code}:${d.line}`)).toEqual(["INW012:6"]);
  });

  test("an imported router counts, a local object that isn't one doesn't", async () => {
    const body = `
from shop.api.routers import orders_router

cache = make_cache()


@orders_router.get("/a")
async def a():
    return httpx.get("x")


@cache.get("/b")
def b():
    return httpx.get("x")
`;
    expect(await inw012(body)).toEqual([
      `20 warning \`a\` is an HTTP endpoint with a direct call to \`httpx.get\`. ${TAIL}`,
    ]);
  });

  test("leaves websocket routes alone", async () => {
    const body = `
@router.websocket("/ws")
async def ws(socket):
    while True:
        await socket.send_text(httpx.get("x").text)
`;
    expect(await inw012(body)).toEqual([]);
  });

  test("a suppression on the def line hides it", async () => {
    const body = FAT.replace(
      "-> OrderOut:",
      '-> OrderOut:  # inwards: ignore[INW012] reason="legacy endpoint, ticket 42"',
    );
    expect(await inw012(body)).toEqual([]);
  });

  test("severity and modules apply", async () => {
    const rules =
      '[tool.inwards.rules]\nextend-select = ["INW012"]\nseverity = { INW012 = "error" }';
    expect((await check(FAT, rules)).map((d) => `${d.code}:${d.severity}`)).toEqual([
      "INW012:error",
    ]);
    const scoped = `${rules}\n[tool.inwards.rules.thin-endpoint]\nmodules = ["shop.api.admin"]`;
    expect(await check(FAT, scoped)).toEqual([]);
  });

  test("a per-edit check reports it too", async () => {
    const engine = await Engine.create(
      grammars(),
      parseConfig(`${LAYERS}\n[tool.inwards.rules]\nextend-select = ["INW012"]\n`),
    );
    const path = "shop/api/orders.py";
    const text = `${HEAD}${FAT}`;
    const found = engine.checkFile(
      file(path, text),
      indexOn(new Map([[path, "file"]]), new Map([[path, text]])),
    );
    expect(found.map((d) => `${d.code}:${d.line}`)).toEqual(["INW012:15"]);
  });
});
