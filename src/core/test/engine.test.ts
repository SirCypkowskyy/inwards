import { describe, expect, test } from "bun:test";
import { RULES, render } from "../src/index.ts";
import { check, file } from "./helpers.ts";

describe("INW001 layer-dependency", () => {
  test("domain importing infrastructure is a violation with a fix", () => {
    const [d, ...rest] = check(
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
    expect(check(file("shop/api/http.py", src))).toEqual([]);
  });

  test("relative imports resolve before the check", () => {
    const src = "from ..infrastructure import sql_orders\n";
    const [d] = check(file("shop/application/place_order.py", src));
    expect(d?.message).toContain("shop.infrastructure.sql_orders");
  });

  test("`from pkg import submodule` cannot sneak past the rule", () => {
    const [d] = check(file("shop/domain/order.py", "from shop import infrastructure\n"));
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
    const found = check(file("shop/domain/order.py", src));
    expect(found.map((d) => d.line)).toEqual([3, 5]);
  });

  test("files outside every layer are ignored", () => {
    expect(check(file("scripts/seed.py", "import shop.infrastructure\n"))).toEqual([]);
  });
});

describe("reporters", () => {
  const diagnostics = check(file("shop/domain/order.py", "import shop.infrastructure.db\n"));
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

  test("concise is one line per diagnostic with the first fix step", () => {
    const [line, summary, ...rest] = render(report, "concise").split("\n");
    expect(line).toStartWith("shop/domain/order.py:1:8: INW001 ");
    expect(line).toEndWith(`fix: ${diagnostics[0]?.fix.steps[0]}`);
    expect(summary).toStartWith("Found 1 violation");
    expect(rest).toEqual([]);
  });

  test("concise keeps a wrapped import on one line", () => {
    const wrapped = check(
      file("shop/domain/order.py", "from shop.infrastructure import (\n    db,\n)\n"),
    );
    const out = render({ ...report, diagnostics: wrapped }, "concise").split("\n");
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("fix: Delete `from shop.infrastructure import ( db, )`.");
  });

  test("sarif is never capped", () => {
    const sarif = JSON.parse(render(report, "sarif", { maxDiagnostics: 0 }));
    expect(sarif.runs[0].results).toHaveLength(1);
  });

  test("maxDiagnostics keeps errors first and still counts what it cut", () => {
    const [error] = diagnostics;
    const capped = {
      ...report,
      diagnostics: error ? [{ ...error, severity: "warning" as const, line: 9 }, error] : [],
    };
    const json = JSON.parse(render(capped, "json", { maxDiagnostics: 1 }));
    expect(json.summary).toMatchObject({ violations: 1, warnings: 1, omitted: 1 });
    expect(json.diagnostics.map((d: { line: number }) => d.line)).toEqual([1]);
    expect(render(capped, "concise", { maxDiagnostics: 1 })).toEndWith("Not shown: 1 warning.");
    expect(JSON.parse(render(report, "json", { maxDiagnostics: 1 })).summary.omitted).toBe(
      undefined,
    );
  });
});

describe("import skeleton prescan", () => {
  test("keeps line numbers and restores columns of nested imports", () => {
    const src = ["def f():", "    x = 1", "    import shop.infrastructure.db", ""].join("\n");
    const [d] = check(file("shop/domain/order.py", src));
    expect(d?.line).toBe(3);
    expect(d?.column).toBe(12);
  });

  test("multi-line parenthesised imports survive", () => {
    const src = "from shop.infrastructure.db import (\n    A,\n    B,\n)\nx = 1\n";
    expect(check(file("shop/domain/order.py", src))).toHaveLength(2);
  });

  test("an import after a semicolon forces the full parse and is still caught", () => {
    const src = "x = 1; import shop.infrastructure.db\n";
    expect(check(file("shop/domain/order.py", src))).toHaveLength(1);
  });

  test("import-looking text inside a docstring is not reported", () => {
    const src = '"""\nfrom shop.infrastructure.db import Table\n"""\n';
    expect(check(file("shop/domain/order.py", src))).toEqual([]);
  });
});

describe("text reporter colour", () => {
  const diagnostics = check(file("shop/domain/order.py", "import shop.api.http\n"));
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
    const [d] = check(file("shop/domain/order.py", src));
    expect(d?.message).toContain("shop.infrastructure.sql_orders");
  });

  test("`import \\` + newline + module is caught", () => {
    const src = "import \\\n    shop.infrastructure.db\n";
    expect(check(file("shop/domain/order.py", src))).toHaveLength(1);
  });
});

describe("source quirks (M0)", () => {
  test("a string holding `from a import (` cannot glue a real import onto it", () => {
    const src = 's = """\nfrom a import (\n"""\nimport shop.infrastructure\ny = """\n)\n"""\n';
    expect(check(file("shop/domain/order.py", src))).toHaveLength(1);
  });

  test("a lone \\r ends a line, as in Python", () => {
    const [d] = check(file("shop/domain/order.py", "# c\rimport shop.infrastructure\n"));
    expect(d?.line).toBe(2);
  });

  test("BOM is not a column, CRLF is a line break", () => {
    const src = "\uFEFFimport shop.api\r\nx = 1\r\nfrom shop.infrastructure \\\r\n  import db\r\n";
    const found = check(file("shop/domain/order.py", src));
    expect(found.map((d) => [d.line, d.column])).toEqual([
      [1, 8],
      [4, 10],
    ]);
  });
});

test("an import line inside a string cannot open a string that hides a real import", () => {
  const src = [
    's = """',
    "import a; t = '''",
    '"""',
    "import shop.infrastructure",
    'u = """',
    "import b; v = '''",
    '"""',
    "",
  ].join("\n");
  expect(check(file("shop/domain/order.py", src))).toHaveLength(1);
});

describe("dotted names as Python spells them (Astra review)", () => {
  test.each([
    ["spaces around dots", "import shop . infrastructure . db\n"],
    ["backslash inside the name", "import shop.\\\n  infrastructure\n"],
    ["spaces in a from import", "from shop . infrastructure import db\n"],
    ["NFKC identifiers", "import ｓhop.infrastructure\n"],
  ])("%s is still an import of shop.infrastructure", (_, src) => {
    const [d] = check(file("shop/domain/order.py", src));
    expect(d?.message).toContain("shop.infrastructure");
  });

  test("dots in a relative import are counted, not characters", () => {
    const [d] = check(file("shop/application/x.py", "from . . infrastructure import db\n"));
    expect(d?.message).toContain('"shop.infrastructure.db"');
  });
});

test("SARIF URIs keep #, ? and spaces inside the path", () => {
  const [d] = check(file("shop/domain/order#1 ?.py", "import shop.api\n"));
  const sarif = JSON.parse(
    render({ diagnostics: d ? [d] : [], filesChecked: 1, durationMs: 1 }, "sarif"),
  );
  const { uri } = sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation;
  expect(uri).toBe("shop/domain/order%231%20%3F.py");
  expect(decodeURIComponent(new URL(uri, "file:///repo/").pathname.slice(6))).toBe(
    "shop/domain/order#1 ?.py",
  );
});

describe("source encodings (Astra review, round 2)", () => {
  test.each([
    ["unicode_escape", "# coding: unicode_escape\n#\\u000aimport shop.infrastructure.db\n"],
    ["utf-7 on line 2", "#!/usr/bin/env python\n# -*- coding: utf-7 -*-\nx = 1\n"],
  ])("%s gets INW000 instead of a silent pass", (_, src) => {
    const found = check(file("shop/domain/order.py", src));
    expect(found.map((d) => d.code)).toEqual(["INW000"]);
  });

  test.each(["utf-8", "UTF8", "latin-1", "iso-8859-2", "ascii"])(
    "%s is read as usual",
    (encoding) => {
      const src = `# coding: ${encoding}\nimport shop.infrastructure.db\n`;
      expect(check(file("shop/domain/order.py", src)).map((d) => d.code)).toEqual(["INW001"]);
    },
  );

  test("a declaration on line 2 counts only after a comment or blank line 1", () => {
    const src = "x = 1\n# coding: unicode_escape\n";
    expect(check(file("shop/domain/order.py", src))).toEqual([]);
  });

  test("files outside every layer are not reported", () => {
    const src = "# coding: unicode_escape\n";
    expect(check(file("scripts/tool.py", src))).toEqual([]);
  });
});

describe("encoding declarations CPython honours (review of round 2)", () => {
  test.each([
    [
      "CRLF with a shebang on line 1",
      "#!/usr/bin/env python\r\n# coding: unicode_escape\r\nx = 1\r\n",
    ],
    ["CRLF with a blank line 1", "\r\n# coding: unicode_escape\r\nx = 1\r\n"],
    ["U+2028 inside the comment", "# note  coding: unicode_escape\nx = 1\n"],
  ])("%s gets INW000", (_, src) => {
    expect(check(file("shop/domain/order.py", src)).map((d) => d.code)).toEqual(["INW000"]);
  });
});

describe("rule registry", () => {
  test("SARIF lists exactly the registered rules, with their default level", () => {
    const sarif = JSON.parse(render({ diagnostics: [], filesChecked: 0, durationMs: 0 }, "sarif"));
    const { rules } = sarif.runs[0].tool.driver;
    const levels = rules.map((r: { id: string; defaultConfiguration: { level: string } }) => [
      r.id,
      r.defaultConfiguration.level,
    ]);
    expect(levels).toEqual(Object.values(RULES).map((r) => [r.code, r.severity]));
  });

  test("each registry key is its rule's code", () => {
    for (const [key, rule] of Object.entries(RULES)) {
      expect(rule.code === key).toBe(true);
    }
  });

  test("every diagnostic the engine emits comes from a registered rule", () => {
    const found = [
      ...check(file("shop/domain/a.py", "import shop.api\n")),
      ...check(file("shop/domain/b.py", "# coding: utf-7\n")),
    ];
    for (const d of found) {
      const rule = Object.values(RULES).find((r) => r.code === d.code);
      expect([d.rule, d.docs]).toEqual([rule?.name ?? "missing", rule?.docs ?? "missing"]);
    }
  });
});
