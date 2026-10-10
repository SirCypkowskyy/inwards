/**
 * @file INW013 `async-blocking` (#293, from #98): synchronous database, cache
 * and cloud calls inside an `async def` are errors, on the call. A sync
 * SQLAlchemy `Session` parameter, a module-level `redis.Redis()` or
 * `boto3.client()`, a blocking driver's `connect`, and the configured extra
 * calls and types report; the same call in a plain `def`, in a nested `def`
 * or `lambda`, on an `AsyncSession`, or a method that does no I/O does not.
 * It is opt-in, `modules` narrows it, and a suppression hides it.
 */
import { describe, expect, test } from "bun:test";
import type { Diagnostic } from "../../src/index.ts";
import { Engine, parseConfig } from "../../src/index.ts";
import { file, grammars, indexOn } from "../support/helpers.ts";

const LAYERS = `[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "api", modules = ["shop.api"] },
]
`;

const HEAD = `from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

router = APIRouter()
`;

/**
 * Checks `shop/api/orders.py` with a rules table.
 *
 * @param body - the module after `HEAD`.
 * @param rules - the rules table and any options tables, TOML.
 * @param path - where the module lives.
 * @returns every diagnostic.
 */
async function check(
  body: string,
  rules: string,
  path = "shop/api/orders.py",
): Promise<Diagnostic[]> {
  const engine = await Engine.create(grammars(), parseConfig(`${LAYERS}\n${rules}\n`));
  const text = `${HEAD}${body}`;
  const files = new Map([[path, text]]);
  const kinds = new Map<string, "file" | "dir">([[path, "file"]]);
  return engine.checkFiles([file(path, text)], indexOn(kinds, files));
}

/**
 * Checks a module with INW013 on and keeps its findings.
 *
 * @param body - the module after `HEAD`.
 * @param options - the `[tool.inwards.rules.async-blocking]` body, TOML.
 * @param path - where the module lives.
 * @returns `line:column severity message` for each INW013 finding.
 */
async function inw013(body: string, options = "", path?: string): Promise<string[]> {
  const table = options === "" ? "" : `[tool.inwards.rules.async-blocking]\n${options}\n`;
  const found = await check(
    body,
    `[tool.inwards.rules]\nextend-select = ["INW013"]\n${table}`,
    path,
  );
  return found
    .filter((d) => d.code === "INW013")
    .map((d) => `${d.line}:${d.column} ${d.severity} ${d.message}`);
}

/** The line in `HEAD` + body where a body's first line lands. */
const FIRST: number = HEAD.split("\n").length;

const SYNC_SESSION = `
@router.get("/orders/{order_id}")
async def get_order(order_id: int, db: Annotated[Session, Depends(get_db)]):
    db.add(Order())
    return db.execute(select(Order).where(Order.id == order_id)).scalar_one()
`;

describe("INW013 async-blocking", () => {
  test("is off unless selected", async () => {
    const found = await check(SYNC_SESSION, "");
    expect(found.filter((d) => d.code === "INW013")).toEqual([]);
  });

  test("a sync Session call in an async def route is an error on the call; add() isn't", async () => {
    expect(await inw013(SYNC_SESSION)).toEqual([
      `${FIRST + 4}:12 error \`db.execute\` talks to the database through a synchronous SQLAlchemy \`Session\` inside \`async def get_order\`. That blocks the event loop, and every other request on this worker, until the database answers.`,
    ]);
  });

  test("the same call in a plain def route passes: FastAPI runs it in a threadpool", async () => {
    const body = SYNC_SESSION.replace("async def", "def");
    expect(await inw013(body)).toEqual([]);
  });

  test("an AsyncSession parameter passes", async () => {
    const body = `
from sqlalchemy.ext.asyncio import AsyncSession

async def get_order(db: AsyncSession):
    return await db.execute(select(Order))
`;
    expect(await inw013(body)).toEqual([]);
  });

  test("Optional, union and same-file alias annotations are read", async () => {
    const body = `
DbSession = Annotated[Session, Depends(get_db)]

async def one(db: DbSession):
    db.commit()

async def two(db: Session | None = None):
    db.flush()
`;
    expect((await inw013(body)).map((f) => f.split(" ")[0])).toEqual([
      `${FIRST + 4}:5`,
      `${FIRST + 7}:5`,
    ]);
  });

  test("calls inside a nested def, a lambda or a class body pass", async () => {
    const body = `
import anyio

async def get_order(db: Session):
    def load():
        return db.execute(select(Order))
    rows = await anyio.to_thread.run_sync(load)
    more = await anyio.to_thread.run_sync(lambda: db.scalars(select(Order)))
    return rows, more
`;
    expect(await inw013(body)).toEqual([]);
  });

  test("a with-bound Session and an inline Session report", async () => {
    const body = `
async def report(engine):
    with Session(engine) as session:
        session.commit()
    Session(engine).scalar(select(Order))
`;
    expect((await inw013(body)).map((f) => f.split(" ")[0])).toEqual([
      `${FIRST + 3}:9`,
      `${FIRST + 4}:5`,
    ]);
  });

  test("module-level redis and boto3 clients report; presigned URLs and pipelines don't", async () => {
    const body = `
import boto3
import redis

cache = redis.Redis(host="localhost")
s3 = boto3.client("s3")

async def upload(key: str, data: bytes):
    cache.set(key, 1)
    pipe = cache.pipeline()
    s3.put_object(Bucket="b", Key=key, Body=data)
    return s3.generate_presigned_url("get_object", Params={"Key": key})
`;
    const found = await inw013(body);
    expect(found.map((f) => f.split(" ")[0])).toEqual([`${FIRST + 8}:5`, `${FIRST + 10}:5`]);
    expect(found[0]).toContain("`cache.set` sends a command through a synchronous Redis client");
    expect(found[1]).toContain("`s3.put_object` calls AWS through a synchronous boto3 client");
  });

  test("a blocking driver's connect and its connection report once per call", async () => {
    const body = `
import sqlite3

async def count():
    conn = sqlite3.connect("app.db")
    return conn.execute("select count(*) from t").fetchone()
`;
    const found = await inw013(body);
    expect(found.map((f) => f.split(" ")[0])).toEqual([`${FIRST + 4}:12`, `${FIRST + 5}:12`]);
    expect(found[0]).toContain("`sqlite3.connect` opens a synchronous database connection");
  });

  test("an import alias still resolves", async () => {
    const body = `
from redis import Redis as Cache

async def hit(cache: Cache):
    cache.incr("hits")
`;
    expect(await inw013(body)).toHaveLength(1);
  });

  test("extend-blocking-calls and extend-blocking-types add to the defaults", async () => {
    const body = `
from shop.legacy import Client, fetch_all

async def sync_up(client: Client):
    client.push()
    fetch_all()
`;
    const options = `extend-blocking-calls = ["shop.legacy.fetch_*"]
extend-blocking-types = ["shop.legacy.Client"]`;
    const found = await inw013(body, options);
    expect(found.map((f) => f.split(" ")[0])).toEqual([`${FIRST + 4}:5`, `${FIRST + 5}:5`]);
    expect(found[0]).toContain(
      "`client.push` calls a method of `shop.legacy.Client`, which `extend-blocking-types` marks as blocking,",
    );
    expect(found[1]).toContain(
      "`fetch_all` calls `shop.legacy.fetch_all`, which `extend-blocking-calls` marks as blocking,",
    );
  });

  test("an engine, an async method and a parameter that shadows a module client", async () => {
    const body = `
import redis
from sqlalchemy import create_engine

engine = cache = create_engine("sqlite://")
client = redis.Redis()

class Repo:
    async def count(self):
        with engine.connect() as conn:
            return conn.execution_options(x=1)

async def fresh(client):
    client.get("k")
`;
    const found = await inw013(body);
    expect(found.map((f) => f.split(" ")[0])).toEqual([`${FIRST + 9}:14`]);
    expect(found[0]).toContain(
      "`engine.connect` talks to the database through a synchronous SQLAlchemy `Engine` or `Connection` inside `async def count`",
    );
  });

  test("modules narrows the rule", async () => {
    expect(await inw013(SYNC_SESSION, 'modules = ["shop.domain"]')).toEqual([]);
  });

  test("the fix names the async replacement and the def alternative", async () => {
    const found = await check(SYNC_SESSION, '[tool.inwards.rules]\nextend-select = ["INW013"]');
    const [finding] = found.filter((d) => d.code === "INW013");
    expect(finding?.fix?.summary).toBe(
      "Use `AsyncSession` from `sqlalchemy.ext.asyncio` and await the call, or make `get_order` a plain `def`.",
    );
    expect(finding?.fix?.steps).toMatchSnapshot();
  });

  test("an inline suppression hides it", async () => {
    const body = SYNC_SESSION.replace(
      "scalar_one()",
      'scalar_one()  # inwards: ignore[INW013] reason="legacy route, moving to AsyncSession"',
    );
    expect(await inw013(body)).toEqual([]);
  });

  test("a file that mentions no blocking library is not reported", async () => {
    const body = `
async def ping(db):
    db.execute("select 1")
`;
    const engine = await Engine.create(
      grammars(),
      parseConfig(`${LAYERS}\n[tool.inwards.rules]\nextend-select = ["INW013"]\n`),
    );
    const path = "shop/api/ping.py";
    const files = new Map([[path, body]]);
    const kinds = new Map<string, "file" | "dir">([[path, "file"]]);
    const found = engine.checkFiles([file(path, body)], indexOn(kinds, files));
    expect(found.filter((d) => d.code === "INW013")).toEqual([]);
  });
});
