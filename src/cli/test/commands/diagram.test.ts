/**
 * @file `inwards diagram` (#349) as a command, by round trip: every preset's
 * scaffold and both example apps get their config printed as a Mermaid and
 * a PlantUML diagram, the diagrams go into the docs the config lists under
 * `diagrams`, `inwards check` with INW017 and INW018 on finds nothing in
 * them, and `inwards import-diagram` reads them back to the same layers,
 * ranks and contexts. Also: the flags it refuses.
 */
import { describe, expect, test } from "bun:test";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type InwardsConfig, parseConfig } from "@inwards/core";
import { init, STYLES, UV_PROJECT } from "../support/init-style-helpers.ts";
import { inwards, LAYERS, project } from "../support/run.ts";

const REPO = resolve(import.meta.dir, "../../../..");
const NOTATIONS = ["mermaid", "plantuml"] as const;
type Notation = (typeof NOTATIONS)[number];
/** Anything that can't be part of a node id, as the writer replaces it. */
const NOT_ID = /[^\p{L}\p{N}_-]+/gu;
/** A name that can be a node id, as the writer keeps it. */
const NODE_ID = /^[\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*$/u;
/** The reference config's `root` line, which the copied example doesn't need. */
const ROOT_LINE = /^root = .*\n/mu;

/**
 * Writes the config's diagrams into docs/architecture.md, lists the file
 * under `diagrams` and turns INW017 and INW018 on.
 *
 * @param root - the project.
 * @param notation - which notation to print.
 * @returns the exit codes of the runs, and their stderr notes.
 */
function drawDocs(root: string, notation: Notation): { codes: number[]; notes: string } {
  const path = join(root, "pyproject.toml");
  const config = parseConfig(readFileSync(path, "utf8"));
  const kinds = config.contexts === undefined ? ["--layers"] : ["--layers", "--contexts"];
  const runs = kinds.map((kind) => inwards(["diagram", kind, "--format", notation], { cwd: root }));
  const blocks = runs.map((run) => `\`\`\`${notation}\n${run.stdout}\`\`\`\n`);
  writeFileSync(join(root, "architecture.md"), `# Architecture\n\n${blocks.join("\n")}`);
  writeFileSync(path, withDiagramRules(readFileSync(path, "utf8")));
  return { codes: runs.map((run) => run.code), notes: runs.map((run) => run.stderr).join("") };
}

/**
 * Adds `diagrams` and INW017 and INW018 to a config, where its rules table
 * already is or in a new one.
 *
 * @param text - the pyproject.toml.
 * @returns the text with the diagram rules on.
 */
function withDiagramRules(text: string): string {
  const listed = text.replace(
    "[tool.inwards]\n",
    '[tool.inwards]\ndiagrams = ["architecture.md"]\n',
  );
  if (listed.includes("extend-select = [")) {
    return listed.replace("extend-select = [", 'extend-select = ["INW017", "INW018", ');
  }
  if (listed.includes("[tool.inwards.rules]\n")) {
    return listed.replace(
      "[tool.inwards.rules]\n",
      '[tool.inwards.rules]\nextend-select = ["INW017", "INW018"]\n',
    );
  }
  return `${listed}\n[tool.inwards.rules]\nextend-select = ["INW017", "INW018"]\n`;
}

/**
 * Lists the diagram rules' findings of a whole-project check.
 *
 * @param root - the project.
 * @returns `CODE line: message` for each INW017 and INW018.
 */
function diagramFindings(root: string): string[] {
  const run = inwards(["check", "--format", "json"], { cwd: root });
  const { diagnostics } = JSON.parse(run.stdout);
  return diagnostics
    .filter((d: { code: string }) => d.code === "INW017" || d.code === "INW018")
    .map(
      (d: { code: string; line: number; message: string }) => `${d.code} ${d.line}: ${d.message}`,
    );
}

/**
 * Keeps what a diagram draws of a config: each layer's name (made into an id
 * when it can't be one), modules and rank, and each context.
 *
 * @param config - a parsed config.
 * @returns the layers and contexts as plain data.
 */
function drawn(config: InwardsConfig): unknown {
  return {
    layers: config.layers.map((layer, i) => [id(layer.name), layer.modules, layer.rank ?? i]),
    contexts: (config.contexts ?? []).map((c) => ({ ...c, dependsOn: [...c.dependsOn].sort() })),
  };
}

/**
 * Spells a layer name as the diagram's node id: itself, or made into one.
 *
 * @param name - the layer's name.
 * @returns such as `domain`, or `slice_domain` for `slice.domain`.
 */
function id(name: string): string {
  return NODE_ID.test(name) ? name : name.replace(NOT_ID, "_");
}

/**
 * Reads the docs back with `inwards import-diagram`.
 *
 * @param root - the project.
 * @returns the table it prints, parsed; it throws when there is none.
 */
function imported(root: string): InwardsConfig {
  return parseConfig(inwards(["import-diagram", "architecture.md"], { cwd: root }).stdout);
}

/** Drawn with no notes: what every preset and example gives. */
const CLEAN = { codes: [0], notes: "" };

describe("inwards diagram: round trip", () => {
  for (const style of STYLES) {
    for (const notation of NOTATIONS) {
      test(`${style} scaffold, ${notation}`, () => {
        const root = project(UV_PROJECT);
        expect(init(root, "--style", style, "--scaffold").code).toBe(0);
        const before = parseConfig(readFileSync(join(root, "pyproject.toml"), "utf8"));
        const contexts = before.contexts === undefined ? [] : [0];
        expect(drawDocs(root, notation)).toEqual({ ...CLEAN, codes: [0, ...contexts] });
        expect(diagramFindings(root)).toEqual([]);
        expect(drawn(imported(root))).toEqual(drawn(before));
      });
    }
  }

  /**
   * Copies examples/clean-app with the reference config from the repository's
   * pyproject.toml. The config names shop.cli, which the example app doesn't
   * have (INW006 says so); the copy adds it, so every label names a module.
   *
   * @returns the project, and the reference config.
   */
  function cleanApp(): { root: string; before: InwardsConfig } {
    const root = project({ "shop/cli/__init__.py": "" });
    cpSync(join(REPO, "examples/clean-app/shop"), join(root, "shop"), { recursive: true });
    const reference = readFileSync(join(REPO, "pyproject.toml"), "utf8");
    const table = reference.slice(reference.indexOf("\n[tool.inwards]\n") + 1);
    writeFileSync(join(root, "pyproject.toml"), table.replace(ROOT_LINE, ""));
    return { root, before: parseConfig(table) };
  }

  test("examples/clean-app with the reference config, mermaid", () => {
    const { root, before } = cleanApp();
    expect(drawDocs(root, "mermaid")).toEqual(CLEAN);
    expect(diagramFindings(root)).toEqual([]);
    expect(drawn(imported(root))).toEqual(drawn(before));
  });

  test("examples/clean-app, plantuml: a layer's second module is left out, with a note", () => {
    const { root, before } = cleanApp();
    expect(drawDocs(root, "plantuml")).toEqual({
      codes: [0],
      notes:
        'inwards diagram: Layer "interface" has 2 modules; a PlantUML component names one, so the diagram shows "shop.api" only.\n',
    });
    expect(diagramFindings(root)).toEqual([]);
    const firstOnly = before.layers.map((l) => ({ ...l, modules: l.modules.slice(0, 1) }));
    expect(drawn(imported(root))).toEqual(drawn({ ...before, layers: firstOnly }));
  });

  test.each([...NOTATIONS])(
    "examples/broken-app, %s: the diagram is clean, the code isn't",
    (notation) => {
      const root = project({});
      cpSync(join(REPO, "examples/broken-app"), root, { recursive: true });
      const before = parseConfig(readFileSync(join(root, "pyproject.toml"), "utf8"));
      expect(drawDocs(root, notation)).toEqual(CLEAN);
      expect(diagramFindings(root)).toEqual([]);
      expect(inwards(["check"], { cwd: root }).code).toBe(1);
      expect(drawn(imported(root))).toEqual(drawn(before));
    },
  );
});

describe("inwards diagram: output and refusals", () => {
  test("prints the layers as Mermaid by default", () => {
    const run = inwards(["diagram"], { cwd: project({ "pyproject.toml": LAYERS }) });
    expect(run).toEqual({
      code: 0,
      stdout: [
        "%% inwards: layers",
        "flowchart TB",
        '  infrastructure["shop.infrastructure"]',
        '  domain["shop.domain"]',
        "  infrastructure --> domain",
        "",
      ].join("\n"),
      stderr: "",
    });
  });

  test("reads --config", () => {
    const root = project({ "conf/pyproject.toml": LAYERS });
    const run = inwards(["diagram", "--config", "conf/pyproject.toml", "--format", "plantuml"], {
      cwd: root,
    });
    expect([run.code, run.stdout.split("\n")[0]]).toEqual([0, "@startuml"]);
  });

  test.each([
    [["diagram", "--layers", "--contexts"], "Usage: inwards diagram"],
    [["diagram", "extra"], "Usage: inwards diagram"],
    [
      ["diagram", "--format", "svg"],
      "inwards diagram: unknown --format svg; use mermaid or plantuml.",
    ],
    [
      ["diagram", "--contexts"],
      "inwards diagram: [tool.inwards] declares no contexts, so there is no contexts diagram; leave out --contexts for the layers.",
    ],
  ])("%p is refused with exit 2", (args, message) => {
    const run = inwards(args, { cwd: project({ "pyproject.toml": LAYERS }) });
    expect([run.code, run.stdout]).toEqual([2, ""]);
    expect(run.stderr.startsWith(message)).toBe(true);
  });
});
