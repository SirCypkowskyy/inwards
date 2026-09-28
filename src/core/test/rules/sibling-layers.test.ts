/**
 * @file Independent sibling layers (#97, ADR-036): layers of one rank may not
 * import each other (INW001, and INW011 for dynamic imports), every layer of a
 * lower rank stays importable, the allowed direction joins siblings with `|`,
 * and every sibling of the lowest rank gets INW005's default deny list. The
 * config spells siblings as nested arrays, what a template's `a | b` expands to.
 */
import { describe, expect, test } from "bun:test";
import { type Diagnostic, Engine, parseConfig, type SourceFile } from "../../src/index.ts";
import { file, grammars, indexOn } from "../support/helpers.ts";

const CONFIG = parseConfig(`[tool.inwards]
layers = [
  [
    { name = "constants", modules = ["app.constants"] },
    { name = "config", modules = ["app.config"] },
  ],
  [
    { name = "models", modules = ["app.models"] },
    { name = "schemas", modules = ["app.schemas"] },
  ],
  { name = "service", modules = ["app.service"] },
]
`);

const engine: Engine = await Engine.create(grammars(), CONFIG);

/** Every layer's module exists on disk. */
const DISK: ReadonlyMap<string, "file" | "dir"> = new Map([
  ["app", "dir"],
  ["app/__init__.py", "file"],
  ...["constants", "config", "models", "schemas", "service"].map((m): [string, "file"] => [
    `app/${m}.py`,
    "file",
  ]),
]);

/**
 * Checks one file against the sibling config.
 *
 * @param src - the file.
 * @returns its rule codes and messages.
 */
function check(src: SourceFile): Pick<Diagnostic, "code" | "message">[] {
  return engine.checkFile(src, indexOn(DISK)).map(({ code, message }) => ({ code, message }));
}

describe("sibling layers", () => {
  test("may not import each other", () => {
    expect(check(file("app/schemas.py", "from app.models import Order\n"))).toEqual([
      {
        code: "INW001",
        message:
          'Layer "schemas" imports "app.models.Order" from sibling layer "models". Allowed direction: constants | config <- models | schemas <- service.',
      },
    ]);
  });

  test("may import every layer of a lower rank, and be imported by a higher one", () => {
    const text = "from app.constants import A\nfrom app.config import B\n";
    expect(check(file("app/models.py", text))).toEqual([]);
    expect(check(file("app/service.py", "import app.models\nimport app.schemas\n"))).toEqual([]);
  });

  test("still may not import an outer layer", () => {
    expect(check(file("app/config.py", "import app.service\n"))[0]?.message).toStartWith(
      'Layer "config" imports "app.service" from outer layer "service".',
    );
  });

  test("a dynamic import of a sibling is INW011", () => {
    const found = check(
      file("app/models.py", 'import importlib\nimportlib.import_module("app.schemas")\n'),
    );
    expect(found.map((d) => d.code)).toEqual(["INW011"]);
    expect(found[0]?.message).toContain('from sibling layer "schemas"');
  });

  test("every sibling of the lowest rank gets the default deny list", () => {
    for (const path of ["app/constants.py", "app/config.py"]) {
      expect(check(file(path, "import sqlalchemy\n")).map((d) => d.code)).toEqual(["INW005"]);
    }
    expect(check(file("app/models.py", "import sqlalchemy\n"))).toEqual([]);
  });
});
