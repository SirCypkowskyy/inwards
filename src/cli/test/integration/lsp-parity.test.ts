/**
 * @file The CLI and the language server build the same module index for the
 * same project (#44). Both adapters feed the engine through its public ports,
 * so any drift in their file walks shows up here.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Engine, type ProjectIndex, parseConfig } from "@inwards/core";
import { projectFiles } from "../../../vscode-extension/src/workspace.ts";
import { nodePlatform, nodeProjectIo } from "../../src/adapters/compose.ts";
import { loadGrammars } from "../../src/adapters/grammars.ts";
import { indexProject } from "../../src/project/check.ts";

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
  return engine.index(projectFiles(resolve(dirname(configPath), config.root)));
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
