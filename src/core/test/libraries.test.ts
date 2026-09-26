import { describe, expect, test } from "bun:test";
import { ConfigError, type Diagnostic, type ImportRef, parseConfig } from "../src/index.ts";
import { checkLibraries } from "../src/libraries.ts";
import { check, file, OWNERS } from "./helpers.ts";

const TARGET = /imports "(?<t>[^"]+)"/u;

/**
 * Lists what INW005 reports for a snippet checked by the test engine.
 *
 * @param src - Python source.
 * @param path - where the file sits; a domain module by default.
 * @returns the reported import targets.
 */
function denied(src: string, path = "shop/domain/order.py"): string[] {
  return check(file(path, src))
    .filter((d) => d.code === "INW005")
    .map((d) => TARGET.exec(d.message)?.groups?.["t"] ?? "");
}

/**
 * Builds a static import of a module, for calling the rule directly.
 *
 * @param target - the imported module.
 * @returns the import on line 1.
 */
function importOf(target: string): ImportRef {
  return { target, statement: `import ${target}`, line: 1, column: 1, endLine: 1, endColumn: 1 };
}

/**
 * Treats a top-level `redis` package as first-party code of the project.
 *
 * @param target - an import target.
 * @returns `redis` for anything under it.
 */
function ownRedis(target: string): string | undefined {
  return target === "redis" || target.startsWith("redis.") ? "redis" : undefined;
}

/**
 * Checks one import of the domain against custom layer keys, with the test project's modules.
 *
 * @param keys - extra keys for the inner layer, e.g. `allow-libraries = ["attrs"]`.
 * @param target - the module `shop/domain/order.py` imports.
 * @returns the INW005 diagnostics.
 */
function withKeys(keys: string, target: string): Diagnostic[] {
  const { layers } = parseConfig(`[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"]${keys ? `, ${keys}` : ""} },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]
`);
  return checkLibraries(file("shop/domain/order.py", ""), [importOf(target)], layers, OWNERS);
}

describe("INW005 pure-domain", () => {
  test("the domain may not import a framework by default, with a port-based fix", () => {
    const [d, ...rest] = check(
      file("shop/domain/order.py", "from sqlalchemy.orm import Session\n"),
    );
    expect(rest).toEqual([]);
    expect(d).toMatchObject({ code: "INW005", rule: "pure-domain", severity: "error", line: 1 });
    expect(d?.message).toBe(
      'Layer "domain" imports "sqlalchemy.orm.Session" from library "sqlalchemy", which "domain" may not use.',
    );
    expect(d?.fix.summary).toBe(
      'Use "sqlalchemy" in "application" behind a port owned by "domain".',
    );
    expect(d?.fix.steps[1]).toContain("`shop.domain.ports`");
  });

  test.each([
    ["import requests\n"],
    ["import http.client\n"],
    ["def f():\n    import subprocess\n"],
    ["from typing import TYPE_CHECKING\nif TYPE_CHECKING:\n    import fastapi\n"],
    ['import importlib\nimportlib.import_module("httpx")\n'],
    ['exec("import socket")\n'],
  ])("every form is reported: %j", (src) => {
    expect(denied(src)).toHaveLength(1);
  });

  test.each([
    ["the stdlib", "import dataclasses\nfrom urllib.parse import urlsplit\nimport http\n"],
    ["other third-party code", "import attrs\n"],
    ["first-party code", "from shop.domain import order\nfrom . import order\n"],
  ])("the domain may import %s", (_, src) => {
    expect(denied(src)).toEqual([]);
  });

  test("outer layers have no default list", () => {
    expect(denied("import sqlalchemy\n", "shop/infrastructure/db.py")).toEqual([]);
  });

  test("a single layer is not a domain: no default list", () => {
    const { layers } = parseConfig(
      '[tool.inwards]\nlayers = [{ name = "app", modules = ["shop"] }]\n',
    );
    const ref = importOf("fastapi");
    expect(checkLibraries(file("shop/api.py", ""), [ref], layers, () => undefined)).toEqual([]);
  });

  test("a first-party package named like a library is first-party", () => {
    const { layers } = parseConfig(`[tool.inwards]
layers = [{ name = "d", modules = ["shop.domain"] }, { name = "i", modules = ["shop.infrastructure"] }]
`);
    const ref = importOf("redis.client");
    expect(checkLibraries(file("shop/domain/order.py", ""), [ref], layers, ownRedis)).toEqual([]);
    expect(
      checkLibraries(file("shop/domain/order.py", ""), [ref], layers, () => undefined),
    ).toHaveLength(1);
  });

  test("allow-libraries denies every other third-party library, never the stdlib", () => {
    const keys = 'allow-libraries = ["attrs"]';
    expect(withKeys(keys, "attrs.define")).toEqual([]);
    expect(withKeys(keys, "collections.abc")).toEqual([]);
    expect(withKeys(keys, "pydantic")).toHaveLength(1);
  });

  test("allow-libraries overrides the default list; the longest entry wins", () => {
    expect(withKeys('allow-libraries = ["sqlalchemy"]', "sqlalchemy.orm")).toEqual([]);
    const keys = 'deny-libraries = ["os"], allow-libraries = ["os.path"]';
    expect(withKeys(keys, "os.path")).toEqual([]);
    expect(withKeys(keys, "os.environ")).toHaveLength(1);
  });

  test("deny-libraries replaces the default list", () => {
    expect(withKeys("deny-libraries = []", "sqlalchemy")).toEqual([]);
    expect(withKeys('deny-libraries = ["pydantic"]', "pydantic.BaseModel")).toHaveLength(1);
  });

  test("with no outer layer allowed to use it, the fix asks the user", () => {
    const { layers } = parseConfig(`[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "infrastructure", modules = ["shop.infrastructure"], deny-libraries = ["sqlalchemy"] },
]
`);
    const ref = importOf("sqlalchemy");
    const [d] = checkLibraries(file("shop/domain/order.py", ""), [ref], layers, OWNERS);
    expect(d?.fix.summary).toContain(
      '"domain" may not use "sqlalchemy", and no outer layer may either',
    );
  });

  test.each([
    ['allow-libraries = "attrs"', "allow-libraries must be a list of module names"],
    ['deny-libraries = [""]', "deny-libraries must be a list of module names"],
  ])("%s is a config error", (keys, message) => {
    const text = `[tool.inwards]\nlayers = [{ name = "d", modules = ["d"], ${keys} }]\n`;
    expect(() => parseConfig(text)).toThrow(ConfigError);
    expect(() => parseConfig(text)).toThrow(message);
  });
});
