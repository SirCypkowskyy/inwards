/**
 * @file The CLI and the language server build the same module index for the
 * same project (#44), and the session manifest sees the same modules (#191).
 * Both adapters feed the engine through its public ports, so any drift in
 * their file walks shows up here.
 */
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  Engine,
  layerPackages,
  moduleNameFor,
  type ProjectIndex,
  parseConfig,
} from "@inwards/core";
import { projectFiles } from "../../../vscode-extension/src/server/workspace.ts";
import { nodePlatform, nodeProjectIo } from "../../src/adapters/compose.ts";
import { loadGrammars } from "../../src/adapters/grammars.ts";
import { indexProject } from "../../src/project/check.ts";
import { projectConfigs, projectManifest } from "../../src/project/snapshot.ts";

// Its own directory: this file may import only the adapters, not the CLI's test support.
const TMP = mkdtempSync(join(tmpdir(), "inwards-parity-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const IO = nodeProjectIo(nodePlatform());

// #44: the CLI and the language server build the engine's module index from
// their own file walks; on the examples both must give the same answers.
const REPO = resolve(import.meta.dir, "../../../..");

/**
 * Builds the index the way the language server does, from its workspace listing.
 *
 * @param configPath - absolute path of the pyproject.toml.
 * @returns the language server's module index for that config.
 */
async function lspIndex(configPath: string): Promise<ProjectIndex> {
  const config = parseConfig(readFileSync(configPath, "utf8"));
  const engine = await Engine.create(await loadGrammars(), config);
  return engine.index(
    projectFiles(resolve(dirname(configPath), config.root), layerPackages(config)),
  );
}

for (const configPath of [
  join(REPO, "pyproject.toml"),
  join(REPO, "examples/broken-app/pyproject.toml"),
]) {
  test(`the CLI and the language server index ${configPath.slice(REPO.length + 1)} alike`, async () => {
    const cli = await indexProject(IO, configPath);
    const lsp = await lspIndex(configPath);
    const modules = [...cli.modules].sort();
    expect(modules.length).toBeGreaterThan(0);
    expect([...lsp.modules].sort()).toEqual(modules);
    for (const module of modules) {
      expect([...lsp.importersOf(module)].sort()).toEqual([...cli.importersOf(module)].sort());
      expect(lsp.ownerOf(`${module}.Name`)).toBe(cli.ownerOf(`${module}.Name`));
    }
    // Both examples have cross-module imports, so the reverse map is exercised.
    expect(modules.some((module) => cli.importersOf(module).size > 0)).toBe(true);
    expect(lsp.ownerOf("shop.nowhere")).toBe("shop");
    expect(cli.ownerOf("sqlalchemy.orm")).toBeUndefined();
  });
}

test("under selectors, the CLI, the session manifest and the language server list the same modules", async () => {
  const root = join(TMP, "selectors");
  for (const [rel, text] of Object.entries({
    "pyproject.toml": `[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.*.domain"] },
  { name = "infrastructure", modules = ["shop.*.infra"] },
]
`,
    "shop/__init__.py": "",
    "shop/orders/domain/order.py": "",
    "shop/orders/domain/node_modules/helper.py": "",
    "shop/orders/venv/pyvenv.cfg": "",
    "shop/orders/venv/moved.py": "",
    "shop/orders/__pycache__/cached.py": "",
    "shop/orders/infra/db.py": "",
    "shop/.hidden/secret.py": "",
    "node_modules/pkg/x.py": "",
    "venv/pyvenv.cfg": "",
    "venv/y.py": "",
    "tools/node_modules/z.py": "",
  })) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  symlinkSync(join(root, "shop/orders/infra"), join(root, "shop/billing"), "dir");
  const configPath = join(root, "pyproject.toml");
  const cli = [...(await indexProject(IO, configPath)).modules].sort();
  const platform = nodePlatform();
  const manifest = projectManifest(platform, root, projectConfigs(platform, root).valid);
  const listed = Object.keys(manifest)
    .map((path) => moduleNameFor(path).module)
    .sort();
  expect(cli).toEqual([
    "shop",
    "shop.billing.db",
    "shop.orders.__pycache__.cached",
    "shop.orders.domain.node_modules.helper",
    "shop.orders.domain.order",
    "shop.orders.infra.db",
    "shop.orders.venv.moved",
  ]);
  expect([...(await lspIndex(configPath)).modules].sort()).toEqual(cli);
  expect(listed).toEqual(cli);
});
