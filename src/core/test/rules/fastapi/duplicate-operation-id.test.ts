/**
 * @file FAPI008 `duplicate-operation-id` (#227): two routers mounted on one
 * app with the same literal `operation_id`, the same id on two apps, ids
 * that aren't literals or aren't in the schema, and an app with a
 * `generate_unique_id_function`. Also the per-edit mode, which reports
 * nothing, and the fix that names the first operation's file and line.
 */
import { describe, expect, test } from "bun:test";
import { checkProject, reported } from "./fixture.ts";

/**
 * Writes a router module with one GET operation.
 *
 * @param name - the function's name.
 * @param keywords - the decorator's keyword arguments after the path.
 * @returns the module's source.
 */
function router(name: string, keywords: string): string {
  return `from fastapi import APIRouter

router = APIRouter()


@router.get("/{item_id}", ${keywords})
async def ${name}(item_id: int) -> dict[str, int]:
    return {"id": item_id}
`;
}

/**
 * Writes an app module that includes the given routers.
 *
 * @param routers - `module` or `module, keywords` for each `include_router`.
 * @param app - the `FastAPI(...)` arguments.
 * @returns the module's source.
 */
function main(routers: readonly string[], app = ""): string {
  const names = routers.map((r) => r.split(",")[0]);
  const includes = routers.map((r) => {
    const [module, ...rest] = r.split(",");
    return `app.include_router(${module}.router, prefix="/${module}"${rest.length > 0 ? `,${rest.join(",")}` : ""})`;
  });
  return `from fastapi import FastAPI\n\nfrom app import ${names.join(", ")}\n\napp = FastAPI(${app})\n${includes.join("\n")}\n`;
}

const ORDERS = router("get_order", 'operation_id="getOrder"');
const LEGACY = router("get_legacy_order", 'operation_id="getOrder"');

describe("FAPI008", () => {
  test("two routers on one app with the same operation_id report on the second", async () => {
    const found = await reported(
      {
        "app/main.py": main(["orders", "legacy"]),
        "app/orders.py": ORDERS,
        "app/legacy.py": LEGACY,
      },
      "FAPI008",
    );
    expect(found).toEqual([
      'app/legacy.py:6 `get_legacy_order` has operation_id "getOrder", which `get_order` already has in the app `app.main.app`. OpenAPI needs each id once, and a generated client gets two methods with one name.',
    ]);
  });

  test("the fix names the first operation's file and line", async () => {
    const found = await checkProject(
      {
        "app/main.py": main(["orders", "legacy"]),
        "app/orders.py": ORDERS,
        "app/legacy.py": LEGACY,
      },
      '[tool.inwards.rules]\nextend-select = ["FAPI008"]',
    );
    expect(found.find((d) => d.code === "FAPI008")?.fix?.summary).toBe(
      'Give `get_legacy_order` an operation_id of its own; `get_order` (app/orders.py:6) keeps "getOrder".',
    );
  });

  test("the same id on operations of two different apps reports nothing", async () => {
    const admin =
      "from fastapi import FastAPI\n\nfrom app import legacy\n\nadmin = FastAPI()\nadmin.include_router(legacy.router)\n";
    const found = await reported(
      {
        "app/main.py": main(["orders"]),
        "app/admin.py": admin,
        "app/orders.py": ORDERS,
        "app/legacy.py": LEGACY,
      },
      "FAPI008",
    );
    expect(found).toEqual([]);
  });

  test("an id that isn't a literal, or a route out of the schema, doesn't count", async () => {
    const files = {
      "app/orders.py": ORDERS,
      "app/legacy.py": router("get_legacy_order", "operation_id=IDS.GET_ORDER"),
    };
    expect(
      await reported({ ...files, "app/main.py": main(["orders", "legacy"]) }, "FAPI008"),
    ).toEqual([]);
    const hidden = { ...files, "app/legacy.py": LEGACY };
    expect(
      await reported(
        { ...hidden, "app/main.py": main(["orders", "legacy, include_in_schema=False"]) },
        "FAPI008",
      ),
    ).toEqual([]);
  });

  test("a generate_unique_id_function leaves explicit ids the only ones compared", async () => {
    const files = {
      "app/main.py": main(["orders", "legacy"], "generate_unique_id_function=custom_id"),
      "app/orders.py": router("get_order", 'summary="Order"'),
      "app/legacy.py": router("get_legacy_order", 'summary="Order"'),
    };
    expect(await reported(files, "FAPI008")).toEqual([]);
    const explicit = { ...files, "app/orders.py": ORDERS, "app/legacy.py": LEGACY };
    expect(await reported(explicit, "FAPI008")).toHaveLength(1);
  });

  test("a router included twice isn't compared with its own copy", async () => {
    const twice = `from fastapi import FastAPI\n\nfrom app import orders\n\napp = FastAPI()\napp.include_router(orders.router, prefix="/v1")\napp.include_router(orders.router, prefix="/v2")\n`;
    expect(await reported({ "app/main.py": twice, "app/orders.py": ORDERS }, "FAPI008")).toEqual(
      [],
    );
  });

  test("the per-edit check reports nothing", async () => {
    const files = {
      "app/main.py": main(["orders", "legacy"]),
      "app/orders.py": ORDERS,
      "app/legacy.py": LEGACY,
    };
    const rules = '[tool.inwards.rules]\nextend-select = ["FAPI008"]';
    expect(await checkProject(files, rules, "app/legacy.py")).toEqual([]);
  });
});
