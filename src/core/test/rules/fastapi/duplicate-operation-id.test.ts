/**
 * @file FAPI008 `duplicate-operation-id` (#227): two path operations that one
 * app serves with the same literal `operation_id=` are reported on the second,
 * which names the first. Covers two routers on one app, the same id on two
 * apps, one router, ids that are not literals, `include_in_schema=False`,
 * the per-edit mode and suppressions.
 */
import { describe, expect, test } from "bun:test";
import { checkProject, reported } from "./fixture.ts";

const ROUTER = "from fastapi import APIRouter\n\nrouter = APIRouter()\n";
const RULES = '[tool.inwards.rules]\nextend-select = ["FAPI008"]';
const MAIN =
  'from fastapi import FastAPI\n\nfrom app import a, b\n\napp = FastAPI()\napp.include_router(a.router, prefix="/a")\napp.include_router(b.router, prefix="/b")\n';

/**
 * Builds a router module with one operation.
 *
 * @param decorator - the decorator line.
 * @returns the module's text.
 */
function routerWith(decorator: string): string {
  return `${ROUTER}\n\n${decorator}\nasync def handler(): ...\n`;
}

/**
 * Builds the files of two routers an app includes.
 *
 * @param first - the first router's decorator.
 * @param second - the second router's decorator.
 * @param main - the app module's text.
 * @returns the files by path.
 */
function twoRouters(first: string, second: string, main = MAIN): Record<string, string> {
  return {
    "app/__init__.py": "",
    "app/a.py": routerWith(first),
    "app/b.py": routerWith(second),
    "app/main.py": main,
  };
}

describe("FAPI008", () => {
  test("is off by default", async () => {
    const files = twoRouters(
      '@router.get("/", operation_id="x")',
      '@router.get("/", operation_id="x")',
    );
    expect(await checkProject(files, "")).toEqual([]);
  });

  test("reports the second of two routers on one app, naming the first", async () => {
    const files = twoRouters(
      '@router.get("/", operation_id="list_items")',
      '@router.post("/", operation_id="list_items")',
    );
    expect(await reported(files, "FAPI008")).toEqual([
      'app/b.py:6 `@router.post("/")` uses operation_id "list_items", which `@router.get("/")` at app/a.py:6 already uses: a generated client gets two methods with one name, and FastAPI only warns when it builds the schema.',
    ]);
  });

  test("reports nothing for the same id on two different apps", async () => {
    const files = {
      "app/__init__.py": "",
      "app/a.py": routerWith('@router.get("/", operation_id="x")'),
      "app/b.py": routerWith('@router.get("/", operation_id="x")'),
      "app/main_a.py":
        "from fastapi import FastAPI\n\nfrom app import a\n\napp = FastAPI()\napp.include_router(a.router)\n",
      "app/main_b.py":
        "from fastapi import FastAPI\n\nfrom app import b\n\nadmin = FastAPI()\nadmin.include_router(b.router)\n",
    };
    expect(await reported(files, "FAPI008")).toEqual([]);
  });

  test("reports two operations on one router", async () => {
    const files = {
      "app/__init__.py": "",
      "app/a.py": `${ROUTER}\n\n@router.get("/one", operation_id="x")\nasync def one(): ...\n\n\n@router.get("/two", operation_id="x")\nasync def two(): ...\n`,
    };
    const found = await reported(files, "FAPI008");
    expect(found).toHaveLength(1);
    expect(found[0]).toStartWith("app/a.py:10 ");
  });

  test("skips ids that are not literals and operations out of the schema", async () => {
    const dynamic = twoRouters(
      '@router.get("/", operation_id=NAME)',
      '@router.get("/", operation_id=NAME)',
    );
    expect(await reported(dynamic, "FAPI008")).toEqual([]);
    const hidden = twoRouters(
      '@router.get("/", operation_id="x")',
      '@router.get("/", operation_id="x", include_in_schema=False)',
    );
    expect(await reported(hidden, "FAPI008")).toEqual([]);
  });

  test("passes different ids", async () => {
    const files = twoRouters(
      '@router.get("/", operation_id="a")',
      '@router.get("/", operation_id="b")',
    );
    expect(await reported(files, "FAPI008")).toEqual([]);
  });

  test("is not turned off by a generate_unique_id_function on the app", async () => {
    const main = MAIN.replace("FastAPI()", "FastAPI(generate_unique_id_function=make_id)");
    const files = twoRouters(
      '@router.get("/", operation_id="x")',
      '@router.get("/p", operation_id="x")',
      main,
    );
    expect(await reported(files, "FAPI008")).toHaveLength(1);
  });

  test("a per-edit check leaves the cross-router case to the whole check, and a suppression counts as used", async () => {
    const files = twoRouters(
      '@router.get("/", operation_id="x")',
      '@router.get("/", operation_id="x")',
    );
    expect(await checkProject(files, RULES, "app/b.py")).toEqual([]);
    files["app/b.py"] = (files["app/b.py"] ?? "").replace(
      'operation_id="x")',
      'operation_id="x")  # inwards: ignore[FAPI008] reason="old client"',
    );
    expect(await checkProject(files, RULES, "app/b.py")).toEqual([]);
    expect(await checkProject(files, RULES)).toEqual([]);
  });

  test("a per-edit check reports a repeat on one router", async () => {
    const files = {
      "app/__init__.py": "",
      "app/a.py": `${ROUTER}\n\n@router.get("/one", operation_id="x")\nasync def one(): ...\n\n\n@router.get("/two", operation_id="x")\nasync def two(): ...\n`,
    };
    const found = await checkProject(files, RULES, "app/a.py");
    expect(found.map((d) => `${d.code}:${d.line}`)).toEqual(["FAPI008:10"]);
  });
});
