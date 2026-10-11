/**
 * @file The architecture brief (#58): what `architectureBrief` says for layers,
 * ports, libraries and contexts, the token bound for the example config and
 * every preset, and the CLI around it. `inwards context` prints it, `--write`
 * and `init --brief` keep one marked section in AGENTS.md up to date in place,
 * and a second run changes nothing.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseConfig } from "@inwards/core";
import { nodePlatform } from "../../src/adapters/compose.ts";
import { architectureBrief, briefFor } from "../../src/init/brief.ts";
import { STYLES } from "../../src/init/presets.ts";
import { configTable } from "../../src/init/style-text.ts";
import { STYLE_NAMES } from "../../src/init/styles.ts";
import { inwards, LAYERS, project, type RunResult } from "../support/run.ts";

const REPO = resolve(import.meta.dir, "../../../..");
const BEGIN = "<!-- inwards-brief:begin -->";
const END = "<!-- inwards-brief:end -->";

/**
 * Estimates a text's tokens the usual rough way: four characters per token.
 *
 * @param text - what to measure, e.g. the brief.
 * @returns the estimate, rounded up.
 */
function tokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Runs the CLI in a project.
 *
 * @param root - the project directory.
 * @param args - the arguments.
 * @returns the exit code and output.
 */
function run(root: string, ...args: string[]): RunResult {
  return inwards(args, { cwd: root });
}

/**
 * Reads a project's AGENTS.md.
 *
 * @param root - the project directory.
 * @returns its text.
 */
function agentsMd(root: string): string {
  return readFileSync(join(root, "AGENTS.md"), "utf8");
}

/** Where each preset's brief says ports go, before anything is on disk. */
const PRESET_PORTS: Readonly<Record<(typeof STYLE_NAMES)[number], string>> = {
  layered: "`app.persistence`",
  clean: "`app.application.ports`",
  hexagonal: "`app.application.ports`",
  "vertical-slices": "`app.features.orders`",
  // Their layers are selectors, which name no one module.
  "bounded-contexts": "the inner layer",
  django: "the inner layer",
  fastapi: "the inner layer",
};

/** A probe that finds nothing on disk. */
const NOTHING = {
  probe: { exists: (): boolean => false, kind: (): undefined => undefined },
};

describe("architectureBrief", () => {
  test("lists the layers innermost first with what each may import, and a generic port hint", () => {
    const brief = architectureBrief({ config: parseConfig(LAYERS), style: undefined, ports: [] });
    expect(brief).toContain("1. domain (`shop.domain`): imports no other layer");
    expect(brief).toContain(
      "2. infrastructure (`shop.infrastructure`): may import every other layer",
    );
    expect(brief).toContain("declare a `typing.Protocol` in the inner layer");
    expect(brief).not.toContain("preset");
    expect(brief).not.toContain("Contexts");
  });

  test("names the ports modules, the library rules and the contexts", () => {
    const config = parseConfig(`[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"], extend-deny-libraries = ["numpy"] },
  { name = "application", modules = ["shop.application"], allow-libraries = ["pydantic"] },
  { name = "api", modules = ["shop.api"], deny-libraries = ["sqlalchemy"] },
]
[[tool.inwards.contexts]]
name = "billing"
modules = ["shop.billing"]
public = ["shop.billing.api"]
depends-on = ["orders"]
[[tool.inwards.contexts]]
name = "orders"
modules = ["shop.orders"]
`);
    const brief = architectureBrief({ config, style: undefined, ports: ["shop.domain.ports"] });
    expect(brief).toContain("declare a `typing.Protocol` in `shop.domain.ports`");
    expect(brief).toContain(
      "- domain: no web frameworks, database or network clients, `subprocess` or `socket`, nor `numpy`",
    );
    expect(brief).toContain("- application: third-party only `pydantic`");
    expect(brief).toContain("- api: not `sqlalchemy`");
    expect(brief).toContain(
      "- billing (`shop.billing`): public `shop.billing.api`; depends on orders",
    );
    expect(brief).toContain("- orders (`shop.orders`): nothing public; no dependencies");
  });

  test("lists layer selectors as written and probes no path for them", () => {
    const text = `[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.*.domain"] },
  { name = "infrastructure", modules = ["shop.**"] },
]
`;
    const root = project({ "pyproject.toml": text, "shop/orders/domain/ports.py": "" });
    const brief = briefFor(nodePlatform(), join(root, "pyproject.toml"), text);
    expect(brief).toContain("1. domain (`shop.*.domain`): imports no other layer");
    expect(brief).toContain("declare a `typing.Protocol` in the inner layer");
  });

  test("says what sibling layers may import, and gives the innermost siblings the default", () => {
    const config = parseConfig(`[tool.inwards]
layers = [
  { name = "d", modules = ["app.*"], template = "slice" },
  { name = "main", modules = ["app.main"] },
]

[tool.inwards.templates.slice]
roles = ["models | schemas", "service"]
`);
    const brief = architectureBrief({ config, style: undefined, ports: [] });
    expect(brief).toContain(
      "never import a layer listed after your own, nor a sibling of your own layer.",
    );
    expect(brief).toContain(
      "1. d.models (`app.*.models`): imports no other layer; not its sibling d.schemas",
    );
    expect(brief).toContain("3. d.service (`app.*.service`): may import d.models, d.schemas");
    expect(brief).toContain("4. main (`app.main`): may import every other layer");
    expect(brief).toContain("- d.schemas: no web frameworks");
  });

  test("lists INW005's prefix denies after the layers (#219)", () => {
    const config = parseConfig(`${LAYERS}[tool.inwards.rules.pure-domain]
deny = [{ modules = ["shop.domain.pricing", "shop.*.jobs"], libraries = ["numpy", "celery"] }]
`);
    expect(architectureBrief({ config, style: undefined, ports: [] })).toContain(
      "- `shop.domain.pricing`, `shop.*.jobs`: not `numpy`, `celery`",
    );
  });

  test("leaves out the rules that are turned off", () => {
    const config = parseConfig(`${LAYERS}[tool.inwards.rules]
ignore = ["INW005"]
`);
    expect(architectureBrief({ config, style: undefined, ports: [] })).not.toContain("Libraries");
  });

  test.each([...STYLE_NAMES])(
    "a %s preset config names the preset and where its ports live",
    (name) => {
      const style = STYLES[name];
      const text = configTable(style, {
        pkg: "app",
        root: "src",
        version: "0.1.0",
        ignore: [],
        scaffold: false,
        eol: "\n",
      });
      const brief = briefFor(NOTHING, "/p/pyproject.toml", text);
      expect(brief).toContain(`(the ${name} preset)`);
      expect(brief).toContain(`declare a \`typing.Protocol\` in ${PRESET_PORTS[name]}`);
      // fastapi has eleven layers, nine of them the template's roles, and ten opt-in rules on.
      expect(tokens(brief)).toBeLessThan(name === "fastapi" ? 550 : 300);
    },
  );
});

test("a preset whose ports layer became a selector names no ports module", () => {
  const style = STYLES["clean"];
  const table = configTable(style, {
    pkg: "app",
    root: "src",
    version: "0.1.0",
    ignore: [],
    scaffold: false,
    eol: "\n",
  });
  const text = table.replace('"app.application"', '"app.*.application"');
  expect(text).toContain('"app.*.application"');
  const brief = briefFor(NOTHING, "/p/pyproject.toml", text);
  expect(brief).not.toContain(".ports`");
  expect(brief).toContain("declare a `typing.Protocol` in the inner layer");
});

describe("inwards context", () => {
  test("prints the brief for the example config, under 300 tokens", () => {
    const out = run(REPO, "context");
    expect(out.code).toBe(0);
    expect(out.stdout).toMatchSnapshot();
    // examples/clean-app keeps its Protocol in shop/domain/ports.py.
    expect(out.stdout).toContain("`shop.domain.ports`");
    expect(tokens(out.stdout)).toBeLessThan(300);
  });

  test("--write adds the section, updates it in place, and then has nothing to do", () => {
    const root = project({ "pyproject.toml": LAYERS, "AGENTS.md": "# Team rules\n" });
    expect(run(root, "context", "--write").stdout).toContain("updated");
    const first = agentsMd(root);
    expect(first.startsWith("# Team rules\n\n<!-- inwards-brief:begin -->\n")).toBe(true);
    expect(run(root, "context", "--write").stdout).toContain("AGENTS.md is up to date");
    writeFileSync(join(root, "AGENTS.md"), `${first}\n## Our own notes\n`);
    writeFileSync(join(root, "pyproject.toml"), LAYERS.replace('"infrastructure"', '"adapters"'));
    expect(run(root, "context", "--write").code).toBe(0);
    const after = agentsMd(root);
    expect(after).toContain("2. adapters (`shop.infrastructure`)");
    expect(after).not.toContain("2. infrastructure");
    expect(after.endsWith("\n## Our own notes\n")).toBe(true);
    expect(after.split(BEGIN)).toHaveLength(2);
  });

  test("--write refuses an AGENTS.md with unmatched markers", () => {
    const root = project({ "pyproject.toml": LAYERS, "AGENTS.md": `${BEGIN}\nhalf\n` });
    const out = run(root, "context", "--write");
    expect(out.code).toBe(2);
    expect(out.stderr).toContain("unmatched");
    expect(agentsMd(root)).toBe(`${BEGIN}\nhalf\n`);
  });

  test("without a config it exits 2", () => {
    expect(run(project({ "a.py": "" }), "context").code).toBe(2);
  });
});

describe("inwards init --brief", () => {
  test("with --agent agents-md: both sections, and a second run changes nothing", () => {
    const root = project({ "pyproject.toml": LAYERS });
    expect(run(root, "init", "--agent", "agents-md", "--brief").code).toBe(0);
    const text = agentsMd(root);
    expect(text.indexOf("<!-- inwards:end -->")).toBeLessThan(text.indexOf(BEGIN));
    expect(text).toContain(END);
    expect(run(root, "init", "--agent", "agents-md", "--brief").stdout).toContain(
      "nothing to change",
    );
  });

  test("alone, it writes only the brief", () => {
    const root = project({ "pyproject.toml": LAYERS });
    expect(run(root, "init", "--brief").code).toBe(0);
    const text = agentsMd(root);
    expect(text.startsWith(BEGIN)).toBe(true);
    expect(text).not.toContain("<!-- inwards:begin -->");
  });

  test("without --brief, init writes no brief", () => {
    const root = project({ "pyproject.toml": LAYERS });
    run(root, "init", "--agent", "agents-md");
    expect(agentsMd(root)).not.toContain(BEGIN);
  });

  test("with --style, the brief names the preset and its ports before they exist", () => {
    const root = project({ "pyproject.toml": '[project]\nname = "app"\n' });
    expect(run(root, "init", "--style", "clean", "--brief").code).toBe(0);
    const text = agentsMd(root);
    expect(text).toContain("(the clean preset)");
    expect(text).toContain("`app.application.ports`");
  });
});
