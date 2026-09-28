/**
 * @file The app and router graph (#184) that FAPI003 reads and later FAPI
 * rules (#183, #224, #227) walk: its nodes with their path operations, the
 * resolved `include_router` and `mount` edges in both directions, what an
 * app reaches, and the inclusions it can't follow. Built from a model over
 * an in-memory project, so nothing is imported or run.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { WiringGraph } from "../../../src/rules/fastapi/graph.ts";
import { FastApiModel } from "../../../src/rules/fastapi/model.ts";
import type { FastApiFile } from "../../../src/rules/fastapi/records.ts";
import { indexOn, parser } from "../../support/helpers.ts";

const TEXTS: ReadonlyMap<string, string> = new Map([
  ["web/__init__.py", ""],
  [
    "web/main.py",
    `from fastapi import FastAPI

from web import api, legacy
from web.routes import health as health_routes

app = FastAPI()
app.include_router(api.router, prefix="/api")
app.mount("/legacy", legacy.app)
app.include_router(getattr(health_routes, "router"))
`,
  ],
  [
    "web/api.py",
    `from fastapi import APIRouter

from web.routes import orders, users

router = APIRouter()
for sub in (orders.router, users.router):
    router.include_router(sub)
`,
  ],
  ["web/legacy.py", "from fastapi import FastAPI\n\napp = FastAPI()\n"],
  ["web/routes/__init__.py", ""],
  [
    "web/routes/orders.py",
    'from fastapi import APIRouter\n\nrouter = APIRouter()\n\n\n@router.get("/")\nasync def a(): ...\n\n\n@router.post("/")\nasync def b(): ...\n',
  ],
  ["web/routes/users.py", "from fastapi import APIRouter\n\nrouter = APIRouter()\n"],
  [
    "web/routes/health.py",
    'from fastapi import APIRouter\n\nrouter = APIRouter()\n\n\n@router.get("/")\nasync def ok(): ...\n',
  ],
  [
    "web/plugins.py",
    "from fastapi_users import auth_router\n\n\ndef register(app, extra):\n    app.include_router(auth_router)\n    app.include_router(extra)\n    app.include_router(orders.router)\n\nfrom web.routes import orders\n",
  ],
]);
const DISK = new Map<string, "file" | "dir">([
  ["web", "dir"],
  ["web/routes", "dir"],
  ...[...TEXTS.keys()].map((path): [string, "file"] => [path, "file"]),
]);

const index = indexOn(DISK, TEXTS);
const model = new FastApiModel(parser, index);
const files = [...index.modules].flatMap((m): FastApiFile[] => {
  const found = model.moduleModel(m);
  return found === null ? [] : [found];
});
const graph = WiringGraph.build(model, files, index.ownerOf);

afterAll(() => {
  model.dispose();
});

describe("the wiring graph", () => {
  test("has every app and router as a node, with the path operations declared on it", () => {
    expect(
      [...graph.nodes].map(([name, n]) => `${n.object.kind} ${name} ${n.operations.length}`),
    ).toEqual([
      "router web.api.router 0",
      "app web.legacy.app 0",
      "app web.main.app 0",
      "router web.routes.health.router 1",
      "router web.routes.orders.router 2",
      "router web.routes.users.router 0",
    ]);
  });

  test("resolves module attributes, aliases and a loop over a tuple, and keeps mounts", () => {
    expect(
      graph.edges.map((e) => `${e.kind} ${e.from ?? "?"} -> ${e.to} (${e.file.path})`),
    ).toEqual([
      "include web.api.router -> web.routes.orders.router (web/api.py)",
      "include web.api.router -> web.routes.users.router (web/api.py)",
      "include web.main.app -> web.api.router (web/main.py)",
      "mount web.main.app -> web.legacy.app (web/main.py)",
      "include ? -> web.routes.orders.router (web/plugins.py)",
    ]);
  });

  test("lists edges out of and into a node", () => {
    expect(graph.outOf("web.api.router").map((e) => e.to)).toEqual([
      "web.routes.orders.router",
      "web.routes.users.router",
    ]);
    expect(graph.into("web.routes.orders.router").map((e) => e.from)).toEqual([
      "web.api.router",
      null,
    ]);
    expect(graph.into("web.main.app")).toEqual([]);
  });

  test("reaches through includes and mounts; a router an unknown receiver includes counts as reached", () => {
    expect([...graph.reachable(["web.main.app"])].sort()).toEqual([
      "web.api.router",
      "web.legacy.app",
      "web.main.app",
      "web.routes.orders.router",
      "web.routes.users.router",
    ]);
    expect([...graph.reachable([])]).toEqual(["web.routes.orders.router"]);
  });

  test("keeps the includes it can't follow, but not a library's router", () => {
    expect(
      graph.unresolved.map((u) => `${u.file.path}:${u.wiring.node.startPosition.row + 1}`),
    ).toEqual(["web/main.py:9", "web/plugins.py:6"]);
  });
});
