/**
 * @file FAPI005 `route-shadowing` (#224): a path operation that an earlier one
 * with the same method already answers is reported on its decorator, naming
 * the earlier one. Covers `/users/{id}` above `/users/me`, the reverse order,
 * an exact duplicate, converters, methods, routers included with literal
 * prefixes, a prefix Inwards can't read, a route written below its router's
 * `include_router`, the per-edit mode, and suppressions.
 */
import { describe, expect, test } from "bun:test";
import { checkProject, reported } from "./fixture.ts";

const HEAD = `from fastapi import APIRouter

router = APIRouter()
`;

/**
 * Checks one router module with FAPI005 on.
 *
 * @param body - the routes, after the imports and `router = APIRouter()`.
 * @returns what FAPI005 reports.
 */
function fapi005(body: string): Promise<string[]> {
  return reported({ "app/__init__.py": "", "app/users.py": `${HEAD}${body}` }, "FAPI005");
}

/**
 * Builds a project of two routers an app includes, in the order given.
 *
 * @param includes - the `include_router` calls in `app/main.py`.
 * @param extra - files to add or replace.
 * @returns the files by path.
 */
function twoRouters(includes: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "app/__init__.py": "",
    "app/users.py": `${HEAD}\n\n@router.get("/{user_id}")\nasync def read_user(): ...\n`,
    "app/me.py": `${HEAD}\n\n@router.get("/me")\nasync def read_me(): ...\n`,
    "app/main.py": `from fastapi import FastAPI\n\nfrom app import me, users\n\napp = FastAPI()\n${includes}\n`,
    ...extra,
  };
}

/**
 * Builds a router with a parameter route and an `api_route` after it.
 *
 * @param methods - the `methods=` list's body.
 * @returns the routes, after the router.
 */
function methodsBody(methods: string): string {
  return `
@router.get("/users/{id}")
async def read_user(id: int): ...


@router.api_route("/users/me", methods=[${methods}])
async def me(): ...
`;
}

/**
 * Builds a router with two GET routes.
 *
 * @param first - the first route's path.
 * @param second - the second route's path.
 * @returns the routes, after the router.
 */
function pairBody(first: string, second: string): string {
  return `
@router.get("${first}")
async def a(): ...


@router.get("${second}")
async def b(): ...
`;
}

describe("FAPI005 on one router", () => {
  test("is off by default", async () => {
    const files = {
      "app/__init__.py": "",
      "app/users.py": `${HEAD}\n\n@router.get("/users/{id}")\nasync def a(): ...\n\n\n@router.get("/users/me")\nasync def b(): ...\n`,
    };
    expect(await checkProject(files, "")).toEqual([]);
  });

  test("reports /users/me below /users/{id}, on its decorator, naming the first", async () => {
    const found = await fapi005(`
@router.get("/users/{id}")
async def read_user(id: int): ...


@router.get("/users/me")
async def read_me(): ...
`);
    expect(found).toEqual([
      'app/users.py:9 `@router.get("/users/me")` (GET /users/me) can never be reached: `@router.get("/users/{id}")` (GET /users/{id}) at app/users.py:5 comes first and matches the same requests, so FastAPI always picks that one.',
    ]);
  });

  test("reports nothing in the right order", async () => {
    expect(
      await fapi005(`
@router.get("/users/me")
async def read_me(): ...


@router.get("/users/{id}")
async def read_user(id: int): ...
`),
    ).toEqual([]);
  });

  test("reports a repeated method and path on the second", async () => {
    const found = await fapi005(`
@router.get("/users")
async def first(): ...


@router.get("/users")
async def second(): ...
`);
    expect(found).toEqual([
      'app/users.py:9 `@router.get("/users")` (GET /users) repeats `@router.get("/users")` (GET /users) at app/users.py:5: FastAPI matches routes in the order they were added and keeps the first, so this one never runs.',
    ]);
  });

  test("calls /u/{a} and /u/{b} a repeat, as the parameter name doesn't matter", async () => {
    const [found] = await fapi005(`
@router.get("/u/{a}")
async def first(a: str): ...


@router.get("/u/{b}")
async def second(b: str): ...
`);
    expect(found).toContain("repeats");
  });

  test("keeps different methods apart", async () => {
    expect(
      await fapi005(`
@router.get("/users/{id}")
async def read_user(id: int): ...


@router.post("/users/me")
async def create_me(): ...
`),
    ).toEqual([]);
  });

  test("reports an api_route only when every method is covered", async () => {
    expect(await fapi005(methodsBody('"GET"'))).toHaveLength(1);
    expect(await fapi005(methodsBody('"GET", "POST"'))).toEqual([]);
    expect(await fapi005(methodsBody("*METHODS"))).toEqual([]);
  });

  test("covers a path parameter with a converter only for what it matches", async () => {
    expect(await fapi005(pairBody("/items/{n:int}", "/items/42"))).toHaveLength(1);
    expect(await fapi005(pairBody("/items/{n:int}", "/items/new"))).toEqual([]);
    expect(await fapi005(pairBody("/items/{n:int}", "/items/{m:int}"))).toHaveLength(1);
    expect(await fapi005(pairBody("/items/{n:int}", "/items/{m}"))).toEqual([]);
    expect(await fapi005(pairBody("/items/{n}", "/items/{m:int}"))).toHaveLength(1);
    expect(await fapi005(pairBody("/items/{n}", "/items/{m:path}"))).toEqual([]);
    expect(await fapi005(pairBody("/files/{p:path}", "/files/a/b/c"))).toHaveLength(1);
    expect(await fapi005(pairBody("/items/{n}", "/items/a/b"))).toEqual([]);
    expect(await fapi005(pairBody("/items/{n}", "/items/"))).toEqual([]);
  });

  test("compares a segment that mixes text and a parameter as written", async () => {
    expect(await fapi005(pairBody("/f/{name}.json", "/f/{other}.json"))).toHaveLength(1);
    expect(await fapi005(pairBody("/f/{name}.json", "/f/a.json"))).toEqual([]);
    expect(await fapi005(pairBody("/f/{name}", "/f/{other}.json"))).toHaveLength(1);
  });

  test("stays silent for paths and methods it can't read", async () => {
    expect(
      await fapi005(`
PATH = "/users/me"


@router.get("/users/{id}")
async def read_user(id: int): ...


@router.get(PATH)
async def by_name(): ...


@router.get(f"/users/{PATH}")
async def by_format(): ...


@router.get("/users/me", **extra)
async def splat(): ...
`),
    ).toEqual([]);
  });

  test("reports a route every path above it covers, once", async () => {
    const found = await fapi005(`
@router.get("/{any:path}")
async def catch_all(): ...


@router.get("/users/me")
async def read_me(): ...


@router.get("/users/{id}")
async def read_user(id: int): ...
`);
    expect(found).toHaveLength(2);
  });
});

describe("FAPI005 across routers", () => {
  test("reports a router included after one that covers its path", async () => {
    const found = await reported(
      twoRouters(
        'app.include_router(users.router, prefix="/users")\napp.include_router(me.router, prefix="/users")',
      ),
      "FAPI005",
    );
    expect(found).toEqual([
      'app/me.py:6 `@router.get("/me")` (GET /users/me) can never be reached: `@router.get("/{user_id}")` (GET /users/{user_id}) at app/users.py:6 comes first and matches the same requests, so FastAPI always picks that one.',
    ]);
  });

  test("reports nothing when the specific router is included first", async () => {
    expect(
      await reported(
        twoRouters(
          'app.include_router(me.router, prefix="/users")\napp.include_router(users.router, prefix="/users")',
        ),
        "FAPI005",
      ),
    ).toEqual([]);
  });

  test("reports nothing when the prefixes differ", async () => {
    expect(
      await reported(
        twoRouters(
          'app.include_router(users.router, prefix="/users")\napp.include_router(me.router, prefix="/me")',
        ),
        "FAPI005",
      ),
    ).toEqual([]);
  });

  test("joins the router's own prefix, the inclusion's, and the one above", async () => {
    const files = twoRouters('app.include_router(api.router, prefix="/api")', {
      "app/api.py": `from fastapi import APIRouter\n\nfrom app import me, users\n\nrouter = APIRouter(prefix="/v1")\nrouter.include_router(users.router, prefix="/users")\nrouter.include_router(me.router, prefix="/users")\n`,
      "app/main.py": `from fastapi import FastAPI\n\nfrom app import api\n\napp = FastAPI()\napp.include_router(api.router, prefix="/api")\n`,
    });
    const [found] = await reported(files, "FAPI005");
    expect(found).toContain("(GET /api/v1/users/me)");
  });

  test("reports two routers with the same full path and method as a repeat", async () => {
    const files = {
      "app/__init__.py": "",
      "app/a.py": `${HEAD}\n\n@router.get("/ping")\nasync def a(): ...\n`,
      "app/b.py": `${HEAD}\n\n@router.get("/ping")\nasync def b(): ...\n`,
      "app/main.py": `from fastapi import FastAPI\n\nfrom app import a, b\n\napp = FastAPI()\napp.include_router(a.router, prefix="/x")\napp.include_router(b.router, prefix="/x")\n`,
    };
    const [found, ...rest] = await reported(files, "FAPI005");
    expect(rest).toEqual([]);
    expect(found).toContain("app/b.py:6");
    expect(found).toContain("repeats");
  });

  test("reports nothing for a prefix that isn't a literal", async () => {
    const files = twoRouters(
      "app.include_router(users.router, prefix=PREFIX)\napp.include_router(me.router, prefix=PREFIX)",
    );
    expect(await reported(files, "FAPI005")).toEqual([]);
    const router = twoRouters(
      'app.include_router(users.router, prefix="/users")\napp.include_router(me.router, prefix=f"/{name}")',
    );
    expect(await reported(router, "FAPI005")).toEqual([]);
  });

  test("reports nothing when another inclusion keeps the route reachable", async () => {
    const files = twoRouters(
      'app.include_router(users.router, prefix="/users")\napp.include_router(me.router, prefix="/users")\napp.include_router(me.router, prefix=make_prefix())',
    );
    expect(await reported(files, "FAPI005")).toEqual([]);
  });

  test("ignores a route written below the include_router that copies its router", async () => {
    const files = {
      "app/__init__.py": "",
      "app/main.py": `from fastapi import APIRouter, FastAPI

app = FastAPI()
router = APIRouter()


@app.get("/users/{id}")
async def read_user(id: int): ...


app.include_router(router)


@router.get("/users/me")
async def read_me(): ...
`,
    };
    expect(await reported(files, "FAPI005")).toEqual([]);
  });

  test("doesn't follow a mount: the mounted app routes on its own", async () => {
    const files = {
      "app/__init__.py": "",
      "app/sub.py": `from fastapi import FastAPI\n\nsub = FastAPI()\n\n\n@sub.get("/me")\nasync def read_me(): ...\n`,
      "app/main.py": `from fastapi import FastAPI\n\nfrom app.sub import sub\n\napp = FastAPI()\napp.mount("/users", sub)\n\n\n@app.get("/users/{id}")\nasync def read_user(id: int): ...\n`,
    };
    expect(await reported(files, "FAPI005")).toEqual([]);
  });
});

describe("FAPI005 in the editor and with suppressions", () => {
  const Body = `
@router.get("/users/{id}")
async def read_user(id: int): ...


@router.get("/users/me")
async def read_me(): ...
`;

  test("a per-edit check reports the one-router findings, once", async () => {
    const files = { "app/__init__.py": "", "app/users.py": `${HEAD}${Body}` };
    const found = await checkProject(
      files,
      '[tool.inwards.rules]\nextend-select = ["FAPI005"]',
      "app/users.py",
    );
    expect(found.map((d) => `${d.code}:${d.line}`)).toEqual(["FAPI005:9"]);
  });

  test("a per-edit check leaves the cross-router findings for the whole-project check", async () => {
    const files = twoRouters(
      'app.include_router(users.router, prefix="/users")\napp.include_router(me.router, prefix="/users")',
    );
    const found = await checkProject(
      files,
      '[tool.inwards.rules]\nextend-select = ["FAPI005"]',
      "app/me.py",
    );
    expect(found).toEqual([]);
  });

  test("a suppression of a cross-router finding counts as used in a per-edit check", async () => {
    const files = twoRouters(
      'app.include_router(users.router, prefix="/users")\napp.include_router(me.router, prefix="/users")',
    );
    files["app/me.py"] = (files["app/me.py"] ?? "").replace(
      '@router.get("/me")',
      '@router.get("/me")  # inwards: ignore[FAPI005] reason="the gateway rewrites it"',
    );
    const rules = '[tool.inwards.rules]\nextend-select = ["FAPI005"]';
    expect(await checkProject(files, rules, "app/me.py")).toEqual([]);
    expect(await checkProject(files, rules)).toEqual([]);
  });

  test("an inline suppression on the decorator line hides the finding", async () => {
    const text = Body.replace(
      '@router.get("/users/me")',
      '@router.get("/users/me")  # inwards: ignore[FAPI005] reason="served by the gateway"',
    );
    expect(await fapi005(text)).toEqual([]);
  });
});
