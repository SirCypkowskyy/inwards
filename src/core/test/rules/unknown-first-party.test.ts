import { describe, expect, test } from "bun:test";
import { check, engine, file, indexOn } from "../support/helpers.ts";

/**
 * Lists the INW010 findings for a snippet checked as a domain module.
 *
 * @param src - Python source.
 * @param path - where the file sits; a domain module by default.
 * @returns the INW010 messages.
 */
function unknown(src: string, path = "shop/domain/order.py"): string[] {
  return check(file(path, src))
    .filter((d) => d.code === "INW010")
    .map((d) => d.message);
}

/**
 * Builds a disk with the `shop` package and the given entries under it.
 *
 * @param entries - root-relative paths; a trailing slash marks a directory.
 * @returns the disk map.
 */
function shopWith(...entries: string[]): Map<string, "file" | "dir"> {
  return new Map<string, "file" | "dir">([
    ["shop", "dir"],
    ["shop/__init__.py", "file"],
    ["shop/domain", "dir"],
    ...entries.map((e): [string, "file" | "dir"] =>
      e.endsWith("/") ? [e.slice(0, -1), "dir"] : [e, "file"],
    ),
  ]);
}

describe("INW010 unknown-first-party", () => {
  test("an import of a first-party module that doesn't exist is an error", () => {
    const [d, ...rest] = check(
      file("shop/domain/order.py", "from shop.domain.pricing import DiscountPolicy\n"),
    );
    expect(rest).toEqual([]);
    expect(d).toMatchObject({ code: "INW010", rule: "unknown-first-party", severity: "error" });
    expect(d?.message).toBe(
      '"shop.domain.pricing" is not a module of this project: "shop.domain" has no "pricing".',
    );
  });

  test("the fix lists the closest members of the package, nearest first", () => {
    const [d] = check(file("shop/api/http.py", "import shop.infrastructure.dbs\n"));
    expect(d?.fix.steps[0]).toBe(
      'Check the name. The closest modules in "shop.infrastructure": `shop.infrastructure.db`, `shop.infrastructure.sql_orders`.',
    );
  });

  test("the fix never suggests the importing file or its own package", () => {
    const project = indexOn(
      shopWith("shop/domain/service.py", "shop/domain/pricing.py", "shop/models.py"),
    );
    const [own] = engine.checkFile(
      file("shop/domain/service.py", "from .servce import x\n"),
      project,
    );
    expect(own?.fix.steps[0]).toBe(
      'Check the name. The closest modules in "shop.domain": `shop.domain.pricing`.',
    );
    const [pkg] = engine.checkFile(file("shop/domain/service.py", "import shop.domian\n"), project);
    expect(pkg?.fix.steps[0]).toBe('Check the name. The closest modules in "shop": `shop.models`.');
  });

  test.each([
    ["from .pricing import DiscountPolicy\n", ['"shop.domain.pricing"']],
    ["from ..pricing import DiscountPolicy\n", ['"shop.pricing"']],
    ["from .order import Order\nfrom . import order\n", []],
  ])("relative imports resolve before the check: %j", (src, modules) => {
    const found = unknown(src, "shop/domain/service.py");
    expect(found.map((m) => m.split(" ")[0])).toEqual(modules);
  });

  test.each([
    ["shop/domain/order.py", "from ...config import settings\n"],
    ["shop/domain/order.py", "from ... import config\n"],
    ["shop/domain/__init__.py", "from ... import config\n"],
  ])("a relative import above the top-level package is an error: %s %j", (path, src) => {
    const found = check(file(path, src));
    expect(found.map((d) => d.code)).toEqual(["INW010"]);
    expect(found[0]?.message).toBe(
      `\`${src.trim()}\` climbs above the top-level package "shop", so Python raises ImportError.`,
    );
  });

  test.each([
    ['"..infrastructure.db" reaches the outer layer', '"..infrastructure.db"', ["INW011"]],
    [
      '"...shop.infrastructure.db" climbs past "shop": Python refuses it',
      '"...shop.infrastructure.db"',
      [],
    ],
  ])("a relative import_module follows the same bound: %s", (_, name, codes) => {
    const src = `import importlib\nimportlib.import_module(${name}, __package__)\n`;
    expect(check(file("shop/domain/order.py", src)).map((d) => d.code)).toEqual(codes);
  });

  test("an outward import of a missing module gets INW001 alone: its fix deletes the import", () => {
    const src = "from shop.infrastructure.nothere import Z\n";
    expect(check(file("shop/domain/order.py", src)).map((d) => d.code)).toEqual(["INW001"]);
  });

  test("a module's bytecode in __pycache__ doesn't make it exist", () => {
    const project = indexOn(
      shopWith("shop/domain/__pycache__/", "shop/domain/__pycache__/pricing.cpython-313.pyc"),
    );
    const found = engine.checkFile(
      file("shop/domain/order.py", "import shop.domain.pricing\n"),
      project,
    );
    expect(found.map((d) => d.code)).toEqual(["INW010"]);
  });

  test("the fix skips the missing name itself and directories without Python", () => {
    // A dangling `statis.py` link is listed but doesn't import; `statics/` holds only CSS.
    const disk = shopWith(
      "shop/domain/statics/",
      "shop/domain/statics/site.css",
      "shop/domain/stats/",
      "shop/domain/stats/__init__.py",
      "shop/domain/status.py",
    );
    const listed = indexOn(disk);
    const project = engine.index({
      kind: (rel: string): "file" | "dir" | undefined => disk.get(rel),
      list: (): string[] => [],
      read: (): string => "",
      listDir: (rel: string): readonly { name: string; dir: boolean }[] | undefined =>
        rel === "shop/domain"
          ? [...(listed.listDir(rel) ?? []), { name: "statis.py", dir: false }]
          : listed.listDir(rel),
    });
    const [d] = engine.checkFile(
      file("shop/domain/order.py", "import shop.domain.statis\n"),
      project,
    );
    expect(d?.fix.steps[0]).toBe(
      'Check the name. The closest modules in "shop.domain": `shop.domain.stats`, `shop.domain.status`.',
    );
  });

  test.each([
    ["an existing module", "from shop.domain.order import Order\n"],
    ["a namespace package (no __init__.py)", "import shop.application\n"],
    ["a name from a namespace package", "from shop.application import Service\n"],
    ["a name that may live in a package's __init__", "from shop.domain import pricing\n"],
    ["the top-level package", "import shop\nfrom shop import VERSION\n"],
    ["third-party code", "from sqlalchemy.orm import Session\nimport os.path\n"],
    ["a bare top-level directory, which loses to the stdlib", "import logging.handlers\n"],
  ])("importing %s is fine", (_, src) => {
    expect(unknown(src)).toEqual([]);
  });

  test("an import of a missing module gets INW010 alone, never INW006 as well", () => {
    /**
     * Lists the codes reported for a snippet in the domain.
     *
     * @param src - Python source.
     * @returns the diagnostic codes.
     */
    function codes(src: string): string[] {
      return check(file("shop/domain/order.py", src)).map((d) => d.code);
    }
    expect(codes("import shop.pricing\n")).toEqual(["INW010"]);
    expect(codes("import scripts.missing\n")).toEqual(["INW010"]);
    expect(codes("import scripts\n")).toEqual(["INW006"]);
  });

  test("existence is probed on disk, not read from the listing", () => {
    // A stub-only module, and a module the listing skips: both are importable.
    const disk = shopWith(
      "shop/domain/order.pyi",
      "shop/domain/node_modules/",
      "shop/domain/node_modules/vendored.py",
    );
    const project = engine.index({
      kind: (rel: string): "file" | "dir" | undefined => disk.get(rel),
      list: (): string[] => [],
      read: (): string => "",
      listDir: (): undefined => undefined,
    });
    expect(project.modules.size).toBe(0);
    const src = "import shop.domain.order\nfrom shop.domain.node_modules.vendored import x\n";
    expect(engine.checkFile(file("shop/domain/service.py", src), project)).toEqual([]);
  });

  test.each([
    "_speedups.cpython-313-x86_64-linux-gnu.so",
    "_speedups.abi3.so",
    "_speedups.so",
    "_speedups.cp313-win_amd64.pyd",
    "_speedups.pyd",
    "_speedups.pyx",
  ])("a compiled extension counts as a module: %s", (name) => {
    const project = indexOn(shopWith(`shop/domain/${name}`, "shop/domain/_speedups.txt"));
    const src = "from shop.domain._speedups import fast\nimport shop.domain._speedups\n";
    expect(engine.checkFile(file("shop/domain/order.py", src), project)).toEqual([]);
    const other = engine.checkFile(
      file("shop/domain/order.py", "import shop.domain._speedup\n"),
      project,
    );
    expect(other.map((d) => d.code)).toEqual(["INW010"]);
  });

  test("a file that only shares the prefix is not a module", () => {
    const project = indexOn(shopWith("shop/domain/_speedups.txt", "shop/domain/_speedups_x.so"));
    const found = engine.checkFile(
      file("shop/domain/order.py", "import shop.domain._speedups\n"),
      project,
    );
    expect(found.map((d) => d.code)).toEqual(["INW010"]);
  });

  test.each([
    "from pkgutil import extend_path\n__path__ = extend_path(__path__, __name__)\n",
    '__import__("pkg_resources").declare_namespace(__name__)\n',
  ])("a package that extends its __path__ may have submodules elsewhere: %j", (init) => {
    // polar in the corpus shares its top-level package with the installed SDK this way.
    const project = indexOn(
      shopWith("shop/domain/__init__.py"),
      new Map([["shop/__init__.py", init]]),
    );
    const src = "from shop.sdk.models import Order\nimport shop.domain.pricing\n";
    const found = engine.checkFile(file("shop/domain/service.py", src), project);
    expect(found.filter((d) => d.code === "INW010")).toEqual([]);
  });

  test("imports in functions and behind try/except ImportError are checked too", () => {
    const src = [
      "def f():",
      "    from shop.domain.pricing import DiscountPolicy",
      "try:",
      "    import shop.domain.fast_pricing",
      "except ImportError:",
      "    pass",
      "",
    ].join("\n");
    expect(check(file("shop/domain/order.py", src)).map((d) => [d.code, d.line])).toEqual([
      ["INW010", 2],
      ["INW010", 4],
    ]);
  });

  test("files outside every layer are not checked", () => {
    expect(unknown("import shop.domain.pricing\n", "scripts/seed.py")).toEqual([]);
  });
});
