import { describe, expect, test } from "bun:test";
import { type Diagnostic, Engine, parseConfig } from "../src/index.ts";
import { check, file, grammars, indexOn } from "./helpers.ts";

const LAYERS = `layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]
`;

/**
 * Builds an engine over the test layers with a `generated` setting.
 *
 * @param generated - the TOML value of `generated`, or undefined to leave it out.
 * @returns the engine.
 */
async function engineWith(generated: string | undefined): Promise<Engine> {
  const key = generated === undefined ? "" : `generated = ${generated}\n`;
  return await Engine.create(grammars(), parseConfig(`[tool.inwards]\n${key}${LAYERS}`));
}

/** A project with `shop.domain`, `shop.infrastructure` and the unassigned `shop.persistence`, and no generated file. */
const DISK = indexOn(
  new Map<string, "file" | "dir">([
    ["shop", "dir"],
    ["shop/__init__.py", "file"],
    ["shop/domain", "dir"],
    ["shop/domain/order.py", "file"],
    ["shop/infrastructure", "dir"],
    ["shop/infrastructure/db.py", "file"],
    ["shop/persistence", "dir"],
    ["shop/persistence/repo.py", "file"],
  ]),
);

/**
 * Checks a snippet as `shop/domain/order.py` and lists `code module` per finding.
 *
 * @param engine - the engine to check with.
 * @param src - Python source.
 * @returns what was reported.
 */
function codes(engine: Engine, src: string): string[] {
  return engine
    .checkFile(file("shop/domain/order.py", src), DISK)
    .map((d: Diagnostic) => `${d.code} ${d.message.split(" ")[0]}`);
}

const DEFAULTS: Engine = await engineWith(undefined);

describe("generated modules and INW010 (#160)", () => {
  test.each([
    ["a protoc module", "from shop.domain.orders_pb2 import Order\n"],
    ["a protoc gRPC module", "import shop.domain.orders_pb2_grpc\n"],
    ["a relative protoc import", "from .orders_pb2 import Order\n"],
    ["a setuptools-scm version module", "from shop.domain._version import version\n"],
    ["a module under a missing package", "from shop.domain.proto.orders_pb2 import Order\n"],
  ])("by default, %s that isn't on disk passes", (_, src) => {
    expect(codes(DEFAULTS, src)).toEqual([]);
  });

  test.each([
    ["an ordinary missing module", "import shop.domain.pricing\n"],
    ["a name that only contains the suffix", "import shop.domain.orders_pb2x\n"],
    ["a version module under another name", "from shop.domain.version import v\n"],
  ])("by default, %s is still reported", (_, src) => {
    expect(codes(DEFAULTS, src).map((c) => c.split(" ")[0])).toEqual(["INW010"]);
  });

  test("the default list is the one in the check helpers' engine too", () => {
    expect(check(file("shop/domain/order.py", "import shop.domain.orders_pb2\n"))).toEqual([]);
  });

  test("a configured list replaces the default", async () => {
    const custom = await engineWith('["domain.gen", "*_schema"]');
    expect(codes(custom, "from shop.domain.gen.orders import Order\n")).toEqual([]);
    expect(codes(custom, "import shop.domain.orders_schema\n")).toEqual([]);
    expect(codes(custom, "import shop.domain.orders_pb2\n")).toEqual([
      'INW010 "shop.domain.orders_pb2"',
    ]);
  });

  test("an empty list turns the default off", async () => {
    const none = await engineWith("[]");
    expect(codes(none, "from shop.domain._version import version\n")).toEqual([
      'INW010 "shop.domain._version"',
    ]);
  });

  test("a glob stays inside one segment", async () => {
    const custom = await engineWith('["domain*pb2"]');
    expect(codes(custom, "import shop.domain.orders_pb2\n")).toEqual([
      'INW010 "shop.domain.orders_pb2"',
    ]);
  });

  test("the other rules still check it: INW001 by name, INW006 by its nearest package", () => {
    // INW001 goes by name, so an outward import is reported whatever is on disk.
    expect(codes(DEFAULTS, "import shop.infrastructure.orders_pb2\n")).toEqual(["INW001 Layer"]);
    // INW006 sees the nearest package that exists: shop.persistence belongs to no layer.
    const [d, ...rest] = DEFAULTS.checkFile(
      file("shop/domain/order.py", "from shop.persistence.orders_pb2 import Order\n"),
      DISK,
    );
    expect(rest).toEqual([]);
    expect(d?.code).toBe("INW006");
    expect(d?.message).toBe(
      'Layer "domain" imports "shop.persistence.orders_pb2.Order", which belongs to no layer, so nothing checks what "shop.persistence" imports.',
    );
  });
});

describe("generated in [tool.inwards]", () => {
  test("is absent unless set, and kept as written", () => {
    expect(parseConfig(`[tool.inwards]\n${LAYERS}`).generated).toBeUndefined();
    const set = parseConfig(`[tool.inwards]\ngenerated = ["*_pb2", "shop.gen"]\n${LAYERS}`);
    expect(set.generated).toEqual(["*_pb2", "shop.gen"]);
    expect(parseConfig(`[tool.inwards]\ngenerated = []\n${LAYERS}`).generated).toEqual([]);
  });

  test.each(["_version", "*_pb2", "[!_]*_pb2", "shop.gen", "shop.*.gen", "api_v?", "[a-z]*_pb2"])(
    "%j is a valid pattern",
    (pattern) => {
      const text = `[tool.inwards]\ngenerated = [${JSON.stringify(pattern)}]\n${LAYERS}`;
      expect(parseConfig(text).generated).toEqual([pattern]);
    },
  );

  test.each([
    ['"*_pb2"', "must be a list of module patterns"],
    ["[1]", "must be a list of module patterns"],
    ['[""]', '"" is not a module pattern'],
    ['["shop..gen"]', '"shop..gen" is not a module pattern'],
    ['["shop/gen"]', '"shop/gen" is not a module pattern'],
    ['["orders-pb2"]', '"orders-pb2" is not a module pattern'],
    ['["[abc"]', '"[abc" is not a module pattern'],
    ['["[z-a]"]', '"[z-a]" is not a module pattern'],
    ['["*"]', '"*" has no fixed character'],
    ['["*.*"]', '"*.*" has no fixed character'],
    ['["?"]', 'ignore = ["INW010"] in [tool.inwards.rules]'],
  ])("generated = %s is a config error", (value, message) => {
    const text = `[tool.inwards]\ngenerated = ${value}\n${LAYERS}`;
    expect(() => parseConfig(text)).toThrow(message);
  });
});
