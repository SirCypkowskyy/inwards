import { expect, test } from "bun:test";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { inwards, LAYERS, project } from "./run.ts";

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

test("a symlinked alias of a layer can't hide its violations", () => {
  const root = project({
    "pyproject.toml": LAYERS,
    "shop/domain/order.py": "import shop.infrastructure.db\n",
  });
  symlinkSync(join(root, "shop/domain"), join(root, "aaa"));
  const { code, stdout } = inwards(["check", "--format", "json"], { cwd: root });
  expect(code).toBe(1);
  expect(JSON.parse(stdout).diagnostics.map((d: { module: string }) => d.module)).toEqual([
    "shop.domain.order",
  ]);
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
  expect(JSON.parse(stdout).diagnostics.map((d: { file: string }) => d.file)).toEqual([
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
  expect(JSON.parse(stdout).diagnostics.map((d: { file: string }) => d.file)).toEqual([
    `${dir}/leak.py`,
  ]);
});
