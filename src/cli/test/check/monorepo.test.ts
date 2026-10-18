/**
 * @file `inwards check` in a uv workspace (#57): at the workspace root it checks
 * every member that has its own `[tool.inwards]` with that config, routes
 * named paths to their nearest config, and never checks a member's files
 * under the root's config as well. The fixture (`fixtures/workspace`) has two
 * configured members sharing the implicit namespace package `acme`, whose
 * relative imports reach into the other member, and one member without a config.
 */
import { describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { inwards, project } from "../support/run.ts";
import { tempDir } from "../support/temp.ts";

const FIXTURE = join(import.meta.dir, "../support/fixtures/workspace");

/** The fixture's root pyproject.toml with a `[tool.inwards]` of its own. */
const ROOT_CONFIG = `[project]
name = "acme"
version = "0.1.0"

[tool.uv.workspace]
members = ["packages/*"]

[tool.inwards]
layers = [{ name = "scripts", modules = ["scripts"] }]
`;

/**
 * Copies the workspace fixture to a temp directory, so no config above it
 * (this repository's own) is found and a test can change files.
 *
 * @param changes - files to write over the copy, by workspace-relative path.
 * @returns the copy's root.
 */
function workspace(changes: Record<string, string> = {}): string {
  const root = join(tempDir("inwards-ws-"), "acme");
  cpSync(FIXTURE, root, { recursive: true });
  for (const [rel, text] of Object.entries(changes)) {
    writeFileSync(join(root, rel), text);
  }
  return root;
}

/** The parts of a JSON report these tests read. */
interface JsonReport {
  summary: { filesChecked: number; violations: number; warnings: number };
  notChecked?: { path: string; message: string }[];
  diagnostics: { code: string; file: string; message: string }[];
}

/**
 * Runs `inwards check --format json` and parses the report.
 *
 * @param cwd - where to run.
 * @param args - more arguments, such as paths.
 * @returns the exit code, the report and stderr.
 */
function checkJson(
  cwd: string,
  args: string[] = [],
): { code: number; report: JsonReport; stderr: string } {
  const { code, stdout, stderr } = inwards(["check", "--format", "json", ...args], { cwd });
  const report: JsonReport = JSON.parse(stdout);
  return { code, report, stderr };
}

/**
 * Reads the one line a check wrote to a member's run log.
 *
 * @param root - the workspace copy.
 * @param member - the member directory, workspace-relative.
 * @returns the line's codes and files.
 */
function runLine(root: string, member: string): { codes: string[]; files: string[] } {
  return JSON.parse(readFileSync(join(root, member, ".inwards/runs.jsonl"), "utf8"));
}

/**
 * Writes a member pyproject.toml whose one layer is a package.
 *
 * @param pkg - the package, also the project name.
 * @returns the pyproject.toml text.
 */
function oneLayer(pkg: string): string {
  return `[project]\nname = "${pkg}"\n\n[tool.inwards]\nlayers = [{ name = "app", modules = ["${pkg}"] }]\n`;
}

describe("inwards check at a uv workspace root (#57)", () => {
  test("the fixture monorepo passes: each member with its own config", () => {
    const root = workspace();
    const { code, stdout } = inwards(["check", "--format", "concise"], { cwd: root });
    expect(code).toBe(0);
    expect(stdout).toContain(
      "warning: packages/tools has no [tool.inwards] table, so it was not checked.",
    );
    expect(stdout).toContain("All clear: 6 files, 0 violations");
    expect(stdout).toContain("packages/api/pyproject.toml: 2 files, 0 violations, 0 warnings");
    expect(stdout).toContain("packages/core/pyproject.toml: 4 files, 0 violations, 0 warnings");
  });

  test("JSON is one report, with the member left out in notChecked", () => {
    const { code, report } = checkJson(workspace());
    expect(code).toBe(0);
    expect(report.summary.filesChecked).toBe(6);
    expect(report.notChecked).toEqual([
      {
        path: "packages/tools",
        message: "packages/tools has no [tool.inwards] table, so it was not checked.",
      },
    ]);
  });

  test("a violation in one member fails the run, with paths from the workspace root", () => {
    const root = workspace({
      "packages/core/src/acme/core/domain/money.py": "from ..services import checkout\n",
    });
    const { code, report } = checkJson(root);
    expect(code).toBe(1);
    expect(report.diagnostics.map((d) => [d.code, d.file])).toEqual([
      ["INW001", "packages/core/src/acme/core/domain/money.py"],
    ]);
  });

  test("a relative import into a namespace package portion is looked up in the other member", () => {
    // With registry.py in packages/core, the fixture passes (the first test); without it, INW010.
    const root = workspace();
    rmSync(join(root, "packages/core/src/acme/plugins/registry.py"));
    const { code, report } = checkJson(root);
    expect(code).toBe(1);
    expect(report.diagnostics.find((d) => d.code === "INW010")).toMatchObject({
      file: "packages/api/src/acme/plugins/api_plugin.py",
      message:
        '"acme.plugins.registry" is not a module of this project: "acme.plugins" has no "registry".',
    });
  });

  test("a portion installed in the workspace root's .venv counts too (#161)", () => {
    const root = workspace();
    rmSync(join(root, "packages/core/src/acme/plugins/registry.py"));
    const site = join(root, ".venv/lib/python3.12/site-packages/acme/plugins");
    mkdirSync(site, { recursive: true });
    writeFileSync(join(site, "registry.py"), "");
    // Core's plugins layer is empty now (INW006); api's import of the registry must pass.
    const { report } = checkJson(root);
    expect(report.diagnostics.filter((d) => d.code === "INW010")).toEqual([]);
  });

  test("inside a member only that member is checked", () => {
    const { code, stdout } = inwards(["check", "--format", "concise"], {
      cwd: join(workspace(), "packages/api"),
    });
    expect(code).toBe(0);
    expect(stdout).toContain("All clear: 2 files, 0 violations");
    expect(stdout).not.toContain("pyproject.toml:");
  });

  test("an invalid member config is a config error; the other members still run", () => {
    const root = workspace({ "packages/api/pyproject.toml": "[tool.inwards]\nlayers = 3\n" });
    const { code, stdout, stderr } = inwards(["check", "--format", "concise"], { cwd: root });
    expect(code).toBe(2);
    expect(stderr).toContain("config error in packages/api/pyproject.toml:");
    expect(stdout).toContain("packages/api/pyproject.toml: config error");
    expect(stdout).toContain("packages/core/pyproject.toml: 4 files, 0 violations, 0 warnings");
  });

  test("a root config leaves the members with their own config to them", () => {
    const root = workspace({ "pyproject.toml": ROOT_CONFIG });
    writeFileSync(join(root, "scripts.py"), "");
    const { code, report } = checkJson(root);
    expect(code).toBe(0);
    // 6 files of the configured members once each, plus scripts.py and packages/tools under the root's config.
    expect(report.summary.filesChecked).toBe(8);
    // The nested-project warning is left for the member without a config of its own.
    const nested = report.diagnostics.filter((d) => d.message.includes("nested project"));
    expect(nested.map((d) => d.message.split(" ")[0])).toEqual(["packages/tools"]);
    // packages/tools is checked by the root's config, so it isn't listed as not checked.
    expect(report.notChecked).toBeUndefined();
  });

  test("each config's run-log line holds only its own findings", () => {
    const root = workspace({
      "packages/api/src/acme/plugins/api_plugin.py":
        "from .registry import register\nfrom acme.api.handlers import orders\n",
    });
    expect(inwards(["check", "--log"], { cwd: root }).code).toBe(1);
    expect(runLine(root, "packages/api").codes).toEqual(["INW001"]);
    expect(runLine(root, "packages/core").codes).toEqual([]);
    expect(runLine(root, "packages/core").files).toEqual(["."]);
  });

  test("nested members are each checked once, by their own config", () => {
    const root = project({
      "pyproject.toml": '[tool.uv.workspace]\nmembers = ["a", "a/sub"]\n',
      "a/pyproject.toml": oneLayer("pkg"),
      "a/pkg/m.py": "",
      "a/sub/pyproject.toml": oneLayer("sp"),
      "a/sub/sp/m.py": "",
    });
    const { code, report } = checkJson(root);
    expect(code).toBe(0);
    expect(report.summary.filesChecked).toBe(2);
  });
});

describe("inwards check <paths> routes each path to its nearest config (#57)", () => {
  test("a directory and a file from two members", () => {
    const root = workspace();
    const { code, stdout } = inwards(
      [
        "check",
        "--format",
        "concise",
        "packages/api/src",
        "packages/core/src/acme/core/domain/order.py",
      ],
      { cwd: root },
    );
    expect(code).toBe(0);
    expect(stdout).toContain("All clear: 3 files, 0 violations");
    expect(stdout).toContain("packages/core/pyproject.toml: 1 file, 0 violations, 0 warnings");
  });

  test("a directory holding members goes to each member's config", () => {
    const { code, report } = checkJson(workspace(), ["."]);
    expect(code).toBe(0);
    expect(report.summary.filesChecked).toBe(6);
    expect(report.notChecked?.map((n) => n.path)).toEqual(["packages/tools"]);
  });

  test("a path that gave no file is fine when another path was checked", () => {
    const root = workspace();
    mkdirSync(join(root, "packages/core/docs"));
    writeFileSync(join(root, "packages/core/docs/r.txt"), "hi\n");
    const { code, report } = checkJson(root, ["packages/api/src", "packages/core/docs"]);
    expect(report.summary.filesChecked).toBe(2);
    expect(report.notChecked?.map((n) => n.path)).toEqual(["packages/core/docs"]);
    expect(code).toBe(0);
  });

  test("the workspace is found from the path, not the working directory", () => {
    const root = workspace({ "pyproject.toml": ROOT_CONFIG });
    const args = ["check", "--format", "concise", "acme"];
    const { code, stdout } = inwards(args, { cwd: dirname(root) });
    expect(code).toBe(0);
    // api and core are checked by their own configs, not indexed by path under the root's.
    expect(stdout).toContain("acme/packages/api/pyproject.toml: 2 files, 0 violations");
    expect(stdout).toContain("acme/packages/core/pyproject.toml: 4 files, 0 violations");
    expect(stdout).toContain("acme/pyproject.toml: 1 file, 0 violations");
  });

  test("a path with no config above it is reported, and alone it is a usage error", () => {
    const { code, report } = checkJson(workspace(), ["packages/tools"]);
    expect(code).toBe(2);
    expect(report.notChecked).toEqual([
      {
        path: "packages/tools",
        message:
          "packages/tools has no pyproject.toml with [tool.inwards] above it and was not checked.",
      },
    ]);
  });
});
