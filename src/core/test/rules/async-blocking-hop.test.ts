/**
 * @file INW013 `async-blocking` one hop out (#294): an `async def` that calls
 * a first-party plain `def` holding a blocking call is reported on the call,
 * naming both functions and where the blocking call lives. The helper may sit
 * in the same module or in another first-party one (through the module index
 * and re-exports), and its receiver may come from its own annotation, from
 * its module, or from the argument the caller passes. Awaited calls, calls
 * handed to a worker thread, `async` and decorated helpers, a second hop, and
 * modules outside `follow-modules` stay quiet.
 */
import { describe, expect, test } from "bun:test";
import { Engine, parseConfig } from "../../src/index.ts";
import { file, grammars, indexOn } from "../support/helpers.ts";

const CONFIG = `[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "application", modules = ["shop.application"] },
  { name = "api", modules = ["shop.api"] },
]

[tool.inwards.rules]
extend-select = ["INW013"]
`;

const WAITS =
  "That blocks the event loop, and every other request on this worker, until the database answers.";

/**
 * Checks the first of a few files with INW013 on and keeps its findings.
 *
 * @param files - each file's text by path; the first one is the one checked.
 * @param options - the `[tool.inwards.rules.async-blocking]` body, TOML.
 * @returns `line:column message` for each INW013 finding.
 */
async function findings(files: Record<string, string>, options = ""): Promise<string[]> {
  const table = options === "" ? "" : `[tool.inwards.rules.async-blocking]\n${options}\n`;
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
    .filter((d) => d.code === "INW013")
    .map((d) => `${d.line}:${d.column} ${d.message}`);
}

const ROUTE = `from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from shop.application import users

router = APIRouter()


@router.post("/users")
async def create(name: str, db: Annotated[Session, Depends(get_db)]):
    return users.create_user(db, name)
`;

const SERVICE = `from sqlalchemy import insert


def create_user(db, name):
    db.add(User(name=name))
    db.execute(insert(Audit))
    db.commit()
    return name
`;

describe("INW013 async-blocking, one hop", () => {
  test("an async route calling a sync service function that runs session.execute() fails, naming both", async () => {
    expect(
      await findings({
        "shop/api/routes.py": ROUTE,
        "shop/application/users.py": SERVICE,
      }),
    ).toEqual([
      `13:12 \`users.create_user\` runs the plain \`def create_user\` (shop/application/users.py, line 4) on the event loop inside \`async def create\`, and \`db.execute\` on line 6 of it, the first of 2 blocking calls, talks to the database through a synchronous SQLAlchemy \`Session\`. ${WAITS}`,
    ]);
  });

  test("the fix names the worker thread, the async helper and the def route", async () => {
    const engine = await Engine.create(grammars(), parseConfig(CONFIG));
    const texts = new Map([
      ["shop/api/routes.py", ROUTE],
      ["shop/application/users.py", SERVICE],
    ]);
    const disk = new Map<string, "file" | "dir">([
      ["shop", "dir"],
      ["shop/api", "dir"],
      ["shop/application", "dir"],
      ["shop/api/routes.py", "file"],
      ["shop/application/users.py", "file"],
    ]);
    const [finding] = engine
      .checkFiles([file("shop/api/routes.py", ROUTE)], indexOn(disk, texts))
      .filter((d) => d.code === "INW013");
    expect(finding?.fix?.summary).toBe(
      "Run `create_user` in a worker thread, make it `async def` with `AsyncSession` from `sqlalchemy.ext.asyncio`, or make `create` a plain `def`.",
    );
    expect(finding?.fix?.steps).toMatchSnapshot();
  });

  test("the same call handed to a worker thread passes", async () => {
    const route = ROUTE.replace(
      "    return users.create_user(db, name)\n",
      `    import asyncio

    import anyio
    from starlette.concurrency import run_in_threadpool

    await run_in_threadpool(users.create_user, db, name)
    await asyncio.to_thread(users.create_user, db, name)
    await anyio.to_thread.run_sync(lambda: users.create_user(db, name))
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, users.create_user, db, name)
`,
    );
    expect(
      await findings({ "shop/api/routes.py": route, "shop/application/users.py": SERVICE }),
    ).toEqual([]);
  });

  test("a same-module helper is followed, and the helper's own annotation counts", async () => {
    const text = `from sqlalchemy import select
from sqlalchemy.orm import Session


def _load(session: Session, order_id):
    return session.scalar(select(Order).where(Order.id == order_id))


async def get_order(order_id: int, db):
    order = _load(db, order_id)
    return order
`;
    expect(await findings({ "shop/api/orders.py": text })).toEqual([
      `10:13 \`_load\` runs the plain \`def _load\` (line 5) on the event loop inside \`async def get_order\`, and \`session.scalar\` on line 6 of it talks to the database through a synchronous SQLAlchemy \`Session\`. ${WAITS}`,
    ]);
  });

  test("a client the helper's module binds counts, though the route names no library", async () => {
    const route = `from shop.application.cache import remember


async def hit(key: str):
    remember(key)
`;
    const cache = `import redis

client = redis.Redis()


def remember(key):
    client.set(key, 1)
`;
    const found = await findings({
      "shop/api/hits.py": route,
      "shop/application/cache.py": cache,
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(
      "`remember` runs the plain `def remember` (shop/application/cache.py, line 6) on the event loop inside `async def hit`, and `client.set` on line 7 of it sends a command through a synchronous Redis client.",
    );
  });

  test("an awaited call, an async helper and a decorated helper aren't followed", async () => {
    const text = `from functools import lru_cache

from sqlalchemy import select
from sqlalchemy.orm import Session


def _load(db: Session):
    return db.scalar(select(Order))


async def _aload(db: Session):
    return 1


@lru_cache
def _cached(db: Session):
    return db.scalar(select(Order))


async def get_order(db):
    await _load(db)
    await _aload(db)
    return _cached(db)
`;
    expect(await findings({ "shop/api/orders.py": text })).toEqual([]);
  });

  test("only one hop: a helper's own helper isn't followed", async () => {
    const text = `from sqlalchemy import select
from sqlalchemy.orm import Session


def _inner(db: Session):
    return db.scalar(select(Order))


def _outer(db):
    return _inner(db)


async def get_order(db: Session):
    return _outer(db)
`;
    expect(await findings({ "shop/api/orders.py": text })).toEqual([]);
  });

  test("an untyped argument into an untyped parameter says nothing", async () => {
    const route = ROUTE.replace("db: Annotated[Session, Depends(get_db)]", "db=Depends(get_db)");
    expect(
      await findings({ "shop/api/routes.py": route, "shop/application/users.py": SERVICE }),
    ).toEqual([]);
  });

  test("a keyword argument passes the receiver too", async () => {
    const route = ROUTE.replace(
      "users.create_user(db, name)",
      "users.create_user(name=name, db=db)",
    );
    expect(
      await findings({ "shop/api/routes.py": route, "shop/application/users.py": SERVICE }),
    ).toHaveLength(1);
  });

  test("follows a re-export to the helper's module", async () => {
    const route = ROUTE.replace(
      "from shop.application import users",
      "from shop.application import create_user",
    ).replace("users.create_user(db, name)", "create_user(db, name)");
    const found = await findings({
      "shop/api/routes.py": route,
      "shop/application/__init__.py": "from shop.application.users import create_user\n",
      "shop/application/users.py": SERVICE,
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("(shop/application/users.py, line 4)");
    const scoped = await findings(
      {
        "shop/api/routes.py": route,
        "shop/application/__init__.py": "from shop.application.users import create_user\n",
        "shop/application/users.py": SERVICE,
      },
      'follow-modules = ["shop.*.users"]',
    );
    expect(scoped).toEqual(found);
  });

  test("follow-modules limits the modules read; an empty list keeps to the checked module", async () => {
    const files = { "shop/api/routes.py": ROUTE, "shop/application/users.py": SERVICE };
    expect(await findings(files, 'follow-modules = ["shop.domain"]')).toEqual([]);
    expect(await findings(files, 'follow-modules = ["shop.*.users"]')).toHaveLength(1);
    expect(await findings(files, 'follow-modules = ["shop.application"]')).toHaveLength(1);
    expect(await findings(files, "follow-modules = []")).toEqual([]);
  });

  test("a module outside follow-modules is never read", async () => {
    const read: string[] = [];
    /** Records every file the index reads. */
    class Recording extends Map<string, string> {
      /**
       * Reads a file's text and records its path.
       *
       * @param key - the file's path.
       * @returns its text.
       */
      override get(key: string): string | undefined {
        read.push(key);
        return super.get(key);
      }
    }
    const texts = new Recording([
      ["shop/api/routes.py", ROUTE],
      ["shop/application/users.py", SERVICE],
    ]);
    const engine = await Engine.create(
      grammars(),
      parseConfig(
        `${CONFIG}[tool.inwards.rules.async-blocking]\nfollow-modules = ["shop.domain"]\n`,
      ),
    );
    const disk = new Map<string, "file" | "dir">([
      ["shop", "dir"],
      ["shop/api", "dir"],
      ["shop/application", "dir"],
      ["shop/api/routes.py", "file"],
      ["shop/application/users.py", "file"],
    ]);
    engine.checkFiles([file("shop/api/routes.py", ROUTE)], indexOn(disk, texts));
    expect(read).not.toContain("shop/application/users.py");
  });

  test("a direct blocking call and a followed one both report", async () => {
    const route = ROUTE.replace(
      "    return users.create_user(db, name)\n",
      "    db.flush()\n    return users.create_user(db, name)\n",
    );
    const found = await findings({
      "shop/api/routes.py": route,
      "shop/application/users.py": SERVICE,
    });
    expect(found.map((f) => f.split(" ")[0])).toEqual(["13:5", "14:12"]);
  });

  test("a helper call inside a nested def or lambda isn't followed", async () => {
    const route = ROUTE.replace(
      "    return users.create_user(db, name)\n",
      "    def work():\n        return users.create_user(db, name)\n    return work\n",
    );
    expect(
      await findings({ "shop/api/routes.py": route, "shop/application/users.py": SERVICE }),
    ).toEqual([]);
  });

  test("a third-party or missing callee is not followed", async () => {
    const route = `from somewhere.else import create_user
from shop.application.missing import gone


async def create(db):
    create_user(db)
    gone(db)
`;
    expect(await findings({ "shop/api/routes.py": route })).toEqual([]);
  });
});
