/**
 * @file A per-edit FAPI001 check builds the router graph from the edited file
 * and the project files that can hold an inclusion, a mount or a schema route
 * (#404), not from every FastAPI file. Each case checks a project whole and
 * one file at a time and demands the same FAPI001 findings for the file, with
 * the answer the graph decides (an inclusion that hides a router, an app that
 * serves a schema of its own, an inclusion Inwards can't follow) pinned.
 */
import { describe, expect, test } from "bun:test";
import { checkProject } from "./fixture.ts";

const ROUTER = `from fastapi import APIRouter

router = APIRouter()


@router.post("/orders")
async def create_order(body: OrderIn): ...
`;

const RULES = '[tool.inwards.rules]\nextend-select = ["FAPI001"]\n';

/** A module that mentions FastAPI and spells `amount` but wires nothing: the per-edit graph skips it. */
const BYSTANDER = `from fastapi import APIRouter

other = APIRouter()
amount = 3


@other.get("/amount")
async def read_amount(): ...
`;

/** What FAPI001 reported, as `line message`, per Python file. */
type Found = Record<string, string[]>;

/**
 * Keeps what FAPI001 reports in one file.
 *
 * @param diagnostics - a check's diagnostics.
 * @param path - the file.
 * @returns `line message` for each finding.
 */
function lines(diagnostics: Awaited<ReturnType<typeof checkProject>>, path: string): string[] {
  return diagnostics
    .filter((d) => d.code === "FAPI001" && d.file === path)
    .map((d) => `${d.line} ${d.message}`);
}

/**
 * Checks a project whole and one edited file at a time.
 *
 * @param files - file texts by path.
 * @param options - extra TOML after `extend-select`.
 * @returns FAPI001's findings per Python file, from the whole run and from the per-edit runs.
 */
async function bothWays(
  files: Readonly<Record<string, string>>,
  options = "",
): Promise<{ whole: Found; edit: Found }> {
  const rules = `${RULES}${options}`;
  const paths = Object.keys(files).filter((p) => p.endsWith(".py"));
  const whole = await checkProject(files, rules);
  const edits = await Promise.all(paths.map((path) => checkProject(files, rules, path)));
  return {
    whole: Object.fromEntries(paths.map((path) => [path, lines(whole, path)])),
    edit: Object.fromEntries(paths.map((path, i) => [path, lines(edits[i] ?? [], path)])),
  };
}

const CASES: readonly (readonly [string, Record<string, string>, string, boolean])[] = [
  [
    "a router an app includes",
    {
      "app/__init__.py": "",
      "app/orders.py": ROUTER,
      "app/other.py": BYSTANDER,
      "app/main.py":
        "from fastapi import FastAPI\nfrom app import orders\n\napp = FastAPI()\napp.include_router(orders.router)\n",
    },
    "",
    true,
  ],
  [
    "a router every inclusion hides",
    {
      "app/__init__.py": "",
      "app/orders.py": ROUTER,
      "app/other.py": BYSTANDER,
      "app/main.py":
        "from fastapi import FastAPI\nfrom app import orders\n\napp = FastAPI()\napp.include_router(orders.router, include_in_schema=False)\n",
    },
    "",
    false,
  ],
  [
    "a router under a router a re-export leads to",
    {
      "app/__init__.py": "from app.api import router\n",
      "app/orders.py": ROUTER,
      "app/api.py":
        "from fastapi import APIRouter\nfrom app.orders import router as orders_router\n\nrouter = APIRouter()\nrouter.include_router(orders_router)\n",
      "app/main.py":
        "from fastapi import FastAPI\nfrom app import router\n\napp = FastAPI()\napp.include_router(router)\n",
    },
    "",
    true,
  ],
  [
    "an app without a schema",
    {
      "app/__init__.py": "",
      "app/orders.py": ROUTER,
      "app/main.py":
        "from fastapi import FastAPI\nfrom app import orders\n\napp = FastAPI(openapi_url=None)\napp.include_router(orders.router)\n",
    },
    "",
    false,
  ],
  [
    "an app without a schema that a route in another file serves one for",
    {
      "app/__init__.py": "",
      "app/orders.py": ROUTER,
      "app/main.py":
        "from fastapi import FastAPI\nfrom app import orders\n\napp = FastAPI(openapi_url=None)\napp.include_router(orders.router)\n",
      "app/schema.py":
        'from fastapi import FastAPI\nfrom app.main import app\n\n\n@app.get("/v1/openapi.json")\nasync def schema(): ...\n',
    },
    "",
    true,
  ],
  [
    "an inclusion in a function a mount call reaches",
    {
      "app/__init__.py": "",
      "app/orders.py": ROUTER,
      "app/wiring.py":
        "from fastapi import FastAPI\nfrom app import orders\n\n\ndef wire(app):\n    app.include_router(orders.router, include_in_schema=False)\n",
      "app/main.py":
        "from fastapi import FastAPI\nfrom app.wiring import wire\n\napp = FastAPI()\nwire(app)\n",
    },
    "",
    false,
  ],
  [
    "an inclusion Inwards can't follow, with tags required",
    {
      "app/__init__.py": "",
      "app/orders.py": ROUTER,
      "app/main.py":
        "import importlib\n\nfrom fastapi import FastAPI\n\napp = FastAPI()\napp.include_router(importlib.import_module('app.orders').router)\n",
    },
    "[tool.inwards.rules.endpoint-metadata]\nrequire-tags = true\n",
    true,
  ],
  [
    "a router tags reach from an inclusion",
    {
      "app/__init__.py": "",
      "app/orders.py": ROUTER,
      "app/main.py":
        'from fastapi import FastAPI\nfrom app import orders\n\napp = FastAPI()\napp.include_router(orders.router, tags=["orders"])\n',
    },
    "[tool.inwards.rules.endpoint-metadata]\nrequire-tags = true\n",
    true,
  ],
];

describe("a per-edit FAPI001 check reads the inclusions it needs (#404)", () => {
  test.each(CASES)("%s", async (_name, files, options, reports) => {
    const { whole, edit } = await bothWays(files, options);
    expect(edit).toEqual(whole);
    expect(whole["app/orders.py"]?.length !== 0).toBe(reports);
  });
});
