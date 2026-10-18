/**
 * @file A check of named files that are diagrams the `diagrams` key lists
 * (#348): what the PostToolUse hook, the language server and MCP
 * `check_files` run. `listsDiagram` decides by path text alone; `runCheck`
 * checks a listed diagram named as a target, from given text when there is
 * one, and leaves an unlisted Markdown file in `notChecked` instead of
 * reading it as Python. A check of Python files
 * reads no diagram. The findings themselves are the engine's and are tested
 * in core.
 */
import { expect, test } from "bun:test";
import { join } from "node:path";
import { parseConfig } from "@inwards/core";
import { runCheck } from "../../src/check/_check.ts";
import { configListsDiagram, listsDiagram } from "../../src/check/_diagrams.ts";
import type { ProjectIo } from "../../src/check/contracts.ts";
import { nodePlatform, nodeProjectIo } from "../../src/compose.ts";
import { LAYERS, project } from "../support/run.ts";

const ON = '\n[tool.inwards.rules]\nextend-select = ["INW017", "INW018"]\n';
const CONFIG = `${LAYERS}diagrams = ["docs/**/*.md", "docs/layers.mmd"]\n${ON}`;
/** A layers diagram with a typo in a label and an arrow pointing outwards. */
const DRAWN = [
  "# Architecture",
  "",
  "```mermaid",
  "%% inwards: layers",
  "flowchart LR",
  '  infrastructure["shop.infrastructure"] --> domain["shop.domian"]',
  "  domain --> infrastructure",
  "```",
  "",
].join("\n");

/**
 * Builds a project with a listed diagram, an unlisted Markdown file and code.
 *
 * @param config - the pyproject.toml text.
 * @returns the project directory and its config path.
 */
function setUp(config = CONFIG): { dir: string; configPath: string } {
  const dir = project({
    "pyproject.toml": config,
    "shop/__init__.py": "",
    "shop/domain/__init__.py": "",
    "shop/domain/order.py": "X = 1\n",
    "shop/infrastructure/__init__.py": "",
    "shop/infrastructure/db.py": "import shop.domain.order\n",
    "docs/architecture.md": DRAWN,
    "README.md": DRAWN,
  });
  return { dir, configPath: join(dir, "pyproject.toml") };
}

/**
 * Wraps the real project I/O so every text read is recorded.
 *
 * @param reads - collects the paths read.
 * @returns the I/O.
 */
function recording(reads: string[]): ProjectIo {
  const base = nodeProjectIo(nodePlatform());
  return {
    ...base,
    read: {
      ...base.read,
      text: (path: string): string => {
        reads.push(path);
        return base.read.text(path);
      },
    },
  };
}

test("listsDiagram matches the entries by path text, only while a diagram rule is on", () => {
  const dir = join("/", "work", "shop");
  const configPath = join(dir, "pyproject.toml");
  const config = parseConfig(CONFIG);
  expect(listsDiagram(configPath, config, join(dir, "docs", "architecture.md"))).toBe(true);
  expect(listsDiagram(configPath, config, join(dir, "docs", "c4", "context.md"))).toBe(true);
  expect(listsDiagram(configPath, config, join(dir, "docs", "layers.mmd"))).toBe(true);
  expect(listsDiagram(configPath, config, join(dir, "README.md"))).toBe(false);
  expect(listsDiagram(configPath, config, join("/", "work", "docs", "architecture.md"))).toBe(
    false,
  );
  const off = parseConfig(`${LAYERS}diagrams = ["docs/**/*.md"]\n`);
  expect(listsDiagram(configPath, off, join(dir, "docs", "architecture.md"))).toBe(false);
});

test("configListsDiagram answers no for a config that doesn't parse", () => {
  const { dir, configPath } = setUp("[tool.inwards]\nlayers = 3\n");
  const io = nodeProjectIo(nodePlatform());
  expect(configListsDiagram(io, configPath, join(dir, "docs", "architecture.md"))).toBe(false);
});

test("a listed diagram named as a target gets INW017 and INW018 on its own lines", async () => {
  const { dir, configPath } = setUp();
  const target = join(dir, "docs", "architecture.md");
  const report = await runCheck(nodeProjectIo(nodePlatform()), configPath, [target], {
    base: dir,
    edit: true,
    required: true,
  });
  expect(report.notChecked).toBeUndefined();
  expect(report.filesChecked).toBe(0);
  expect(report.diagnostics.map((d) => [d.code, d.file, d.line, d.severity])).toEqual([
    ["INW017", "docs/architecture.md", 6, "warning"],
    ["INW018", "docs/architecture.md", 7, "warning"],
  ]);
});

test("given text is checked instead of the disk's", async () => {
  const { dir, configPath } = setUp();
  const target = join(dir, "docs", "architecture.md");
  const fixed = DRAWN.replace("shop.domian", "shop.domain").replace(
    "  domain --> infrastructure\n",
    "",
  );
  const texts = new Map([[target, fixed]]);
  const report = await runCheck(nodeProjectIo(nodePlatform()), configPath, [target], {
    base: dir,
    texts,
  });
  expect(report.diagnostics).toEqual([]);
});

test("an unlisted file is not checked, and a Python check reads no diagram", async () => {
  const { dir, configPath } = setUp();
  const reads: string[] = [];
  const io = recording(reads);
  const readme = await runCheck(io, configPath, [join(dir, "README.md")], { base: dir });
  expect(readme.diagnostics).toEqual([]);
  expect(readme.notChecked).toEqual([
    {
      path: "README.md",
      message:
        "README.md is not a diagram that [tool.inwards].diagrams lists with INW017 or INW018 on, and was not checked.",
    },
  ]);
  const code = await runCheck(io, configPath, [join(dir, "shop", "domain", "order.py")], {
    base: dir,
    edit: true,
  });
  expect(code.diagnostics).toEqual([]);
  expect(reads.filter((path) => path.endsWith(".md"))).toEqual([]);
});
