/**
 * @file INW005's prefix denies, `[tool.inwards.rules.pure-domain].deny`
 * (#219): a library denied to a module prefix that isn't a whole layer,
 * inside a layer or outside every layer. The layer's own lists keep their
 * message, so existing baseline keys stay the same.
 */
import { describe, expect, test } from "bun:test";
import { baselineKey, ConfigError, type Diagnostic, Engine, parseConfig } from "../../src/index.ts";
import { file, grammars, PROJECT } from "../support/helpers.ts";

/**
 * Checks one file with an engine built from a config snippet.
 *
 * @param config - the `[tool.inwards]` text.
 * @param path - the file's project-relative path.
 * @param src - its Python source.
 * @returns its INW005 findings.
 */
async function inw005(config: string, path: string, src: string): Promise<Diagnostic[]> {
  const engine = await Engine.create(grammars(), parseConfig(config));
  return engine.checkFile(file(path, src), PROJECT).filter((d) => d.code === "INW005");
}

/** One layer holds the whole package, as `inwards import-config` writes it. */
const ONE_LAYER = `[tool.inwards]
layers = [{ name = "mypackage", modules = ["mypackage"] }]

[tool.inwards.rules.pure-domain]
deny = [{ modules = ["mypackage.one"], libraries = ["django"] }]
`;

describe("INW005 prefix denies (#219)", () => {
  test("django is denied to mypackage.one only; mypackage.two may import it", async () => {
    const [d, ...rest] = await inw005(ONE_LAYER, "mypackage/one/views.py", "import django.db\n");
    expect(rest).toEqual([]);
    expect(d?.message).toBe(
      'Module "mypackage.one.views" imports "django.db" from library "django", which [tool.inwards.rules.pure-domain] denies to "mypackage.one".',
    );
    expect(d?.fix.summary).toContain('"mypackage.one" may not use "django"');
    expect(d?.fix.steps.at(-1)).toContain(
      'take "django" out of the deny entry for "mypackage.one" in [tool.inwards.rules.pure-domain]',
    );
    expect(await inw005(ONE_LAYER, "mypackage/two/views.py", "import django.db\n")).toEqual([]);
    expect(await inw005(ONE_LAYER, "mypackage/one.py", "import requests\n")).toEqual([]);
  });

  test("a module outside every layer is checked too, dynamic imports included", async () => {
    const config = `[tool.inwards]
layers = [{ name = "domain", modules = ["shop.domain"] }, { name = "api", modules = ["shop.api"] }]

[tool.inwards.rules.pure-domain]
deny = [{ modules = ["shop.*.jobs"], libraries = ["celery", "http.client"] }]
`;
    const src =
      'import celery\nimport http\nimport importlib\nimportlib.import_module("http.client")\n';
    const found = await inw005(config, "shop/billing/jobs/run.py", src);
    expect(found.map((d) => [d.line, d.message.split(" denies to ")[1]])).toEqual([
      [1, '"shop.billing.jobs".'],
      [4, '"shop.billing.jobs".'],
    ]);
    expect(await inw005(config, "shop/billing/tasks.py", src)).toEqual([]);
  });

  test("the layer's allow-libraries doesn't undo a prefix deny", async () => {
    const config = `[tool.inwards]
layers = [{ name = "web", modules = ["shop.web"], allow-libraries = ["django"] }, { name = "main", modules = ["shop.main"] }]

[tool.inwards.rules.pure-domain]
deny = [{ modules = ["shop.web.models"], libraries = ["django.http"] }]
`;
    expect(await inw005(config, "shop/web/models/order.py", "import django.db\n")).toEqual([]);
    const [d] = await inw005(config, "shop/web/models/order.py", "import django.http\n");
    expect(d?.fix.summary).toContain('may not use "django.http"');
  });

  test("a library the layer denies as well keeps the layer's message and baseline key", async () => {
    const layered = `[tool.inwards]
layers = [{ name = "domain", modules = ["shop.domain"] }, { name = "api", modules = ["shop.api"] }]
`;
    const both = `${layered}
[tool.inwards.rules.pure-domain]
deny = [{ modules = ["shop.domain"], libraries = ["sqlalchemy"] }]
`;
    const src = "import sqlalchemy\n";
    const [before] = await inw005(layered, "shop/domain/order.py", src);
    const [after, ...rest] = await inw005(both, "shop/domain/order.py", src);
    expect(rest).toEqual([]);
    expect(after?.message).toStartWith('Layer "domain" imports');
    expect(after && baselineKey(after)).toBe(before && baselineKey(before));
  });

  test("first-party code is left alone, and a workspace member reads as one", async () => {
    const config = ONE_LAYER.replace('["django"]', '["shop", "qv_other"]');
    expect(await inw005(config, "mypackage/one/x.py", "import shop.domain\n")).toEqual([]);
    const engine = await Engine.create(grammars(), parseConfig(config), {
      workspacePackages: new Set(["qv_other"]),
    });
    const [d] = engine.checkFile(file("mypackage/one/x.py", "import qv_other\n"), PROJECT);
    expect(d?.message).toContain('from workspace package "qv_other"');
    const asLibrary = d && { ...d, message: d.message.replace("workspace package", "library") };
    expect(d && baselineKey(d)).toBe(asLibrary && baselineKey(asLibrary));
  });

  test("the table's modules still scope the whole rule", async () => {
    const config = ONE_LAYER.replace("deny =", 'modules = ["mypackage.two"]\ndeny =');
    expect(await inw005(config, "mypackage/one/views.py", "import django\n")).toEqual([]);
  });

  test.each([
    ["deny = {}", "deny must be a list of tables"],
    ['deny = ["django"]', "deny[0] must be a table"],
    ['deny = [{ libraries = ["django"] }]', "deny[0].modules must be a non-empty list"],
    [
      'deny = [{ modules = [], libraries = ["django"] }]',
      "deny[0].modules must be a non-empty list",
    ],
    ['deny = [{ modules = ["a"] }]', "deny[0].libraries must be a non-empty list"],
    ['deny = [{ modules = ["a"], libraries = [] }]', "deny[0].libraries must be"],
    ['deny = [{ modules = ["a"], libraries = ["python-dateutil"] }]', "no distribution names"],
    [
      'deny = [{ modules = ["*.a"], libraries = ["django"] }]',
      "is not a module prefix or selector",
    ],
    [
      'deny = [{ modules = ["a"], libraries = ["django"], reason = "x" }]',
      "Unknown key tool.inwards.rules.pure-domain.deny[0].reason",
    ],
  ])("%s is a config error", (line, message) => {
    const text = `[tool.inwards]\nlayers = [{ name = "a", modules = ["a"] }]\n[tool.inwards.rules.pure-domain]\n${line}\n`;
    expect(() => parseConfig(text)).toThrow(ConfigError);
    expect(() => parseConfig(text)).toThrow(message);
  });

  test("deny belongs to pure-domain only", () => {
    const text = `[tool.inwards]\nlayers = [{ name = "a", modules = ["a"] }]\n[tool.inwards.rules.layer-dependency]\ndeny = []\n`;
    expect(() => parseConfig(text)).toThrow("Unknown key tool.inwards.rules.layer-dependency.deny");
  });
});
