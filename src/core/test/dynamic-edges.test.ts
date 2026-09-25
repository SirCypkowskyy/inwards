import { describe, expect, test } from "bun:test";
import { engine, file, found } from "./helpers.ts";

describe("INW011: edge cases", () => {
  test.each([
    [
      "importlib.__dict__",
      'import importlib\nimportlib.__dict__["import_module"]("shop.infrastructure.db")\n',
    ],
    [
      "builtins.__dict__",
      'import builtins\nbuiltins.__dict__["exec"]("import shop.infrastructure.db")\n',
    ],
    [
      "vars(module)",
      'import importlib\nvars(importlib)["import_module"]("shop.infrastructure.db")\n',
    ],
    [
      "+ between literals",
      'import importlib\nimportlib.import_module("shop." + "infrastructure" + ".db")\n',
    ],
    ["f-string with a literal field", "exec(f\"import shop.{'infrastructure'}.db\")\n"],
    [
      "bytes with a safe declaration",
      'exec(b"# coding: latin-1\\nimport shop.infrastructure.db")\n',
    ],
    [
      "a builtin re-exported by another module",
      'from shop.compat import exec\nexec("import shop.infrastructure.db")\n',
    ],
    [
      "a builtin re-exported through a relative import",
      'from ..compat import exec\nexec("import shop.infrastructure.db")\n',
    ],
    [
      "a builtin rebound, then restored through globals()",
      'import builtins\nexec = print\nglobals()["exec"] = builtins.exec\nexec("import shop.infrastructure.db")\n',
    ],
    [
      "a def named exec (builtins always count)",
      'def exec(src):\n    return src\nexec("import shop.infrastructure.db")\n',
    ],
  ])("%s is reported", (_, src) => {
    expect(found(src)).toEqual([["INW011", "shop.infrastructure.db"]]);
  });

  test.each([
    ["an f-string field with a conversion", "exec(f\"import shop.{'infrastructure'!s}.db\")\n"],
    [
      "a str source with a coding declaration (ignored by CPython)",
      'exec("# coding: utf-7\\n+AGk-mport shop.infrastructure.db")\n',
    ],
  ])("%s is not reported", (_, src) => {
    expect(found(src)).toEqual([]);
  });

  test("known false positive: a rebound builtin still counts, so re.compile patterns are read as code", () => {
    const src = 'from re import compile\ncompile("from shop.infrastructure import x")\n';
    expect(found(src)).toEqual([["INW011", "shop.infrastructure.x"]]);
  });

  test("bytes that declare a codec Inwards can't read are reported, not skipped", () => {
    const src = "exec(b'# coding: utf-7\\n+AGk-mport shop.infrastructure')\n";
    const [d, ...rest] = engine.checkFile(file("shop/domain/order.py", src));
    expect(rest).toEqual([]);
    expect(d?.code).toBe("INW011");
    expect(d?.message).toContain('declare encoding "utf-7"');
    expect(d?.fix.steps[0]).toStartWith("Delete `exec(b'# coding: utf-7");
  });

  test("unreadable bytes outside every layer are not reported", () => {
    const src = "exec(b'# coding: utf-7\\n+AGk-mport shop.infrastructure')\n";
    expect(engine.checkFile(file("scripts/seed.py", src))).toEqual([]);
  });
});
