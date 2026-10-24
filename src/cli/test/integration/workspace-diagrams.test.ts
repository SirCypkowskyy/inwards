/**
 * @file A uv workspace member whose `diagrams` reach the repository's docs
 * with `..` (#413), through the CLI: a whole-project check in the member and
 * at the workspace root, the diagram named as a target from the root, the
 * PostToolUse hook on an edit of it, and the config errors for an entry that
 * climbs past the project root or has no root to climb to. Each case builds
 * its own throwaway workspace.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { inwards, payload, project, type RunResult } from "../support/run.ts";
import { git } from "../support/stop-helpers.ts";

/** The workspace root's pyproject.toml, with no `[tool.inwards]` of its own. */
const WORKSPACE = '[project]\nname = "mono"\n\n[tool.uv.workspace]\nmembers = ["packages/*"]\n';

/**
 * Builds the member's config with a `diagrams` value and the diagram rules on.
 *
 * @param diagrams - the TOML value of `diagrams`.
 * @param severity - the `[tool.inwards.rules]` line after `extend-select`, if any.
 * @returns the member's pyproject.toml text.
 */
function member(diagrams: string, severity = ""): string {
  return `[project]
name = "app"

[tool.inwards]
root = "src"
diagrams = ${diagrams}
layers = [
  { name = "domain", modules = ["app.domain"] },
  { name = "infrastructure", modules = ["app.infrastructure"] },
]

[tool.inwards.rules]
extend-select = ["INW017", "INW018", "INW019"]
${severity}`;
}

/** A layers diagram with a typo in a label (INW017) and an outward arrow (INW018). */
const DRAWN = [
  "# Architecture",
  "",
  "```mermaid",
  "%% inwards: layers",
  "flowchart LR",
  '  domain["app.domian"] --> infrastructure["app.infrastructure"]',
  "```",
  "",
].join("\n");

/**
 * Builds a repository with one member whose config lists a repository-level diagram.
 *
 * @param opts - what the repository holds.
 * @param opts.config - the member's pyproject.toml text.
 * @param opts.workspace - whether the root pyproject.toml declares the uv workspace.
 * @returns the repository root.
 */
function repo({ config, workspace = true }: { config: string; workspace?: boolean }): string {
  return project({
    ...(workspace ? { "pyproject.toml": WORKSPACE } : {}),
    "packages/app/pyproject.toml": config,
    "packages/app/src/app/__init__.py": "",
    "packages/app/src/app/domain/__init__.py": "",
    "packages/app/src/app/domain/order.py": "X = 1\n",
    "packages/app/src/app/infrastructure/__init__.py": "",
    "packages/app/src/app/infrastructure/db.py": "import app.domain.order\n",
    "docs/architecture.md": DRAWN,
  });
}

/**
 * Runs `inwards check --format json` and lists what it found.
 *
 * @param cwd - the directory to run in.
 * @param targets - paths to check, relative to `cwd`; none for a whole-project run.
 * @returns the exit code and each finding's code and file.
 */
function check(cwd: string, targets: string[] = []): { code: number; found: string[][] } {
  const { code, stdout } = inwards(["check", "--format", "json", ...targets], { cwd });
  const report: { diagnostics: { code: string; file: string }[] } = JSON.parse(stdout);
  return { code, found: report.diagnostics.map((d) => [d.code, d.file]) };
}

const DOC = "../../docs/architecture.md";

describe("a member's diagrams reach the repository's docs with .. (#413)", () => {
  test("a whole-project check in the member reads the repository-level diagram", () => {
    const root = repo({ config: member(`["${DOC}"]`) });
    expect(check(join(root, "packages/app"))).toEqual({
      code: 0,
      found: [
        ["INW017", DOC],
        ["INW018", DOC],
        ["INW019", DOC],
      ],
    });
  });

  test("a check at the workspace root reads it through the member's config", () => {
    const root = repo({ config: member('["../../docs/*.md"]') });
    const { found } = check(root);
    expect(found.map(([code]) => code)).toEqual(["INW017", "INW018", "INW019"]);
    expect(found.every(([, file]) => file === "docs/architecture.md")).toBe(true);
  });

  test("the diagram named at the workspace root goes to the member that lists it", () => {
    const root = repo({ config: member(`["${DOC}"]`) });
    expect(check(root, ["docs/architecture.md"])).toEqual({
      code: 0,
      found: [
        ["INW017", "docs/architecture.md"],
        ["INW018", "docs/architecture.md"],
      ],
    });
  });

  test("a git repository is a root too, without a uv workspace", () => {
    const root = repo({ config: member(`["${DOC}"]`), workspace: false });
    git(root, "init", "-q");
    expect(check(join(root, "packages/app")).found.map(([code]) => code)).toEqual([
      "INW017",
      "INW018",
      "INW019",
    ]);
  });

  test("an entry that climbs past the workspace root is a config error naming the root", () => {
    const root = repo({ config: member('["../../../docs/architecture.md"]') });
    const { code, stderr } = inwards(["check"], { cwd: join(root, "packages/app") });
    expect(code).toBe(2);
    expect(stderr).toContain(
      'tool.inwards.diagrams[0] ("../../../docs/architecture.md") must stay inside the project root, the uv workspace root ("../..")',
    );
  });

  test("with no git repository or uv workspace around the config, no entry may climb", () => {
    const root = repo({ config: member(`["${DOC}"]`), workspace: false });
    const { code, stderr } = inwards(["check"], { cwd: join(root, "packages/app") });
    expect(code).toBe(2);
    expect(stderr).toContain("outside a git repository or uv workspace");
  });
});

describe("the PostToolUse hook on an edit of the repository-level diagram (#413)", () => {
  /**
   * Sends the recorded PostToolUse Write of the diagram from the repository root.
   *
   * @param root - the repository.
   * @returns the hook's exit code and output.
   */
  function wrote(root: string): RunResult {
    const stdin = payload("post-write-readme", root, {
      tool_input: { file_path: join(root, "docs/architecture.md") },
    });
    return inwards(["hook", "claude-code"], { cwd: root, stdin });
  }

  test("a warning goes back as context, with the member's findings", () => {
    const { code, stdout } = wrote(repo({ config: member(`["${DOC}"]`) }));
    expect(code).toBe(0);
    expect(stdout).toContain("INW017");
    expect(stdout).toContain("INW018");
  });

  test("an error blocks", () => {
    const config = member(`["${DOC}"]`, 'severity = { INW017 = "error" }\n');
    const { code, stderr } = wrote(repo({ config }));
    expect(code).toBe(2);
    expect(stderr).toContain("INW017");
  });
});
