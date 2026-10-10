/**
 * @file FAPI009 `depends-called` (#228): `Depends(f())` or `Security(f())`
 * where `f` is a first-party generator, async function or function that
 * returns a plain value is reported, in a default and in `Annotated`. A
 * factory that returns a function passes, as does a callee Inwards can't read.
 */
import { describe, expect, test } from "bun:test";
import { checkProject, reported } from "./fixture.ts";

const HEAD = `from typing import Annotated

from fastapi import APIRouter, Depends, Security

from app.deps import get_db, get_settings, require_role

router = APIRouter()
`;
const DEPS = `def get_db():
    db = open_session()
    try:
        yield db
    finally:
        db.close()


def get_settings():
    return {"debug": True}


def require_role(role):
    def check(user=Depends(get_user)):
        return user

    return check
`;

/**
 * Checks a router module and a dependencies module with FAPI009 on.
 *
 * @param route - the route(s) after the router.
 * @param deps - the dependencies module's text.
 * @param head - the router module's imports.
 * @returns `path:line message` for each FAPI009 finding.
 */
function fapi009(route: string, deps = DEPS, head = HEAD): Promise<string[]> {
  return reported(
    { "app/__init__.py": "", "app/deps.py": deps, "app/users.py": `${head}\n\n${route}\n` },
    "FAPI009",
  );
}

describe("FAPI009", () => {
  test("is off by default", async () => {
    const files = {
      "app/__init__.py": "",
      "app/deps.py": DEPS,
      "app/users.py": `${HEAD}\n\n@router.get("/")\nasync def a(db: Annotated[object, Depends(get_db())]): ...\n`,
    };
    expect(await checkProject(files, "")).toEqual([]);
  });

  test("reports Annotated[Session, Depends(get_db())] with a generator get_db", async () => {
    const found = await fapi009(
      '@router.get("/")\nasync def a(db: Annotated[object, Depends(get_db())]): ...',
    );
    expect(found).toEqual([
      "app/users.py:11 `Depends(get_db())` calls `get_db` once, when the module is imported, and passes its result: `get_db` is a generator function (the call returns a generator object), so FastAPI never gets a function to call per request.",
    ]);
  });

  test("reports a default, Security and the dependencies= list", async () => {
    const found = await fapi009(`@router.get("/", dependencies=[Depends(get_db())])
async def a(db=Depends(get_db()), s=Security(get_settings())): ...`);
    expect(found.map((f) => f.slice(0, 22))).toEqual([
      "app/users.py:10 `Depen",
      "app/users.py:11 `Depen",
      "app/users.py:11 `Secur",
    ]);
  });

  test("passes a factory that returns an inner function", async () => {
    expect(
      await fapi009('@router.get("/")\nasync def a(user=Depends(require_role("admin"))): ...'),
    ).toEqual([]);
  });

  test("passes Depends(get_db), a lambda, and a callee Inwards cannot read", async () => {
    const found = await fapi009(`@router.get("/")
async def a(
    db=Depends(get_db),
    x=Depends(lambda: 1),
    y=Depends(unknown_helper()),
    z=Depends(dict()),
): ...`);
    expect(found).toEqual([]);
  });

  test("reports an async function and one that returns nothing, passes unknown returns", async () => {
    const deps = `async def fetch():
    return load


def nothing():
    pass


def maybe():
    return build()


@cache
def cached():
    return 1
`;
    const head = HEAD.replace(
      "get_db, get_settings, require_role",
      "cached, fetch, maybe, nothing",
    );
    const found = await fapi009(
      '@router.get("/")\nasync def a(a=Depends(fetch()), b=Depends(nothing()), c=Depends(maybe()), d=Depends(cached())): ...',
      deps,
      head,
    );
    expect(found).toHaveLength(2);
    expect(found[0]).toContain("`fetch` is an async function");
    expect(found[1]).toContain("`nothing` returns nothing");
  });

  test("follows the callee through a module attribute", async () => {
    const head = HEAD.replace(
      "from app.deps import get_db, get_settings, require_role",
      "from app import deps",
    );
    const found = await fapi009(
      '@router.get("/")\nasync def a(db=Depends(deps.get_db())): ...',
      DEPS,
      head,
    );
    expect(found).toHaveLength(1);
  });

  test("an inline suppression on the line hides the finding", async () => {
    const found = await fapi009(
      '@router.get("/")\nasync def a(db=Depends(get_db())):  # inwards: ignore[FAPI009] reason="wrapped later"\n    ...',
    );
    expect(found).toEqual([]);
  });
});
