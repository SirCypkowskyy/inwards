/**
 * @file FAPI005 `route-shadowing` (#224): a parameter route before a literal
 * one on one router, an exact duplicate, the reverse order that is fine,
 * methods and convertors that keep a route reachable, and full paths across
 * routers included with literal prefixes, where a non-literal prefix skips
 * the pair. Also the per-edit mode, which reports only the one-file case.
 */
import { describe, expect, test } from "bun:test";
import { checkProject, reported } from "./fixture.ts";

/**
 * Writes a router module with the given decorated operations.
 *
 * @param ops - `[decorator, function name]` pairs, in order.
 * @param head - the router's constructor arguments.
 * @returns the module's source.
 */
function router(ops: readonly (readonly [string, string])[], head = ""): string {
  const body = ops.map(([deco, name]) => `\n\n@router.${deco}\nasync def ${name}(): ...\n`);
  return `from fastapi import APIRouter\n\nrouter = APIRouter(${head})\n${body.join("")}`;
}

const MAIN = `from fastapi import FastAPI

from app import users

app = FastAPI()
app.include_router(users.router)
`;

/**
 * Checks a project of `app/main.py` and `app/users.py` with FAPI005 on.
 *
 * @param users - the users router module.
 * @param extra - more files by path.
 * @returns what FAPI005 reports.
 */
function check(users: string, extra: Record<string, string> = {}): Promise<string[]> {
  return reported({ "app/main.py": MAIN, "app/users.py": users, ...extra }, "FAPI005");
}

describe("FAPI005 on one router", () => {
  test("/users/{id} before /users/me reports on /users/me", async () => {
    const users = router([
      ['get("/users/{user_id}")', "read_user"],
      ['get("/users/me")', "read_me"],
    ]);
    expect(await check(users)).toEqual([
      "app/users.py:10 `read_me` (GET /users/me) never runs: `read_user` (GET /users/{user_id}) comes before it and matches the same requests, and FastAPI uses the first route that matches.",
    ]);
  });

  test("the reverse order reports nothing", async () => {
    const users = router([
      ['get("/users/me")', "read_me"],
      ['get("/users/{user_id}")', "read_user"],
    ]);
    expect(await check(users)).toEqual([]);
  });

  test("a duplicate method and path reports on the second", async () => {
    const users = router([
      ['post("/users")', "create_user"],
      ['post("/users")', "create_user_v2"],
    ]);
    const [found] = await check(users);
    expect(found).toBe(
      "app/users.py:10 `create_user_v2` (POST /users) never runs: `create_user` declares the same method and path before it, and FastAPI uses the first route that matches.",
    );
  });

  test("the fix names the earlier route's file and line", async () => {
    const users = router([
      ['get("/users/{user_id}")', "read_user"],
      ['get("/users/me")', "read_me"],
    ]);
    const found = await checkProject(
      { "app/main.py": MAIN, "app/users.py": users },
      '[tool.inwards.rules]\nextend-select = ["FAPI005"]',
    );
    expect(found.find((d) => d.code === "FAPI005")?.fix?.summary).toBe(
      "Move `read_me` above `read_user` (app/users.py:6), so the more specific path is tried first.",
    );
  });

  test("other methods, convertors and segment counts stay reachable", async () => {
    const users = router([
      ['get("/users/{user_id}")', "read_user"],
      ['post("/users/me")', "post_me"],
      ['get("/users/{user_id}/orders")', "orders"],
      ['get("/items/{item_id:int}")', "item"],
      ['get("/items/latest")', "latest"],
      ['get("/files/{path:path}")', "file"],
      ['get("/files/readme")', "readme"],
    ]);
    expect(await check(users)).toEqual([]);
  });

  test("an int convertor shadows a literal number, and GET shadows HEAD", async () => {
    const users = router([
      ['get("/items/{item_id:int}")', "item"],
      ['get("/items/42")', "answer"],
      ['head("/items/{item_id:int}")', "head_item"],
    ]);
    expect((await check(users)).map((line) => line.split(" never")[0])).toEqual([
      "app/users.py:10 `answer` (GET /items/42)",
      "app/users.py:14 `head_item` (HEAD /items/{item_id:int})",
    ]);
  });

  test("an api_route with unknown methods is skipped", async () => {
    const users = router([
      ['get("/users/{user_id}")', "read_user"],
      ['api_route("/users/me", methods=METHODS)', "me"],
    ]);
    expect(await check(users)).toEqual([]);
  });
});

describe("FAPI005 across routers", () => {
  const First = router([['get("/{user_id}")', "read_user"]]);
  const Second = router([['get("/me")', "read_me"]]);

  /**
   * Builds an app that includes two routers with the given prefixes.
   *
   * @param a - the first `include_router`'s `prefix=` argument.
   * @param b - the second's.
   * @returns the app module.
   */
  function main(a: string, b: string): string {
    return `from fastapi import FastAPI

from app import first, second

app = FastAPI()
app.include_router(first.router, prefix=${a})
app.include_router(second.router, prefix=${b})
`;
  }

  test("literal prefixes that give one full path report on the later route", async () => {
    const found = await reported(
      {
        "app/main.py": main('"/users"', '"/users"'),
        "app/first.py": First,
        "app/second.py": Second,
      },
      "FAPI005",
    );
    expect(found).toEqual([
      "app/second.py:6 `read_me` (GET /users/me) never runs: `read_user` (GET /users/{user_id}) comes before it and matches the same requests, and FastAPI uses the first route that matches.",
    ]);
  });

  test("a router's own prefix counts too", async () => {
    const found = await reported(
      {
        "app/main.py": main('"/users"', '""'),
        "app/first.py": First,
        "app/second.py": router([['get("/me")', "read_me"]], 'prefix="/users"'),
      },
      "FAPI005",
    );
    expect(found).toHaveLength(1);
  });

  test("a non-literal prefix reports nothing", async () => {
    const found = await reported(
      { "app/main.py": main("PREFIX", '"/users"'), "app/first.py": First, "app/second.py": Second },
      "FAPI005",
    );
    expect(found).toEqual([]);
  });

  test("different prefixes report nothing", async () => {
    const found = await reported(
      {
        "app/main.py": main('"/users"', '"/admins"'),
        "app/first.py": First,
        "app/second.py": Second,
      },
      "FAPI005",
    );
    expect(found).toEqual([]);
  });

  test("the per-edit check reports only the one-file case", async () => {
    const files = {
      "app/main.py": main('"/users"', '"/users"'),
      "app/first.py": First,
      "app/second.py": Second,
    };
    const rules = '[tool.inwards.rules]\nextend-select = ["FAPI005"]';
    expect(await checkProject(files, rules, "app/second.py")).toEqual([]);
    const both = router([
      ['get("/{user_id}")', "read_user"],
      ['get("/me")', "read_me"],
    ]);
    const one = await checkProject({ ...files, "app/second.py": both }, rules, "app/second.py");
    expect(one.map((d) => `${d.code}:${d.line}`)).toEqual(["FAPI005:10"]);
  });

  test("a suppression on the later route counts as used in the per-edit check", async () => {
    const suppressed = Second.replace(
      '@router.get("/me")',
      '@router.get("/me")  # inwards: ignore[FAPI005] reason="served by the gateway"',
    );
    const files = {
      "app/main.py": main('"/users"', '"/users"'),
      "app/first.py": First,
      "app/second.py": suppressed,
    };
    const rules = '[tool.inwards.rules]\nextend-select = ["FAPI005"]';
    expect(await checkProject(files, rules, "app/second.py")).toEqual([]);
    expect(await checkProject(files, rules)).toEqual([]);
  });
});
