import { describe, expect, test } from "bun:test";
import { ConfigError, parseConfig, render } from "../src/index.ts";
import { engine, file } from "./helpers.ts";

describe("INW001 layer-dependency", () => {
  test("domain importing infrastructure is a violation with a fix", () => {
    const [d, ...rest] = engine.checkFile(
      file("shop/domain/order.py", "from shop.infrastructure.db import OrderTable\n"),
    );
    expect(rest).toHaveLength(0);
    expect(d?.code).toBe("INW001");
    expect(d?.line).toBe(1);
    expect(d?.message).toContain('"domain"');
    expect(d?.message).toContain('"infrastructure"');
    expect(d?.fix.steps.join(" ")).toContain("Protocol");
  });

  test("inward imports are allowed", () => {
    const src = "from shop.domain.order import Order\nimport shop.application.place_order\n";
    expect(engine.checkFile(file("shop/api/http.py", src))).toEqual([]);
  });

  test("relative imports resolve before the check", () => {
    const src = "from ..infrastructure import sql_orders\n";
    const [d] = engine.checkFile(file("shop/application/place_order.py", src));
    expect(d?.message).toContain("shop.infrastructure.sql_orders");
  });

  test("`from pkg import submodule` cannot sneak past the rule", () => {
    const [d] = engine.checkFile(file("shop/domain/order.py", "from shop import infrastructure\n"));
    expect(d?.code).toBe("INW001");
  });

  test("imports hidden in functions and TYPE_CHECKING blocks are still checked", () => {
    const src = [
      "from typing import TYPE_CHECKING",
      "if TYPE_CHECKING:",
      "    import shop.api.http",
      "def f():",
      "    import shop.infrastructure.sql_orders as s",
      "",
    ].join("\n");
    const found = engine.checkFile(file("shop/domain/order.py", src));
    expect(found.map((d) => d.line)).toEqual([3, 5]);
  });

  test("files outside every layer are ignored", () => {
    expect(engine.checkFile(file("scripts/seed.py", "import shop.infrastructure\n"))).toEqual([]);
  });
});

describe("reporters", () => {
  const diagnostics = engine.checkFile(
    file("shop/domain/order.py", "import shop.infrastructure.db\n"),
  );
  const report = { diagnostics, filesChecked: 1, durationMs: 1.23 };

  test("json is versioned and carries the fix", () => {
    const json = JSON.parse(render(report, "json"));
    expect(json.schema).toBe("inwards/diagnostics@1");
    expect(json.diagnostics[0].fix.steps.length).toBeGreaterThan(0);
  });

  test("sarif is 2.1.0 with a region", () => {
    const sarif = JSON.parse(render(report, "sarif"));
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0].results[0].locations[0].physicalLocation.region.startLine).toBe(1);
  });
});

describe("config", () => {
  test("missing table is a clear error", () => {
    expect(() => parseConfig("[project]\nname='x'\n")).toThrow(ConfigError);
  });
});

describe("import skeleton prescan", () => {
  test("keeps line numbers and restores columns of nested imports", () => {
    const src = ["def f():", "    x = 1", "    import shop.infrastructure.db", ""].join("\n");
    const [d] = engine.checkFile(file("shop/domain/order.py", src));
    expect(d?.line).toBe(3);
    expect(d?.column).toBe(12);
  });

  test("multi-line parenthesised imports survive", () => {
    const src = "from shop.infrastructure.db import (\n    A,\n    B,\n)\nx = 1\n";
    expect(engine.checkFile(file("shop/domain/order.py", src))).toHaveLength(2);
  });

  test("an import after a semicolon forces the full parse and is still caught", () => {
    const src = "x = 1; import shop.infrastructure.db\n";
    expect(engine.checkFile(file("shop/domain/order.py", src))).toHaveLength(1);
  });

  test("import-looking text inside a docstring is not reported", () => {
    const src = '"""\nfrom shop.infrastructure.db import Table\n"""\n';
    expect(engine.checkFile(file("shop/domain/order.py", src))).toEqual([]);
  });
});

describe("text reporter colour", () => {
  const diagnostics = engine.checkFile(file("shop/domain/order.py", "import shop.api.http\n"));
  const report = { diagnostics, filesChecked: 1, durationMs: 1 };

  test("plain by default, so pipes and agents get clean text", () => {
    expect(render(report, "text")).not.toContain("\x1b[");
  });

  test("ANSI when the adapter asks for it", () => {
    expect(render(report, "text", { color: true })).toContain("\x1b[31m");
  });
});

describe("backslash continuations (review round 3)", () => {
  test("`from x \\` + newline + `import y` is caught", () => {
    const src = "from shop.infrastructure \\\n    import sql_orders\n";
    const [d] = engine.checkFile(file("shop/domain/order.py", src));
    expect(d?.message).toContain("shop.infrastructure.sql_orders");
  });

  test("`import \\` + newline + module is caught", () => {
    const src = "import \\\n    shop.infrastructure.db\n";
    expect(engine.checkFile(file("shop/domain/order.py", src))).toHaveLength(1);
  });
});

describe("source quirks (M0)", () => {
  test("a string holding `from a import (` cannot glue a real import onto it", () => {
    const src = 's = """\nfrom a import (\n"""\nimport shop.infrastructure\ny = """\n)\n"""\n';
    expect(engine.checkFile(file("shop/domain/order.py", src))).toHaveLength(1);
  });

  test("a lone \\r ends a line, as in Python", () => {
    const [d] = engine.checkFile(file("shop/domain/order.py", "# c\rimport shop.infrastructure\n"));
    expect(d?.line).toBe(2);
  });

  test("BOM is not a column, CRLF is a line break", () => {
    const src = "﻿import shop.api\r\nx = 1\r\nfrom shop.infrastructure \\\r\n  import db\r\n";
    const found = engine.checkFile(file("shop/domain/order.py", src));
    expect(found.map((d) => [d.line, d.column])).toEqual([
      [1, 8],
      [4, 10],
    ]);
  });
});
