/**
 * @file INW007 package-shape and INW008 missing-member: members a package may, must
 * and must not hold, where a name may appear, and the shape config. File names
 * and targets are checked the way adapters list them.
 */
import { describe, expect, test } from "bun:test";
import {
  ConfigError,
  checkRequired,
  checkSelectors,
  checkShape,
  type Diagnostic,
  Engine,
  membersFrom,
  packagesOf,
  parseConfig,
  probeMembers,
  rootPathOf,
} from "../../src/index.ts";
import { file, grammars } from "../support/helpers.ts";

const FASTAPI = `[tool.inwards]
root = "."
layers = [{ name = "app", modules = ["app"] }]

[[tool.inwards.shape]]
packages = ["app.*"]
allow = ["router", "schemas", "models", "dependencies", "config", "constants", "exceptions", "utils"]
require = ["__init__", "router", "service"]
forbid = ["conftest"]

[[tool.inwards.names]]
pattern = "test_*"
only-in = ["tests", "tests.**"]
`;
const config = parseConfig(FASTAPI);

/**
 * Runs checkShape on a path and keeps what matters to these tests.
 *
 * @param path - a root-relative path.
 * @returns code, severity, message and fix summary of each finding.
 */
function shape(path: string): Pick<Diagnostic, "code" | "severity" | "message" | "fix">[] {
  return checkShape(file(path, ""), config).map(({ code, severity, message, fix }) => ({
    code,
    severity,
    message,
    fix,
  }));
}

describe("INW007 package-shape", () => {
  test.each([
    ["app/orders/helpers.py", "utils.py"],
    ["app/orders/services/x.py", "service.py"],
    ["app/orders/order_service.py", "service.py"],
    ["app/orders/rooter.py", "router.py"],
    ["app/orders/test_x.py", "tests/"],
  ])("%s fails, and the fix names %s", (path, target) => {
    const [d, ...rest] = shape(path);
    expect(rest).toEqual([]);
    expect(d).toMatchObject({ code: "INW007", severity: "error" });
    expect(d?.fix.summary).toContain(target);
  });

  test("the message never lists the allowed members; the fix does", () => {
    const [d] = shape("app/orders/helpers.py");
    expect(d?.message).toBe('"helpers.py" is not an allowed member of package "app.orders".');
    expect(d?.fix.steps.join("\n")).toContain("router, schemas");
  });

  test.each([
    "app/orders/router.py",
    "app/orders/service.py",
    "app/orders/models.pyi",
    "app/orders/__init__.py",
    "app/orders/utils/__init__.py",
    "app/main.py",
    "tests/test_orders.py",
    "tests/orders/test_x.py",
    "app/orders/utils/anything.py",
  ])("%s fits", (path) => {
    expect(shape(path)).toEqual([]);
  });

  test("forbid wins over allow, and extra = warning downgrades unexpected members only", () => {
    const warn = parseConfig(FASTAPI.replace("forbid =", 'extra = "warning"\nforbid ='));
    const [extra] = checkShape(file("app/orders/helpers.py", ""), warn);
    const [forbidden] = checkShape(file("app/orders/conftest.py", ""), warn);
    expect(extra?.severity).toBe("warning");
    expect(forbidden).toMatchObject({ severity: "error" });
    expect(forbidden?.message).toContain("is forbidden");
  });

  test("a name/ pattern allows only a subpackage, a name.py pattern only a module", () => {
    const kinds = parseConfig(
      FASTAPI.replace('"router", "schemas"', '"router.py", "schemas/"').replace(
        'require = ["__init__", "router", "service"]',
        "",
      ),
    );
    /**
     * Lists the codes checkShape reports for a path.
     *
     * @param path - a root-relative path.
     * @returns the rule codes reported, e.g. `INW007`.
     */
    function codes(path: string): string[] {
      return checkShape(file(path, ""), kinds).map((d) => d.code);
    }
    expect(codes("app/orders/router.py")).toEqual([]);
    expect(codes("app/orders/router/x.py")).toEqual(["INW007"]);
    expect(codes("app/orders/schemas/x.py")).toEqual([]);
    expect(codes("app/orders/schemas.py")).toEqual(["INW007"]);
  });

  test("the first matching entry wins", () => {
    const ordered = parseConfig(`${FASTAPI}
[[tool.inwards.shape]]
packages = ["app.**"]
allow = []
`);
    expect(checkShape(file("app/orders/helpers.py", ""), ordered)[0]?.message).toContain(
      '"app.orders"',
    );
    // app.orders.utils matches only the second entry, which allows nothing.
    expect(checkShape(file("app/orders/utils/x.py", ""), ordered)).toHaveLength(1);
  });

  test("the engine reports INW007 on a file outside every layer, without parsing it", async () => {
    const engine = await Engine.create(
      grammars(),
      parseConfig(FASTAPI.replace('modules = ["app"]', 'modules = ["app.core"]')),
    );
    const found = engine.checkFile(
      file("app/orders/helpers.py", "def ("),
      engine.index({
        kind: (): undefined => undefined,
        list: (): [] => [],
        read: (): string => "",
        listDir: (): undefined => undefined,
      }),
    );
    expect(found.map((d) => d.code)).toEqual(["INW007", "INW006"]);
  });
});

describe("INW007 and INW008: file names and targets", () => {
  test("a dotted file name is one member, not a subpackage", () => {
    const [d, ...rest] = shape("app/orders/utils.helpers.py");
    expect(rest).toEqual([]);
    expect(d?.message).toBe('"utils.helpers.py" is not an allowed member of package "app.orders".');
  });

  test("a report path above the root still names the members", () => {
    const src = { ...file("app/orders/service.old.py", ""), path: "src/app/orders/service.old.py" };
    expect(rootPathOf(src)).toBe("app/orders/service.old.py");
    expect(checkShape(src, config).map((d) => d.message)).toEqual([
      '"service.old.py" is not an allowed member of package "app.orders".',
    ]);
  });

  test("service.old.py doesn't count as the required service", () => {
    const paths = ["app/orders/__init__.py", "app/orders/router.py", "app/orders/service.old.py"];
    const found = checkRequired(config, packagesOf(paths), membersFrom(paths));
    expect(found.map((d) => d.message)).toEqual([
      'Package "app.orders" has no "service" member, which its shape requires.',
    ]);
  });

  test.each([".scratch.py", "app/.hidden/x.py", "app/orders/.x.py"])(
    "hidden %s is skipped, as every file walk skips it",
    (path) => {
      expect(shape(path)).toEqual([]);
      const segments = [...packagesOf([path])].flatMap((pkg) => pkg.split("."));
      expect(segments.filter((segment) => segment === "" || segment.startsWith("."))).toEqual([]);
    },
  );

  test.each([
    ["db.py", ["di", "adapters/"], undefined],
    ["io.py", ["di", "adapters/"], undefined],
    ["x.py", ["di", "adapters/"], undefined],
    ["urls.py", ["router", "utils"], "router.py"],
    ["rooter.py", ["router", "utils"], "router.py"],
  ])("%s with allow %j suggests %s", (member, allow, target) => {
    const text = `[tool.inwards]\nlayers = [{ name = "a", modules = ["a"] }]\n[[tool.inwards.shape]]\npackages = ["a"]\nallow = ${JSON.stringify(allow)}\n`;
    const [d] = checkShape(file(`a/${member}`, ""), parseConfig(text));
    const moves = d?.fix.steps.filter((step) => step.startsWith("Move the code into")) ?? [];
    expect(moves).toEqual(
      target === undefined ? [] : [`Move the code into a/${target} and delete ${member}.`],
    );
  });
});

describe("INW008 missing-member", () => {
  const paths = [
    "app/__init__.py",
    "app/orders/__init__.py",
    "app/orders/router.py",
    "app/users/router.py",
    "app/users/service.py",
  ];

  test("each absent required member is an error on __init__.py, or the first file", () => {
    const found = checkRequired(config, packagesOf(paths), membersFrom(paths), "src");
    expect(found.map((d) => [d.file, d.module, d.message])).toEqual([
      [
        "src/app/orders/__init__.py",
        "app.orders",
        'Package "app.orders" has no "service" member, which its shape requires.',
      ],
      [
        "src/app/users/router.py",
        "app.users",
        'Package "app.users" has no "__init__" member, which its shape requires.',
      ],
    ]);
    expect(found[0]?.fix.summary).toContain("app/orders/service.py");
  });

  test("probeMembers lists one directory, and only for a package with a required member", () => {
    const listed: string[] = [];
    const members = probeMembers((dir) => {
      listed.push(dir);
      return [
        { name: "__init__.py", dir: false },
        { name: "service.py", dir: false },
        { name: "router", dir: true },
        { name: "README.md", dir: false },
        { name: "__pycache__", dir: true },
      ];
    });
    expect(checkRequired(config, ["app", "app.orders"], members)).toEqual([]);
    expect(listed).toEqual(["app/orders"]);
  });
});

describe("shape config", () => {
  test("a selector that matches no package is a warning located in pyproject.toml", () => {
    const text = FASTAPI.replace('["app.*"]', '["app.*", "ap.*"]');
    const found = checkSelectors(parseConfig(text), packagesOf(["app/orders/router.py"]), {
      path: "pyproject.toml",
      text,
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ code: "INW007", severity: "warning", line: 6 });
  });

  test.each([
    [
      "an exact entry shadowed by an earlier glob",
      '[[tool.inwards.shape]]\npackages = ["app.orders"]\n',
      "first match wins",
    ],
    [
      "the same exact entry twice",
      '[[tool.inwards.shape]]\npackages = ["lib"]\n[[tool.inwards.shape]]\npackages = ["lib"]\n',
      'shape[2] repeats "lib" from shape[1]',
    ],
    [
      "a glob wholly inside an earlier glob",
      '[[tool.inwards.shape]]\npackages = ["lib.**"]\n[[tool.inwards.shape]]\npackages = ["lib.*"]\n',
      "already matches every package it does",
    ],
    [
      "a selector segment that isn't a Python identifier",
      '[[tool.inwards.shape]]\npackages = ["app.my-pkg"]\n',
      '"app.my-pkg"',
    ],
    [
      "a names pattern that isn't a string",
      '[[tool.inwards.names]]\npattern = ["x"]\nonly-in = ["y"]\n',
      "tool.inwards.names[1].pattern must be one member pattern",
    ],
    [
      "an unknown shape key",
      '[[tool.inwards.shape]]\npackages = ["x"]\nallowed = []\n',
      "tool.inwards.shape[1].allowed",
    ],
    [
      "an unknown names key",
      '[[tool.inwards.names]]\npattern = "x"\nonly_in = ["y"]\n',
      "tool.inwards.names[1].only_in",
    ],
    [
      "a partial wildcard segment",
      '[[tool.inwards.shape]]\npackages = ["app.svc_*"]\n',
      '"app.svc_*"',
    ],
    [
      "a member pattern with a path",
      '[[tool.inwards.shape]]\npackages = ["x"]\nallow = ["a/b"]\n',
      '"a/b"',
    ],
    ["a bad extra", '[[tool.inwards.shape]]\npackages = ["x"]\nextra = "info"\n', "extra"],
    ["no packages", "[[tool.inwards.shape]]\nallow = []\n", "packages"],
  ])("%s is a config error", (_, entry, message) => {
    expect(() => parseConfig(`${FASTAPI}\n${entry}`)).toThrow(ConfigError);
    expect(() => parseConfig(`${FASTAPI}\n${entry}`)).toThrow(message);
  });

  test("a glob that only overlaps an earlier one is fine", () => {
    const text = `${FASTAPI}\n[[tool.inwards.shape]]\npackages = ["app.**"]\n`;
    expect(parseConfig(text).shape).toHaveLength(2);
  });

  test("an exact entry before a glob that matches it is fine", () => {
    const text = FASTAPI.replace(
      "[[tool.inwards.shape]]",
      '[[tool.inwards.shape]]\npackages = ["app.core"]\n\n[[tool.inwards.shape]]',
    );
    expect(parseConfig(text).shape?.map((s) => s.packages)).toEqual([["app.core"], ["app.*"]]);
  });
});
