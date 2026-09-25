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
      "a call before the builtin is rebound",
      'exec("import shop.infrastructure.db")\nexec = print\n',
    ],
    [
      "a rebound builtin that is deleted again",
      'exec = print\ndel exec\nexec("import shop.infrastructure.db")\n',
    ],
    [
      "a rebound builtin restored as an alias",
      'import builtins\nexec = print\nexec = builtins.exec\nexec("import shop.infrastructure.db")\n',
    ],
    [
      "a rebinding inside if",
      'if x:\n    from re import compile\ncompile("import shop.infrastructure.db", "f", "exec")\n',
    ],
  ])("%s is reported", (_, src) => {
    expect(found(src)).toEqual([["INW011", "shop.infrastructure.db"]]);
  });

  test.each([
    [
      "from re import compile",
      "from re import compile\ncompile(r'^from shop\\.infrastructure import (\\w+)')\n",
    ],
    ["def exec", 'def exec(src):\n    return src\nexec("import shop.infrastructure.db")\n'],
    [
      "decorated def exec",
      '@cache\ndef exec(src):\n    return src\nexec("import shop.infrastructure.db")\n',
    ],
    ["from mylib import eval", 'from mylib import eval\neval("import shop.infrastructure.db")\n'],
    ["an assignment", 'compile = make_compiler()\ncompile("import shop.infrastructure.db")\n'],
    [
      "a shadowed builtin inside exec",
      "from re import compile\nexec(\"compile('import shop.infrastructure.db', 'f', 'exec')\")\n",
    ],
    ["an f-string field with a conversion", "exec(f\"import shop.{'infrastructure'!s}.db\")\n"],
    [
      "a str source with a coding declaration (ignored by CPython)",
      'exec("# coding: utf-7\\n+AGk-mport shop.infrastructure.db")\n',
    ],
  ])("%s is not reported", (_, src) => {
    expect(found(src)).toEqual([]);
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
