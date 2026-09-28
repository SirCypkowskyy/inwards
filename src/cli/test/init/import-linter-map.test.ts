/**
 * @file `inwards import-config` (#55), the pure half: the INI and TOML readers
 * and the mapping of each import-linter contract type onto `[tool.inwards]`,
 * checked on small inline configs. The examples from import-linter's docs are
 * in `import-linter-docs.test.ts`, the command in `import-config.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { parseConfig } from "@inwards/core";
import { convert } from "../../src/init/import-linter/convert.ts";
import type { Outcome } from "../../src/init/import-linter/model.ts";
import { parseIni, readIni, readToml } from "../../src/init/import-linter/read.ts";
import { renderToml } from "../../src/init/import-linter/render.ts";

/**
 * Reads an INI import-linter config that must be there.
 *
 * @param text - an import-linter config in INI syntax.
 * @returns the root packages and contracts it declares.
 * @throws {Error} when the text has no config or doesn't parse.
 */
function ini(text: string): NonNullable<Exclude<ReturnType<typeof readIni>, string>> {
  const config = readIni(text);
  if (config === undefined || typeof config === "string") {
    throw new Error(`no config: ${String(config)}`);
  }
  return config;
}

/**
 * Converts INI text and renders the table.
 *
 * @param text - an import-linter config in INI syntax.
 * @returns the TOML and the verdicts.
 * @throws {Error} when the conversion fails.
 */
function converted(text: string): { toml: string; outcomes: Outcome[] } {
  const result = convert(ini(text));
  if (typeof result === "string") {
    throw new Error(result);
  }
  return { toml: renderToml(result.draft, { source: "x", root: "." }), outcomes: result.outcomes };
}

const ROOT = "[importlinter]\nroot_package = mypackage\n\n";

describe("reading INI", () => {
  test("continuation lines, comments inside values, both delimiters and blank lines", () => {
    const text =
      "[importlinter]\nroot_packages=\n    one\n\n    two\n[importlinter:contract:c]\nname: C\ntype = layers\nlayers =\n  a\n  # a comment\n  b\n";
    const config = ini(text);
    expect(config.rootPackages).toEqual(["one", "two"]);
    expect(config.contracts[0]?.id).toBe("c");
    expect(config.contracts[0]?.name).toBe("C");
    expect(config.contracts[0]?.options.get("layers")).toEqual(["a", "b"]);
  });

  test.each([
    ["[a]\n[a]\n", "section [a] appears twice"],
    ["[a]\nx = 1\nx = 2\n", 'option "x" appears twice'],
    ["x = 1\n", "expected a [section]"],
  ])("rejects %p", (text, message) => {
    expect(parseIni(text)).toContain(message);
  });

  test("a file without [importlinter] has no config", () => {
    expect(readIni("[metadata]\nname = x\n")).toBeUndefined();
  });

  test("TOML booleans and ids read as import-linter reads them", () => {
    const config = readToml(
      Bun.TOML.parse(
        '[tool.importlinter]\nroot_package = "p"\n[[tool.importlinter.contracts]]\nid = "i"\nname = "N"\ntype = "forbidden"\nas_packages = false\n',
      ),
    );
    expect(config?.contracts[0]?.id).toBe("i");
    expect(config?.contracts[0]?.options.get("as_packages")).toBe("False");
  });
});

describe("mapping layers", () => {
  test("import-linter lists layers high to low; Inwards innermost first", () => {
    const { toml } = converted(
      `${ROOT}[importlinter:contract:l]\nname = L\ntype = layers\nlayers =\n  mypackage.high\n  mypackage.medium\n  mypackage.low\n`,
    );
    expect(parseConfig(toml).layers.map((l) => l.name)).toEqual(["low", "medium", "high"]);
  });

  test("| siblings become contexts that may not import each other; : siblings share a layer", () => {
    const { toml } = converted(
      `${ROOT}[importlinter:contract:l]\nname = L\ntype = layers\nlayers =\n  mypackage.high\n  mypackage.a | mypackage.b\n  mypackage.c : mypackage.d\n`,
    );
    const config = parseConfig(toml);
    expect(config.layers.map((l) => l.modules)).toEqual([
      ["mypackage.c", "mypackage.d"],
      ["mypackage.a", "mypackage.b"],
      ["mypackage.high"],
    ]);
    expect(config.contexts?.map((c) => [c.name, c.dependsOn])).toEqual([
      ["mypackage.a", []],
      ["mypackage.b", []],
    ]);
    expect(config.cycles).toEqual([]);
  });

  test("containers repeat each layer; exhaustive_ignores go to ignore; both are reported", () => {
    const { toml, outcomes } = converted(
      `${ROOT}[importlinter:contract:l]\nname = L\ntype = layers\nlayers =\n  high\n  (medium)\n  low\ncontainers =\n  mypackage.foo\n  mypackage.bar\nexhaustive = true\nexhaustive_ignores = utils\n`,
    );
    const config = parseConfig(toml);
    expect(config.layers[0]?.modules).toEqual(["mypackage.foo.low", "mypackage.bar.low"]);
    expect(config.ignore).toEqual(["mypackage.foo.utils", "mypackage.bar.utils"]);
    expect(outcomes[0]?.status).toBe("partial");
    expect(outcomes[0]?.reasons.join(" ")).toContain("(medium)");
    expect(outcomes[0]?.reasons.join(" ")).toContain("exhaustive");
    expect(outcomes[0]?.reasons.join(" ")).toContain("containers");
  });

  test("a second contract joins when it has the same layers or agrees with the order", () => {
    const { toml, outcomes } = converted(
      `${ROOT}[importlinter:contract:a]\nname = A\ntype = layers\nlayers =\n  high\n  low\ncontainers = mypackage.foo\n\n[importlinter:contract:b]\nname = B\ntype = layers\nlayers =\n  high\n  low\ncontainers = mypackage.bar\n\n[importlinter:contract:c]\nname = C\ntype = layers\nlayers =\n  mypackage.foo.high\n  mypackage.bar.low\n`,
    );
    expect(parseConfig(toml).layers.map((l) => l.modules)).toEqual([
      ["mypackage.foo.low", "mypackage.bar.low"],
      ["mypackage.foo.high", "mypackage.bar.high"],
    ]);
    expect(outcomes.map((o) => o.status)).toEqual(["mapped", "mapped", "mapped"]);
  });

  test("a second contract that contradicts the order is skipped with the reason", () => {
    const { outcomes } = converted(
      `${ROOT}[importlinter:contract:a]\nname = A\ntype = layers\nlayers =\n  mypackage.high\n  mypackage.low\n\n[importlinter:contract:b]\nname = B\ntype = layers\nlayers =\n  mypackage.low\n  mypackage.high\n`,
    );
    expect(outcomes[1]?.status).toBe("skipped");
    expect(outcomes[1]?.reasons[0]).toContain("one layer order per config");
  });
});

describe("mapping forbidden and independence", () => {
  test("internal targets become contexts; a pair covers the contexts nested in its ends", () => {
    const { toml } = converted(
      `${ROOT}[importlinter:contract:f]\nname = F\ntype = forbidden\nsource_modules = mypackage.a\nforbidden_modules = mypackage.c\n\n[importlinter:contract:i]\nname = I\ntype = independence\nmodules =\n  mypackage.a.b\n  mypackage.d\n`,
    );
    const contexts = parseConfig(toml).contexts ?? [];
    expect(contexts.map((c) => [c.name, c.dependsOn])).toEqual([
      ["mypackage.a", ["mypackage.a.b", "mypackage.d"]],
      ["mypackage.a.b", ["mypackage.a"]],
      ["mypackage.c", ["mypackage.a", "mypackage.a.b", "mypackage.d"]],
      ["mypackage.d", ["mypackage.a", "mypackage.c"]],
    ]);
  });

  test("an external target denies the library on the layers that are exactly the sources", () => {
    const { toml, outcomes } = converted(
      `${ROOT}[importlinter:contract:l]\nname = L\ntype = layers\nlayers =\n  mypackage.web\n  mypackage.domain\n\n[importlinter:contract:f]\nname = F\ntype = forbidden\nsource_modules = mypackage.domain\nforbidden_modules = pydantic\n`,
    );
    expect(parseConfig(toml).layers[0]?.extendDenyLibraries).toEqual(["pydantic"]);
    expect(outcomes[1]?.status).toBe("mapped");
  });

  test("an external target is reported when the sources are not whole layers", () => {
    const { outcomes } = converted(
      `${ROOT}[importlinter:contract:f]\nname = F\ntype = forbidden\nsource_modules = mypackage.one\nforbidden_modules = django\n`,
    );
    expect(outcomes[0]?.status).toBe("skipped");
    expect(outcomes[0]?.reasons[0]).toContain('"mypackage.one" is not a module of a layer');
  });

  test.each([
    ["forbidden_modules = mypackage.*", "wildcard"],
    ["forbidden_modules = mypackage.b\nas_packages = False", "as_packages"],
    ["forbidden_modules = mypackage", "forbids nothing"],
  ])("%p is skipped with the reason", (line, reason) => {
    const { outcomes } = converted(
      `${ROOT}[importlinter:contract:f]\nname = F\ntype = forbidden\nsource_modules = mypackage.a\n${line}\n`,
    );
    expect(outcomes[0]?.status).toBe("skipped");
    expect(outcomes[0]?.reasons[0]).toContain(reason);
  });

  test("ignore_imports is reported, never dropped silently", () => {
    const { outcomes } = converted(
      `${ROOT}[importlinter:contract:i]\nname = I\ntype = independence\nmodules =\n  mypackage.a\n  mypackage.b\nignore_imports = mypackage.a.x -> mypackage.b.y\n`,
    );
    expect(outcomes[0]?.status).toBe("partial");
    expect(outcomes[0]?.reasons[0]).toContain("mypackage.a.x -> mypackage.b.y");
  });

  test.each([["protected"], ["acyclic_siblings"], ["mypackage.contracts.Custom"]])(
    "a %s contract is skipped with the reason",
    (type) => {
      const { outcomes } = converted(
        `${ROOT}[importlinter:contract:x]\nname = X\ntype = ${type}\n`,
      );
      expect(outcomes[0]?.status).toBe("skipped");
      expect(outcomes[0]?.reasons).toHaveLength(1);
    },
  );

  test("without a root package or a layers contract there is nothing to build on", () => {
    expect(
      convert(ini("[importlinter]\n[importlinter:contract:x]\nname = X\ntype = protected\n")),
    ).toContain("no root_package");
  });
});
