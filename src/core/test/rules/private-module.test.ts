/**
 * @file INW021 `private-module` (#434, ADR-046): a first-party module whose
 * name, below the top-level package, starts with one underscore belongs to
 * the package that holds it. An import from outside that package is
 * reported, whether plain, `from`, relative, inside a function or under
 * `TYPE_CHECKING`; the package's `__init__.py`, its siblings and its
 * subpackages import it freely. Test modules are skipped unless
 * `check-tests = true`, the rule is opt-in, and an import INW003 reports on
 * the same line isn't reported twice.
 */
import { describe, expect, test } from "bun:test";
import type { Diagnostic } from "../../src/index.ts";
import { Engine, parseConfig } from "../../src/index.ts";
import { file, grammars, indexOn } from "../support/helpers.ts";

const LAYERS = `[tool.inwards]
layers = [{ name = "app", modules = ["app"] }]
`;

const ON = `[tool.inwards.rules]
extend-select = ["INW021"]
`;

/** The project on disk besides the checked file. */
const BASE: readonly string[] = [
  "app/__init__.py",
  "app/orders/__init__.py",
  "app/orders/api.py",
  "app/users/__init__.py",
  "app/users/api.py",
  "app/users/services/__init__.py",
  "app/users/services/_user.py",
  "app/users/services/other.py",
  "app/users/services/sub/__init__.py",
  "app/users/services/sub/deep.py",
  "app/users/_internal/__init__.py",
  "app/users/_internal/x.py",
  "app/__main__.py",
  "tests/__init__.py",
  "tests/test_users.py",
  "scripts/__init__.py",
  "scripts/seed.py",
];

/**
 * Checks one file over the project in `BASE`.
 *
 * @param path - the checked file.
 * @param text - its text.
 * @param toml - the config besides `[tool.inwards]`'s layers, TOML.
 * @returns every diagnostic.
 */
async function check(path: string, text: string, toml = ON): Promise<Diagnostic[]> {
  const engine = await Engine.create(grammars(), parseConfig(`${LAYERS}\n${toml}\n`));
  const disk = new Map<string, "file" | "dir">();
  for (const rel of [...BASE, path]) {
    const parts = rel.split("/");
    for (let i = 1; i < parts.length; i += 1) {
      disk.set(parts.slice(0, i).join("/"), "dir");
    }
    disk.set(rel, "file");
  }
  return engine.checkFiles([file(path, text)], indexOn(disk, new Map([[path, text]])));
}

/**
 * Checks one file and keeps its INW021 findings.
 *
 * @param path - the checked file.
 * @param text - its text.
 * @param toml - the config besides the layers.
 * @returns `line severity message` for each INW021 finding.
 */
async function inw021(path: string, text: string, toml = ON): Promise<string[]> {
  const found = await check(path, text, toml);
  return found
    .filter((d) => d.code === "INW021")
    .map((d) => `${d.line} ${d.severity} ${d.message}`);
}

const MESSAGE =
  "`app.orders.api` imports `app.users.services._user`, a private module of `app.users.services`. A module whose name starts with `_` is for its own package; other code imports what the package's `__init__.py` re-exports.";

describe("imports from outside the package", () => {
  test("a from-import of a name in a private module is reported", async () => {
    const found = await check(
      "app/orders/api.py",
      "from app.users.services._user import UserService\n",
    );
    expect(found.map((d) => d.code)).toEqual(["INW021"]);
    expect(found[0]?.message).toBe(MESSAGE);
    expect(found[0]?.severity).toBe("error");
    expect(found[0]?.fix.summary).toBe(
      "Import `UserService` from `app.users.services`, not from its private module `app.users.services._user`.",
    );
  });

  test("plain, from-package and in-function imports are reported", async () => {
    const text = `import app.users.services._user
from app.users.services import _user


def f():
    import app.users.services._user as u
`;
    const found = await inw021("app/orders/api.py", text);
    expect(found.map((f) => f.split(" ")[0])).toEqual(["1", "2", "6"]);
  });

  test("an import under TYPE_CHECKING is reported", async () => {
    const text = `from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.users.services._user import UserService
`;
    expect(await inw021("app/orders/api.py", text)).toEqual([`4 error ${MESSAGE}`]);
  });

  test("a relative import that leaves the package is reported", async () => {
    const found = await inw021("app/orders/api.py", "from ..users.services._user import X\n");
    expect(found).toEqual([`1 error ${MESSAGE}`]);
  });

  test("a module under a private package is private to the package above it", async () => {
    const found = await inw021("app/orders/api.py", "from app.users._internal.x import y\n");
    expect(found).toEqual([
      "1 error `app.orders.api` imports `app.users._internal.x`, a private module of `app.users`. A module whose name starts with `_` is for its own package; other code imports what the package's `__init__.py` re-exports.",
    ]);
  });

  test("a script outside every layer is reported too", async () => {
    const found = await inw021("scripts/seed.py", "from app.users.services._user import X\n");
    expect(found).toHaveLength(1);
  });
});

describe("imports that are fine", () => {
  test("the package's __init__, siblings and subpackages import it", async () => {
    const plain = "from app.users.services._user import UserService\n";
    expect(await inw021("app/users/services/__init__.py", "from ._user import X\n")).toEqual([]);
    expect(await inw021("app/users/services/other.py", plain)).toEqual([]);
    expect(await inw021("app/users/services/sub/deep.py", plain)).toEqual([]);
  });

  test("a private package's modules are open to the package that holds it", async () => {
    expect(await inw021("app/users/api.py", "from app.users._internal.x import y\n")).toEqual([]);
  });

  test("the public package, dunder modules and private names stay quiet", async () => {
    const text = `from app.users.services import UserService, _helper
import app.__main__
`;
    expect(await inw021("app/orders/api.py", text)).toEqual([]);
  });

  test("third-party and missing modules are not INW021's", async () => {
    const text = "from requests._internal import x\nfrom app.users._gone import y\n";
    expect(await inw021("app/orders/api.py", text)).toEqual([]);
  });
});

describe("configuration", () => {
  test("the rule is off by default", async () => {
    const text = "from app.users.services._user import UserService\n";
    expect(await inw021("app/orders/api.py", text, "")).toEqual([]);
  });

  test("tests are skipped unless check-tests is set", async () => {
    const text = "from app.users.services._user import UserService\n";
    expect(await inw021("tests/test_users.py", text)).toEqual([]);
    const withTests = `${ON}\n[tool.inwards.rules.private-module]\ncheck-tests = true\n`;
    expect(await inw021("tests/test_users.py", text, withTests)).toHaveLength(1);
  });

  test("modules narrows where it reports, and severity re-levels it", async () => {
    const text = "from app.users.services._user import UserService\n";
    const scoped = `${ON}\n[tool.inwards.rules.private-module]\nmodules = ["app.users"]\n`;
    expect(await inw021("app/orders/api.py", text, scoped)).toEqual([]);
    const warn = `${ON}severity = { INW021 = "warning" }\n`;
    expect(await inw021("app/orders/api.py", text, warn)).toEqual([`1 warning ${MESSAGE}`]);
  });

  test("an import INW003 reports on the same line gets INW003 alone", async () => {
    const contexts = `${ON}
[[tool.inwards.contexts]]
name = "users"
modules = ["app.users"]
public = ["app.users.api"]

[[tool.inwards.contexts]]
name = "orders"
modules = ["app.orders"]
depends-on = ["users"]
`;
    const found = await check(
      "app/orders/api.py",
      "from app.users.services._user import UserService\n",
      contexts,
    );
    expect(found.map((d) => d.code)).toEqual(["INW003"]);
  });
});

describe("one finding per statement", () => {
  test("several names from one private module are reported once, with every name in the fix", async () => {
    const found = await check(
      "app/orders/api.py",
      "from app.users.services._user import UserService, make_user\n",
    );
    expect(found.map((d) => d.code)).toEqual(["INW021"]);
    expect(found[0]?.fix.summary).toBe(
      "Import `UserService`, `make_user` from `app.users.services`, not from its private module `app.users.services._user`.",
    );
  });
});
