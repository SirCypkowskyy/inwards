/**
 * @file FAPI009 `depends-called` (#228): `Annotated[Session, Depends(get_db())]`
 * with a generator `get_db` reports, and `Depends(require_role("admin"))`
 * with a factory that returns an inner function passes. Coroutines, plain
 * values, classes, one hop through the index, `Security` and
 * `dependencies=[...]` are covered, and a parameter default reports only with
 * `check-defaults`, since Ruff's B008 already does.
 */
import { describe, expect, test } from "bun:test";
import { checkProject, reported } from "./fixture.ts";

const DEPS = `class Settings:
    debug = False


class Checker:
    def __call__(self): ...


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


async def current_user():
    return User()


def get_settings():
    return Settings()


def get_limit():
    return 10


def require_role(role):
    def check(user=None):
        return user
    return check


def checker():
    return Checker()


def opaque():
    return build()
`;

/**
 * Checks a router module with FAPI009 on, next to `app/deps.py`.
 *
 * @param body - the route module's lines after its imports.
 * @param options - the options table's body, TOML.
 * @returns `line message` for each FAPI009 finding in the route module.
 */
async function fapi009(body: string, options = ""): Promise<string[]> {
  const head = `from typing import Annotated

from fastapi import APIRouter, Depends, Security

from app.deps import *
from app import deps

router = APIRouter()
`;
  const table = options === "" ? "" : `[tool.inwards.rules.depends-called]\n${options}\n`;
  const found = await reported(
    { "app/__init__.py": "", "app/deps.py": DEPS, "app/routes.py": `${head}${body}` },
    "FAPI009",
    table,
  );
  return found.map((line) => line.replace("app/routes.py:", ""));
}

describe("FAPI009", () => {
  test("is off by default", async () => {
    const files = {
      "app/__init__.py": "",
      "app/deps.py": DEPS,
      "app/routes.py":
        "from typing import Annotated\nfrom fastapi import Depends\nfrom app.deps import get_db\n\ndef ep(db: Annotated[int, Depends(get_db())]): ...\n",
    };
    expect(await checkProject(files, "")).toEqual([]);
  });

  test("reports a generator called in Annotated metadata, through the index", async () => {
    expect(
      await fapi009(
        '\n@router.get("/")\ndef ep(db: Annotated[Session, Depends(deps.get_db())]): ...\n',
      ),
    ).toEqual([
      "11 `Depends(deps.get_db())` calls `deps.get_db` where the route is declared and passes FastAPI the generator it returns, which FastAPI can't call as a dependency.",
    ]);
  });

  test("passes a factory that returns an inner function, a class instance with __call__, and what it can't read", async () => {
    const body = `
@router.get("/")
def ep(
    user: Annotated[User, Depends(deps.require_role("admin"))],
    check: Annotated[None, Depends(deps.checker())],
    other: Annotated[None, Depends(deps.opaque())],
    ext: Annotated[None, Depends(external())],
    fine: Annotated[None, Depends(deps.get_db)],
): ...
`;
    expect(await fapi009(body)).toEqual([]);
  });

  test("reports a coroutine, a literal and a plain instance, in Security and dependencies=", async () => {
    const body = `
@router.get("/", dependencies=[Depends(deps.get_limit())])
def ep(
    user: Annotated[User, Security(deps.current_user())],
    settings: Annotated[Settings, Depends(dependency=deps.get_settings())],
): ...
`;
    expect(await fapi009(body)).toEqual([
      "10 `Depends(deps.get_limit())` calls `deps.get_limit` where the route is declared and passes FastAPI the value it returns, which FastAPI can't call as a dependency.",
      "12 `Security(deps.current_user())` calls `deps.current_user` where the route is declared and passes FastAPI the coroutine it returns, which FastAPI can't call as a dependency.",
      "13 `Depends(deps.get_settings())` calls `deps.get_settings` where the route is declared and passes FastAPI the value it returns, which FastAPI can't call as a dependency.",
    ]);
  });

  test("leaves parameter defaults to B008 unless check-defaults is on", async () => {
    const body = '\n@router.get("/")\ndef ep(db=Depends(deps.get_db())): ...\n';
    expect(await fapi009(body)).toEqual([]);
    expect(await fapi009(body, "check-defaults = true")).toHaveLength(1);
  });

  test("resolves a name defined in the same file", async () => {
    const body = `
def local():
    yield 1


@router.get("/")
def ep(x: Annotated[int, Depends(local())]): ...
`;
    expect(await fapi009(body)).toEqual([
      "15 `Depends(local())` calls `local` where the route is declared and passes FastAPI the generator it returns, which FastAPI can't call as a dependency.",
    ]);
  });
});
