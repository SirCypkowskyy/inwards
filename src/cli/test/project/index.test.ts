import { expect, test } from "bun:test";
import { join } from "node:path";
import { nodePlatform, nodeProjectIo } from "../../src/adapters/compose.ts";
import { indexProject } from "../../src/project/check.ts";

import { LAYERS, project } from "../support/run.ts";

const IO = nodeProjectIo(nodePlatform());

test("indexes every module, including one under a build/ directory", async () => {
  const root = project({
    "pyproject.toml": LAYERS,
    "shop/__init__.py": "",
    "shop/domain/order.py": "X = 1\n",
    "shop/domain/build/leak.py": "import shop.infrastructure.db\n",
    "shop/infrastructure/db.py": "from shop.domain.order import X\n",
  });
  const index = await indexProject(IO, join(root, "pyproject.toml"));
  expect([...index.modules].sort()).toEqual([
    "shop",
    "shop.domain.build.leak",
    "shop.domain.order",
    "shop.infrastructure.db",
  ]);
  // Symbols resolve to the module that defines them; packages count as modules.
  expect(index.ownerOf("shop.domain.order.X")).toBe("shop.domain.order");
  expect(index.ownerOf("shop.nowhere")).toBe("shop");
  expect(index.ownerOf("sqlalchemy.orm")).toBeUndefined();
  expect([...index.importersOf("shop.infrastructure.db")]).toEqual(["shop.domain.build.leak"]);
  expect([...index.importersOf("shop.domain.order")]).toEqual(["shop.infrastructure.db"]);
  expect([...index.importersOf("shop.domain.build.leak")]).toEqual([]);
});

test("importers are found however the import is spelled", async () => {
  const root = project({
    "pyproject.toml": LAYERS,
    "shop/__init__.py": "",
    "shop/domain/__init__.py": "",
    "shop/domain/order.py": "X = 1\n",
    "shop/domain/relative.py": "from . import order\n",
    "shop/domain/fullwidth.py": "import shop.domain.ｏrder\n",
    "shop/domain/spaced.py": "from shop . domain . order import X\n",
    "shop/domain/unrelated.py": "import shop.domain\n",
  });
  const index = await indexProject(IO, join(root, "pyproject.toml"));
  expect([...index.importersOf("shop.domain.order")].sort()).toEqual([
    "shop.domain.fullwidth",
    "shop.domain.relative",
    "shop.domain.spaced",
  ]);
});

test("relative imports of a package are found without its name in the text", async () => {
  const root = project({
    "pyproject.toml": LAYERS,
    "shop/__init__.py": "",
    "shop/domain/__init__.py": "helper = 1\n",
    "shop/domain/star.py": "from . import *\n",
    "shop/domain/rel_attr.py": "from . import helper\n",
    "shop/domain/sub/__init__.py": "",
    "shop/domain/sub/up.py": "from .. import helper\n",
  });
  const index = await indexProject(IO, join(root, "pyproject.toml"));
  expect([...index.importersOf("shop.domain")].sort()).toEqual([
    "shop.domain.rel_attr",
    "shop.domain.star",
    "shop.domain.sub.up",
  ]);
});

test("importers of a namespace package are found, though the listing has no file for it", async () => {
  const root = project({
    "pyproject.toml": LAYERS,
    "shop/__init__.py": "",
    "shop/domain/order.py": "X = 1\n",
    "shop/infrastructure/db.py": "import shop.domain\n",
  });
  const index = await indexProject(IO, join(root, "pyproject.toml"));
  expect(index.modules.has("shop.domain")).toBe(false);
  expect(index.ownerOf("shop.domain")).toBe("shop.domain");
  expect([...index.importersOf("shop.domain")]).toEqual(["shop.infrastructure.db"]);
});
