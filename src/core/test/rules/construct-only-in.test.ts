/**
 * @file INW015 `construct-only-in` (#296, from #98): only the modules listed
 * in `allowed-in` (the composition root) import or build the modules of a
 * role such as the outbound adapters. A runtime import of a role module from
 * anywhere else is reported on the import; a call that builds a role class
 * reached through a module outside the role (a re-export) is reported on the
 * call. `TYPE_CHECKING` imports, the role's own modules, modules no layer
 * owns and an import INW001 already reports stay quiet. It is opt-in,
 * `modules` narrows it, and a suppression hides it.
 */
import { describe, expect, test } from "bun:test";
import type { Diagnostic } from "../../src/index.ts";
import { Engine, parseConfig } from "../../src/index.ts";
import { file, grammars, indexOn } from "../support/helpers.ts";

const LAYERS = `[tool.inwards]
layers = [
  { name = "domain", modules = ["app.domain"] },
  { name = "application", modules = ["app.application"] },
  { name = "adapters", modules = ["app.adapters"] },
  { name = "bootstrap", modules = ["app.di", "app.main"] },
]
`;

const ROLE = `role = ["app.adapters.outbound"]
allowed-in = ["app.di", "app.main"]`;

const SQL = `from app.application.ports import OrderRepo


class SqlRepo(OrderRepo):
    def save(self, order):
        pass


def make_repo():
    return SqlRepo()
`;

/** The project on disk besides the checked file. */
const BASE: Readonly<Record<string, string>> = {
  "app/__init__.py": "",
  "app/application/__init__.py": "",
  "app/application/ports.py": "class OrderRepo:\n    pass\n",
  "app/adapters/__init__.py": "",
  "app/adapters/inbound/__init__.py": "",
  "app/adapters/outbound/__init__.py": "",
  "app/adapters/outbound/sql.py": SQL,
};

/**
 * Checks one file with a rules table over the project in `BASE` plus `extra`.
 *
 * @param path - the checked file.
 * @param text - its text.
 * @param rules - the `[tool.inwards.rules]` tables, TOML.
 * @param extra - more files by path.
 * @returns every diagnostic.
 */
async function check(
  path: string,
  text: string,
  rules: string,
  extra: Readonly<Record<string, string>> = {},
): Promise<Diagnostic[]> {
  const engine = await Engine.create(grammars(), parseConfig(`${LAYERS}\n${rules}\n`));
  const texts = new Map(Object.entries({ ...BASE, ...extra, [path]: text }));
  const disk = new Map<string, "file" | "dir">();
  for (const rel of texts.keys()) {
    const parts = rel.split("/");
    for (let i = 1; i < parts.length; i += 1) {
      disk.set(parts.slice(0, i).join("/"), "dir");
    }
    disk.set(rel, "file");
  }
  return engine.checkFiles([file(path, text)], indexOn(disk, texts));
}

/**
 * Checks one file with INW015 on and keeps its findings.
 *
 * @param path - the checked file.
 * @param text - its text.
 * @param options - the `[tool.inwards.rules.construct-only-in]` body, TOML.
 * @param extra - more files by path.
 * @returns `line:column severity message` for each INW015 finding.
 */
async function inw015(
  path: string,
  text: string,
  options = ROLE,
  extra: Readonly<Record<string, string>> = {},
): Promise<string[]> {
  const rules = `[tool.inwards.rules]
extend-select = ["INW015"]

[tool.inwards.rules.construct-only-in]
${options}
`;
  const found = await check(path, text, rules, extra);
  return found
    .filter((d) => d.code === "INW015")
    .map((d) => `${d.line}:${d.column} ${d.severity} ${d.message}`);
}

const REST = `from fastapi import APIRouter

from app.adapters.outbound.sql import SqlRepo

router = APIRouter()


@router.post("/orders")
def create_order():
    SqlRepo().save(None)
`;

const INBOUND = "app/adapters/inbound/rest.py";

describe("INW015 construct-only-in", () => {
  test("is off unless selected", async () => {
    const found = await check(INBOUND, REST, `[tool.inwards.rules.construct-only-in]\n${ROLE}\n`);
    expect(found.filter((d) => d.code === "INW015")).toEqual([]);
  });

  test("SqlRepo() in an inbound adapter fails, on the import", async () => {
    expect(await inw015(INBOUND, REST)).toEqual([
      "3:39 error `app.adapters.inbound.rest` imports `SqlRepo` from `app.adapters.outbound.sql`, a module of the role `app.adapters.outbound`, which only `app.di` and `app.main` may import. A module that uses the adapter directly is tied to it and bypasses the port it implements.",
    ]);
  });

  test("the same code in the composition root passes", async () => {
    expect(await inw015("app/di.py", REST)).toEqual([]);
    expect(await inw015("app/main.py", REST)).toEqual([]);
  });

  test("a module of the role may import another one", async () => {
    const text = "from app.adapters.outbound.sql import SqlRepo\n\nREPO = SqlRepo()\n";
    expect(await inw015("app/adapters/outbound/cache.py", text)).toEqual([]);
  });

  test("a TYPE_CHECKING import of the adapter passes, typing.TYPE_CHECKING too", async () => {
    const text = `from __future__ import annotations

import typing
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.adapters.outbound.sql import SqlRepo

if typing.TYPE_CHECKING:
    import app.adapters.outbound.sql


def create_order(repo: SqlRepo) -> None:
    repo.save(None)
`;
    expect(await inw015(INBOUND, text)).toEqual([]);
  });

  test("the else branch of a TYPE_CHECKING block runs, so it counts", async () => {
    const text = `from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass
else:
    from app.adapters.outbound import sql
`;
    expect((await inw015(INBOUND, text)).map((f) => f.split(" ")[0])).toEqual(["6:39"]);
  });

  test("plain, relative, star and function-level imports all count", async () => {
    const text = `import app.adapters.outbound.sql
from ..outbound.sql import SqlRepo
from app.adapters.outbound.sql import *
from app.adapters import outbound


def build():
    from app.adapters.outbound.sql import make_repo
    return make_repo()
`;
    expect((await inw015(INBOUND, text)).map((f) => f.split(" ")[0])).toEqual([
      "1:8",
      "2:28",
      "3:6",
      "4:26",
      "8:43",
    ]);
  });

  test("an import of a module outside the role passes", async () => {
    const text = "from app.application.ports import OrderRepo\nfrom app import adapters\n";
    expect(await inw015(INBOUND, text)).toEqual([]);
  });

  test("a class reached through a re-export is reported on the call", async () => {
    const extra = { "app/adapters/__init__.py": "from .outbound.sql import SqlRepo, make_repo\n" };
    const text = `from app.adapters import SqlRepo, make_repo


def build():
    make_repo()
    return SqlRepo()
`;
    expect(await inw015(INBOUND, text, ROLE, extra)).toEqual([
      "6:12 error `SqlRepo()` in `app.adapters.inbound.rest` builds `app.adapters.outbound.sql.SqlRepo`, a class of the role `app.adapters.outbound`, which only `app.di` and `app.main` may build. A module that uses the adapter directly is tied to it and bypasses the port it implements.",
    ]);
  });

  test("a class reached through a module attribute is reported on the call", async () => {
    const text = "import app.adapters\n\nREPO = app.adapters.outbound.sql.SqlRepo()\n";
    expect((await inw015(INBOUND, text)).map((f) => f.split(" ")[0])).toEqual(["3:8"]);
  });

  test("a call through an import already reported isn't reported again", async () => {
    const text = `import app.adapters.outbound.sql as sql

REPO = sql.SqlRepo()
`;
    expect((await inw015(INBOUND, text)).map((f) => f.split(" ")[0])).toEqual(["1:8"]);
  });

  test("an outward import gets INW001 alone", async () => {
    const text = "from app.adapters.outbound.sql import SqlRepo\n";
    const rules = `[tool.inwards.rules]\nextend-select = ["INW015"]\n\n[tool.inwards.rules.construct-only-in]\n${ROLE}\n`;
    const found = await check("app/application/service.py", text, rules);
    expect(found.map((d) => d.code)).toEqual(["INW001"]);
  });

  test("with INW001 off, the outward import gets INW015", async () => {
    const text = "from app.adapters.outbound.sql import SqlRepo\n";
    const rules = `[tool.inwards.rules]\nextend-select = ["INW015"]\nignore = ["INW001"]\n\n[tool.inwards.rules.construct-only-in]\n${ROLE}\n`;
    const found = await check("app/application/service.py", text, rules);
    expect(found.map((d) => d.code)).toEqual(["INW015"]);
  });

  test("a module no layer owns, such as a test, isn't checked", async () => {
    const text = "from app.adapters.outbound.sql import SqlRepo\n\nREPO = SqlRepo()\n";
    expect(await inw015("tests/test_sql.py", text)).toEqual([]);
  });

  test("selectors work in role and allowed-in", async () => {
    const options = `role = ["app.*.outbound"]\nallowed-in = ["app.adapters.*"]`;
    expect(await inw015(INBOUND, REST, options)).toEqual([]);
    const narrow = `role = ["app.*.outbound"]\nallowed-in = ["app.di"]`;
    expect((await inw015(INBOUND, REST, narrow)).map((f) => f.split(" ")[0])).toEqual(["3:39"]);
  });

  test("without allowed-in, only the role itself may import it", async () => {
    const found = await inw015("app/di.py", REST, 'role = ["app.adapters.outbound"]');
    expect(found).toEqual([
      "3:39 error `app.di` imports `SqlRepo` from `app.adapters.outbound.sql`, a module of the role `app.adapters.outbound`, which no module outside it may import. A module that uses the adapter directly is tied to it and bypasses the port it implements.",
    ]);
  });

  test("modules narrows where it reports", async () => {
    const options = `${ROLE}\nmodules = ["app.adapters.inbound.graphql"]`;
    expect(await inw015(INBOUND, REST, options)).toEqual([]);
  });

  test("the fix names the composition root and the port", async () => {
    const found = await check(
      INBOUND,
      REST,
      `[tool.inwards.rules]\nextend-select = ["INW015"]\n\n[tool.inwards.rules.construct-only-in]\n${ROLE}\n`,
    );
    expect(found.find((d) => d.code === "INW015")?.fix).toMatchSnapshot();
  });

  test("an inline suppression hides it", async () => {
    const text = REST.replace(
      "import SqlRepo",
      'import SqlRepo  # inwards: ignore[INW015] reason="moving to Depends next sprint"',
    );
    expect(await inw015(INBOUND, text)).toEqual([]);
  });
});
