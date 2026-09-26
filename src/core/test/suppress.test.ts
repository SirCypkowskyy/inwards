/**
 * Inline suppressions (#50, ADR-028): `# inwards: ignore[CODE] reason="..."`
 * on the line a finding points at.
 */
import { describe, expect, test } from "bun:test";
import { ConfigError, Engine, parseConfig, render } from "../src/index.ts";
import { file, grammars, PROJECT } from "./helpers.ts";

const LAYERS = `[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]
`;
const engine: Engine = await Engine.create(grammars(), parseConfig(LAYERS));
const REASON = 'reason="legacy, tracked in #12"';

/**
 * Checks one domain module.
 *
 * @param text - its source.
 * @param using - the engine to check with.
 * @returns `line:code:severity` of each diagnostic, and `line:code:reason` of each suppressed finding.
 */
function run(text: string, using: Engine = engine): { found: string[]; hidden: string[] } {
  const { diagnostics, suppressed } = using.check([file("shop/domain/order.py", text)], PROJECT);
  return {
    found: diagnostics.map((d) => `${d.line}:${d.code}:${d.severity}`),
    hidden: suppressed.map((s) => `${s.diagnostic.line}:${s.diagnostic.code}:${s.reason}`),
  };
}

/**
 * Finds the one INW009 message in a check.
 *
 * @param text - the domain module's source.
 * @returns the message.
 */
function inw009(text: string): string {
  const d = engine
    .checkFiles([file("shop/domain/order.py", text)], PROJECT)
    .filter((x) => x.code === "INW009");
  if (d.length !== 1) {
    throw new Error(`expected one INW009, got ${d.length}`);
  }
  return d[0]?.message ?? "";
}

describe("a valid suppression", () => {
  test("hides the finding on its line and keeps the reason", () => {
    const got = run(`import shop.infrastructure.db  # inwards: ignore[INW001] ${REASON}\n`);
    expect(got).toEqual({ found: [], hidden: ["1:INW001:legacy, tracked in #12"] });
  });

  test("hides only its own line", () => {
    const got = run(
      `import shop.infrastructure.db  # inwards: ignore[INW001] ${REASON}\nimport shop.infrastructure.cache\n`,
    );
    expect(got.found).toEqual(["2:INW001:error"]);
  });

  test("can name several codes, and follow another tool's comment", () => {
    const text = `from shop.infrastructure import db; import sqlalchemy  # noqa: E702  # inwards: ignore[INW001, INW005] ${REASON}\n`;
    expect(run(text)).toEqual({
      found: [],
      hidden: ["1:INW001:legacy, tracked in #12", "1:INW005:legacy, tracked in #12"],
    });
  });

  test("in a parenthesised import, goes on the name's line", () => {
    const named = `from shop.infrastructure import (\n    db,  # inwards: ignore[INW001] ${REASON}\n)\n`;
    expect(run(named).found).toEqual([]);
    const opening = `from shop.infrastructure import (  # inwards: ignore[INW001] ${REASON}\n    db,\n)\n`;
    expect(run(opening).found).toEqual(["1:INW009:warning", "2:INW001:error"]);
  });

  test("works on a dynamic import (INW011)", () => {
    const text = `import importlib\nimportlib.import_module("shop.infrastructure.db")  # inwards: ignore[INW011] ${REASON}\n`;
    expect(run(text).found).toEqual([]);
  });

  test("works on an import of a first-party module that doesn't exist (INW010)", () => {
    const text = "from shop.domain.pricing import DiscountPolicy\n";
    expect(run(text).found).toEqual(["1:INW010:error"]);
    expect(run(text.replace("\n", `  # inwards: ignore[INW010] ${REASON}\n`)).found).toEqual([]);
  });

  test("covers a multi-line dynamic import from the call's first line (INW011)", () => {
    const call = 'importlib.import_module(\n    "shop.infrastructure.db",\n)\n';
    expect(run(`import importlib\n${call}`).found).toEqual(["2:INW011:error"]);
    const first = call.replace("(\n", `(  # inwards: ignore[INW011] ${REASON}\n`);
    expect(run(`import importlib\n${first}`).found).toEqual([]);
    const inside = call.replace('",\n', `",  # inwards: ignore[INW011] ${REASON}\n`);
    expect(run(`import importlib\n${inside}`).found).toEqual([
      "2:INW011:error",
      "3:INW009:warning",
    ]);
  });

  test("covers a dynamic import whose target can't be read (INW011)", () => {
    const text = "import importlib\nname = 'x'\nimportlib.import_module(name)\n";
    expect(run(text).found).toEqual(["3:INW011:error"]);
    const hidden = text.replace("(name)\n", `(name)  # inwards: ignore[INW011] ${REASON}\n`);
    expect(run(hidden)).toEqual({ found: [], hidden: ["3:INW011:legacy, tracked in #12"] });
  });

  test("the language server's single-file check honours it too", () => {
    const text = `import shop.infrastructure.db  # inwards: ignore[INW001] ${REASON}\n`;
    expect(engine.checkFile(file("shop/domain/order.py", text), PROJECT)).toEqual([]);
  });

  test("text inside a string is not a comment", () => {
    const text = `import shop.infrastructure.db; x = "# inwards: ignore[INW001] ${REASON.replaceAll('"', "'")}"\n`;
    expect(run(text).found).toEqual(["1:INW001:error"]);
    const quoted = `import shop.infrastructure.db; x = """\n# inwards: ignore[INW001] ${REASON}\n"""\n`;
    expect(run(quoted).found).toEqual(["1:INW001:error"]);
  });
});

describe("an invalid suppression hides nothing and is an INW009 error", () => {
  test("without a reason", () => {
    const text = "import shop.infrastructure.db  # inwards: ignore[INW001]\n";
    expect(run(text).found).toEqual(["1:INW001:error", "1:INW009:error"]);
    expect(inw009(text)).toContain("It has no reason");
  });

  test("with an empty reason", () => {
    const text = 'import shop.infrastructure.db  # inwards: ignore[INW001] reason="  "\n';
    expect(run(text).found).toEqual(["1:INW001:error", "1:INW009:error"]);
  });

  test("with an unknown code", () => {
    const text = `import shop.infrastructure.db  # inwards: ignore[INW001,INW099] ${REASON}\n`;
    expect(run(text).found).toEqual(["1:INW001:error", "1:INW009:error"]);
    expect(inw009(text)).toContain("INW099 is not a rule this Inwards knows");
  });

  test("with a code that can't be suppressed", () => {
    for (const code of ["INW000", "INW007", "INW008", "INW009"]) {
      const text = `import shop.infrastructure.db  # inwards: ignore[${code}] ${REASON}\n`;
      expect(inw009(text)).toContain(`${code} can't be suppressed inline`);
    }
  });

  test("with a second directive in the same comment", () => {
    const text = `import shop.infrastructure.db  # inwards: ignore[INW001] ${REASON}  # inwards: ignore[INW005] ${REASON}\n`;
    expect(run(text).found).toEqual(["1:INW001:error", "1:INW009:error"]);
    expect(inw009(text)).toContain("second `inwards: ignore`");
  });

  test("when it isn't in the documented form", () => {
    for (const comment of [
      "# inwards: ignore",
      "# inwards: ignore[] reason='x'",
      "# inwards: ignore[INW001] because it is old",
      "# inwards: ignore INW001",
    ]) {
      const text = `import shop.infrastructure.db  ${comment}\n`;
      expect(run(text).found).toEqual(["1:INW001:error", "1:INW009:error"]);
    }
    expect(inw009("import os  # inwards: ignore\n")).toContain("isn't in the form");
  });
});

describe("an unused suppression", () => {
  test("is an INW009 warning naming the unused code", () => {
    const text = `import shop.infrastructure.db  # inwards: ignore[INW001,INW005] ${REASON}\n`;
    expect(run(text).found).toEqual(["1:INW009:warning"]);
    expect(inw009(text)).toContain("suppression of INW005 matches no finding");
  });

  test("is reported once per comment, in every file", () => {
    const text = `import os  # inwards: ignore[INW001] ${REASON}\nimport re  # inwards: ignore[INW001] ${REASON}\n`;
    const found = engine.checkFiles(
      [file("shop/domain/order.py", text), file("shop/domain/cart.py", text)],
      PROJECT,
    );
    expect(found.map((d) => `${d.module}:${d.line}:${d.code}`)).toEqual([
      "shop.domain.order:1:INW009",
      "shop.domain.order:2:INW009",
      "shop.domain.cart:1:INW009",
      "shop.domain.cart:2:INW009",
    ]);
  });

  test("isn't reported for a rule that is off, and a rule that is off has nothing suppressed", async () => {
    const off = await Engine.create(
      grammars(),
      parseConfig(`${LAYERS}\n[tool.inwards.rules]\nignore = ["INW001"]\n`),
    );
    const text = `import shop.infrastructure.db  # inwards: ignore[INW001] ${REASON}\nimport os  # inwards: ignore[INW001] ${REASON}\n`;
    expect(run(text, off)).toEqual({ found: [], hidden: [] });
  });

  test("INW009 follows [tool.inwards.rules] like any rule", async () => {
    const quiet = await Engine.create(
      grammars(),
      parseConfig(`${LAYERS}\n[tool.inwards.rules]\nignore = ["INW009"]\n`),
    );
    expect(run("import shop.infrastructure.db  # inwards: ignore[INW001]\n", quiet).found).toEqual([
      "1:INW001:error",
    ]);
  });

  test("a file with INW000 is left alone", () => {
    const text = `# coding: utf-7\nimport os  # inwards: ignore[INW001] ${REASON}\n`;
    expect(run(text).found).toEqual(["1:INW000:error"]);
  });
});

describe("reports count suppressions", () => {
  const { diagnostics, suppressed } = engine.check(
    [
      file(
        "shop/domain/order.py",
        `import shop.infrastructure.db  # inwards: ignore[INW001] ${REASON}\n`,
      ),
    ],
    PROJECT,
  );
  const report = { diagnostics, suppressed, filesChecked: 1, durationMs: 1 };

  test("text and concise output count them in the summary", () => {
    expect(render(report, "text")).toContain("1 finding suppressed by inline comments.");
    expect(render(report, "concise")).toContain("1 finding suppressed by inline comments.");
    expect(render({ ...report, suppressed: [] }, "text")).not.toContain("suppressed");
  });

  test("JSON counts them in the summary, only when there are some", () => {
    expect(JSON.parse(render(report, "json")).summary.suppressed).toBe(1);
    expect(JSON.parse(render({ ...report, suppressed: [] }, "json")).summary).not.toHaveProperty(
      "suppressed",
    );
  });

  test("SARIF lists them as results with an inSource suppression", () => {
    const [result] = JSON.parse(render(report, "sarif")).runs[0].results;
    expect(result.ruleId).toBe("INW001");
    expect(result.suppressions).toEqual([
      { kind: "inSource", justification: "legacy, tracked in #12" },
    ]);
  });
});

describe("agent-suppressions", () => {
  test("reads deny or allow, absent by default", () => {
    expect(parseConfig(LAYERS).agentSuppressions).toBeUndefined();
    expect(parseConfig(`${LAYERS}agent-suppressions = "allow"\n`).agentSuppressions).toBe("allow");
    expect(parseConfig(`${LAYERS}agent-suppressions = "deny"\n`).agentSuppressions).toBe("deny");
  });

  test("anything else is a config error", () => {
    expect(() => parseConfig(`${LAYERS}agent-suppressions = true\n`)).toThrow(ConfigError);
    expect(() => parseConfig(`${LAYERS}agent-suppressions = "ask"\n`)).toThrow(
      'tool.inwards.agent-suppressions must be "deny" or "allow".',
    );
  });
});
