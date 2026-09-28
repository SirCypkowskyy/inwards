/**
 * @file `inwards check` output paths on every OS: diagnostics and SARIF use
 * forward slashes. A `--config` spelled through a link to the project names
 * files from the real cwd (the macOS /var case). A named path outside the
 * config root is reported in every format instead of passing as clean (#200).
 */
import { expect, test } from "bun:test";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { inwards, LAYERS, project } from "../support/run.ts";

/**
 * Reads the errors from a JSON report, leaving out INW006 warnings.
 *
 * @param stdout - `inwards check --format json` output.
 * @returns the diagnostics whose severity is error.
 */
function errors(stdout: string): { file: string; module: string; severity: string }[] {
  const report: { diagnostics: { file: string; module: string; severity: string }[] } =
    JSON.parse(stdout);
  return report.diagnostics.filter((d) => d.severity === "error");
}

const leak = project({
  "pyproject.toml": LAYERS,
  "shop/domain/deep/order.py": "import shop.infrastructure.db\n",
});

test("diagnostic paths use forward slashes on every OS", () => {
  const { code, stdout } = inwards(["check", "--format", "json"], { cwd: leak });
  expect(code).toBe(1);
  expect(JSON.parse(stdout).diagnostics[0].file).toBe("shop/domain/deep/order.py");
});

test("SARIF artifact URIs use forward slashes on every OS", () => {
  const { stdout } = inwards(["check", "--format", "sarif"], { cwd: leak });
  const uri = JSON.parse(stdout).runs[0].results[0].locations[0].physicalLocation.artifactLocation;
  expect(uri).toEqual({ uri: "shop/domain/deep/order.py", uriBaseId: "%SRCROOT%" });
});

test("--config through a link to the project names files from the real cwd (macOS /var)", () => {
  const real = project({
    "pyproject.toml": LAYERS.replace('"shop.domain"', '"shop.domain", "shop.gone"'),
    "shop/domain/order.py": "import shop.infrastructure.db\n",
    "shop/infrastructure/db.py": "",
  });
  const link = `${real}-link`;
  symlinkSync(real, link);
  // The CLI's cwd is always real; the config path keeps the link as written.
  const config = join(link, "pyproject.toml");
  const { stdout } = inwards(["check", "--format", "json", "--config", config], { cwd: real });
  const files = JSON.parse(stdout).diagnostics.map((d: { file: string }) => d.file);
  expect(files).toEqual(["pyproject.toml", "shop/domain/order.py"]);
});

test("a symlinked alias of a layer can't hide its violations", () => {
  const root = project({
    "pyproject.toml": LAYERS,
    "shop/domain/order.py": "import shop.infrastructure.db\n",
  });
  symlinkSync(join(root, "shop/domain"), join(root, "aaa"));
  const { code, stdout } = inwards(["check", "--format", "json"], { cwd: root });
  expect(code).toBe(1);
  expect(errors(stdout).map((d: { module: string }) => d.module)).toEqual(["shop.domain.order"]);
});

test("a stub next to its module is checked too", () => {
  const root = project({
    "pyproject.toml": LAYERS,
    "shop/domain/order.py": "X = 1\n",
    "shop/domain/order.pyi": "import shop.infrastructure.db\n",
  });
  const { code } = inwards(["check", "--format", "json"], { cwd: root });
  expect(code).toBe(1);
});

test("a module under shop/domain/build/ is checked", () => {
  const root = project({
    "pyproject.toml": LAYERS,
    "shop/domain/build/leak.py": "import shop.infrastructure.db\n",
  });
  const { code, stdout } = inwards(["check", "--format", "json"], { cwd: root });
  expect(code).toBe(1);
  expect(JSON.parse(stdout).diagnostics[0].module).toBe("shop.domain.build.leak");
});

test("a pyvenv.cfg above a layer, or a symlink into a disguised directory, can't hide it", () => {
  const root = project({
    "pyproject.toml": LAYERS,
    "shop/pyvenv.cfg": "",
    "shop/domain/order.py": "import shop.infrastructure.db\n",
    "vendor/pyvenv.cfg": "",
    "vendor/leak.py": "import shop.infrastructure.db\n",
  });
  symlinkSync(join(root, "vendor"), join(root, "shop/domain/sub"), "dir");
  const { stdout } = inwards(["check", "--format", "json"], { cwd: root });
  expect(errors(stdout).map((d: { file: string }) => d.file)).toEqual([
    "shop/domain/order.py",
    "shop/domain/sub/leak.py",
  ]);
});

test.each([
  ["a pyvenv.cfg", "shop/domain/sub/pyvenv.cfg"],
  ["a node_modules name", "shop/domain/node_modules/__init__.py"],
])("%s inside a layer can't hide a violation, while a real venv stays skipped", (_, marker) => {
  const dir = marker.split("/").slice(0, 3).join("/");
  const root = project({
    "pyproject.toml": LAYERS,
    [marker]: "",
    [`${dir}/leak.py`]: "import shop.infrastructure.db\n",
    ".venv/pyvenv.cfg": "",
    "venv/pyvenv.cfg": "",
    "venv/lib/shop/domain/x.py": "import shop.infrastructure.db\n",
  });
  const { code, stdout } = inwards(["check", "--format", "json"], { cwd: root });
  expect(code).toBe(1);
  expect(errors(stdout).map((d: { file: string }) => d.file)).toEqual([`${dir}/leak.py`]);
});

/** A config whose root is `src`, with a file outside it that would break a layer. */
const rooted = project({
  "pyproject.toml": `[tool.inwards]
root = "src"
layers = [{ name = "core", modules = ["core"] }, { name = "app", modules = ["app"] }]
`,
  "src/core/order.py": "import app.web\n",
  "src/app/web.py": "",
  "src/empty/README.md": "",
  "tools/x.py": "import app\n",
});
const OUTSIDE = 'tools/x.py is outside root "src" and was not checked.';

test("a path outside the config root warns and exits 2, not All clear (#200)", () => {
  // concise: text is coloured here (FORCE_COLOR), and both share the footer.
  const { code, stdout } = inwards(["check", "--format", "concise", "tools/x.py"], { cwd: rooted });
  expect(code).toBe(2);
  expect(stdout).toContain(`warning: ${OUTSIDE}`);
  expect(stdout).toContain("Nothing checked: 0 files");
  expect(stdout).not.toContain("All clear");
});

test("a directory under the root with no Python files warns and exits 2", () => {
  const { code, stdout } = inwards(["check", "src/empty"], { cwd: rooted });
  expect(code).toBe(2);
  expect(stdout).toContain("src/empty has no Python files to check.");
  expect(stdout).toContain("Nothing checked:");
});

test("a mix of paths checks the ones inside the root and warns about the rest", () => {
  const { code, stdout } = inwards(["check", "--format", "json", "tools", "src/core/order.py"], {
    cwd: rooted,
  });
  expect(code).toBe(1);
  const report = JSON.parse(stdout);
  expect(report.summary.filesChecked).toBe(1);
  expect(report.diagnostics.map((d: { file: string }) => d.file)).toEqual(["src/core/order.py"]);
  expect(report.notChecked).toEqual([
    { path: "tools", message: 'tools is outside root "src" and was not checked.' },
  ]);
});

test("SARIF carries a path outside the root as a warning notification", () => {
  const { code, stdout } = inwards(["check", "--format", "sarif", "tools/x.py"], { cwd: rooted });
  expect(code).toBe(2);
  expect(JSON.parse(stdout).runs[0].invocations).toEqual([
    {
      executionSuccessful: false,
      toolExecutionNotifications: [
        {
          level: "warning",
          message: { text: OUTSIDE },
          locations: [
            {
              physicalLocation: { artifactLocation: { uri: "tools/x.py", uriBaseId: "%SRCROOT%" } },
            },
          ],
        },
      ],
    },
  ]);
});

test("a directory that holds the root, and a whole-project run, report nothing unchecked", () => {
  for (const args of [
    ["check", "--format", "json", "."],
    ["check", "--format", "json"],
  ]) {
    const { code, stdout } = inwards(args, { cwd: rooted });
    expect(code).toBe(1);
    expect(JSON.parse(stdout).notChecked).toBeUndefined();
  }
});

test("a named path that doesn't exist is a usage error", () => {
  const { code, stdout, stderr } = inwards(["check", "nope.py"], { cwd: rooted });
  expect(code).toBe(2);
  expect(stdout).toBe("");
  expect(stderr).toBe("nope.py is not a file or directory.\n");
});
