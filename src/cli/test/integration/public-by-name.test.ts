/**
 * @file `public-by-name` end to end (#331): a context that opens its modules
 * by PEP 8's naming convention lets another context import a module nobody
 * listed, such as a new `exports.py`, and still reports a `_private` one, at
 * any depth below the context. A value that isn't a boolean is a config error
 * that names the key. Output isn't snapshotted; the JSON report is read.
 */
import { expect, test } from "bun:test";
import { inwards, project } from "../support/run.ts";

const CONFIG = `[tool.inwards]
layers = [{ name = "slices", modules = ["qv.catalog", "qv.orders"] }]

[[tool.inwards.contexts]]
name = "catalog"
modules = ["qv.catalog"]
public-by-name = true

[[tool.inwards.contexts]]
name = "orders"
modules = ["qv.orders"]
depends-on = ["catalog"]
`;

const FILES = {
  "qv/__init__.py": "",
  "qv/catalog/__init__.py": "from qv.catalog._impl import find\n",
  "qv/catalog/_impl.py": "def find() -> None:\n    pass\n",
  "qv/catalog/exports.py": "def export() -> None:\n    pass\n",
  "qv/catalog/sub/__init__.py": "",
  "qv/catalog/sub/_deep.py": "X = 1\n",
  "qv/orders/__init__.py": "",
};

/** One diagnostic of the JSON report, as far as these tests read it. */
interface Found {
  code: string;
  file: string;
  message: string;
  fix: { summary: string };
}

/**
 * Checks a project and reads its JSON report.
 *
 * @param caller - the source of `qv/orders/use.py`.
 * @param config - the pyproject.toml text.
 * @returns the exit code and the diagnostics.
 */
function check(caller: string, config = CONFIG): { code: number; diagnostics: Found[] } {
  const cwd = project({ ...FILES, "pyproject.toml": config, "qv/orders/use.py": caller });
  const { code, stdout } = inwards(["check", "--format", "json"], { cwd });
  const report: { diagnostics: Found[] } = JSON.parse(stdout);
  return { code, diagnostics: report.diagnostics };
}

test("an unlisted module without a _ segment is public, the facade too", () => {
  const caller = "from qv.catalog import find\nfrom qv.catalog.exports import export\n";
  expect(check(caller)).toEqual({ code: 0, diagnostics: [] });
});

test("a _private module is INW003, with the package that holds it as the fix", () => {
  const { code, diagnostics } = check("from qv.catalog._impl import find\n");
  expect(code).toBe(1);
  expect(diagnostics.map((d) => [d.code, d.file])).toEqual([["INW003", "qv/orders/use.py"]]);
  expect(diagnostics[0]?.message).toContain('"_impl" starts with an underscore');
  expect(diagnostics[0]?.fix.summary).toBe(
    'Import "find" from "qv.catalog", the public module of "catalog" that exposes it.',
  );
});

test("a _ segment deeper below the context is private too", () => {
  const { diagnostics } = check("from qv.catalog.sub._deep import X\n");
  expect(diagnostics.map((d) => d.code)).toEqual(["INW003"]);
});

test("a public-by-name that isn't a boolean is a config error naming the key", () => {
  const cwd = project({
    ...FILES,
    "pyproject.toml": CONFIG.replace("public-by-name = true", 'public-by-name = "yes"'),
  });
  const { code, stderr } = inwards(["check"], { cwd });
  expect(code).toBe(2);
  expect(stderr).toContain("tool.inwards.contexts[0].public-by-name must be true or false");
});
