/**
 * @file INW014 in the presets with an `application/ports/` package, clean and
 * hexagonal: the scaffold passes with the rule on as a warning, and a
 * concrete method or a concrete class planted in the scaffold's port module
 * gets an INW014 warning whose fix names the preset's adapter layer.
 * Each test runs init on a fresh uv project, then edits the port by hand.
 */
import { describe, expect, test } from "bun:test";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findings, init, PASSING, UV_PROJECT } from "../support/init-style-helpers.ts";
import { inwards, project } from "../support/run.ts";

/** The scaffold's port module, relative to the project. */
const PORT = "src/my_app/application/ports/orders.py";

/**
 * Scaffolds a preset on a fresh uv project.
 *
 * @param style - the preset, `clean` or `hexagonal`.
 * @returns the project directory, init's exit code and the findings of a check right after.
 */
function scaffolded(style: string): {
  root: string;
  init: number;
  check: ReturnType<typeof findings>;
} {
  const root = project(UV_PROJECT);
  const run = init(root, "--style", style, "--scaffold");
  return { root, init: run.code, check: findings(root) };
}

/**
 * Runs `inwards check --format json` and keeps the INW014 findings.
 *
 * @param root - the project directory.
 * @returns the exit code, each INW014 finding's file, severity and fix summary, and how many other findings there were.
 */
function portFindings(root: string): {
  code: number;
  found: { file: string; severity: string; fix: string }[];
  others: number;
} {
  const { code, stdout } = inwards(["check", "--format", "json"], { cwd: root });
  const { diagnostics } = JSON.parse(stdout);
  const found: { file: string; severity: string; fix: string }[] = [];
  let others = 0;
  for (const d of diagnostics) {
    if (d.code === "INW014") {
      found.push({ file: d.file, severity: d.severity, fix: d.fix.summary });
    } else {
      others += 1;
    }
  }
  return { code, found, others };
}

describe.each([
  ["clean", "infrastructure"],
  ["hexagonal", "outbound"],
])("%s: INW014 ports-abstract", (style, adapters) => {
  test("is on as a warning, and the scaffold's port passes", () => {
    const { root, init: code, check } = scaffolded(style);
    expect({ init: code, check }).toEqual(PASSING);
    const text = readFileSync(join(root, "pyproject.toml"), "utf8");
    expect(text).toContain('extend-select = ["INW014", "INW015"]');
    expect(text).toContain('[tool.inwards.rules.severity]\nINW014 = "warning"\n');
    expect(text).not.toContain("[tool.inwards.rules.ports-abstract]");
  });

  test("a concrete method in the port module is an INW014 warning", () => {
    const { root } = scaffolded(style);
    const path = join(root, PORT);
    const text = readFileSync(path, "utf8");
    const stub = '        """Saves an order."""\n        ...\n';
    expect(text).toContain(stub);
    writeFileSync(
      path,
      text.replace(stub, '        """Saves an order."""\n        print("saving", order.id)\n'),
    );
    const { code, found, others } = portFindings(root);
    expect({ code, others, files: found.map((f) => `${f.file} ${f.severity}`) }).toEqual({
      code: 0,
      others: 0,
      files: [`${PORT} warning`],
    });
    expect(found[0]?.fix).toContain(`(layer \`${adapters}\`)`);
  });

  test("a concrete class added to the port module is an INW014 warning", () => {
    const { root } = scaffolded(style);
    appendFileSync(
      join(root, PORT),
      [
        "",
        "",
        "class InMemoryOrders:",
        '    """Keeps orders in a dict."""',
        "",
        "    def __init__(self) -> None:",
        "        self._orders: dict[str, Order] = {}",
        "",
      ].join("\n"),
    );
    const { code, found, others } = portFindings(root);
    expect({ code, others, files: found.map((f) => `${f.file} ${f.severity}`) }).toEqual({
      code: 0,
      others: 0,
      files: [`${PORT} warning`],
    });
    expect(found[0]?.fix).toContain(`(layer \`${adapters}\`)`);
  });
});
