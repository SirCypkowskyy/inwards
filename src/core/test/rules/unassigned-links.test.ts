/**
 * @file INW006 for symlinks inside a layer (#83, #84): a link out of the config
 * root, into another layer or above the layers is an error at the link; a link
 * within its layer, into unassigned code or outside every layer is not. The
 * session mode reports only links that are new since the start.
 */
import { describe, expect, test } from "bun:test";
import { type LayerLink, parseConfig } from "../../src/index.ts";
import { checkLinks } from "../../src/rules/unassigned-module/links.ts";

const CONFIG = parseConfig(`[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]
`);

const MODULES = new Set(["shop.domain.order", "shop.infrastructure.db", "vendor.ext.leak"]);

/**
 * Checks links against the two-layer config, outside a session.
 *
 * @param links - the links, root-relative.
 * @returns the messages found, in order.
 */
function messages(...links: LayerLink[]): string[] {
  return checkLinks(CONFIG, { links, modules: MODULES, shownRoot: "" }).map((d) => d.message);
}

describe("INW006 symlinks in layers", () => {
  test("a link out of the root hides code: an error at the link (#83)", () => {
    const [d, ...rest] = checkLinks(CONFIG, {
      links: [{ path: "shop/domain/ext", target: undefined }],
      modules: MODULES,
      shownRoot: "src",
    });
    expect(rest).toEqual([]);
    expect(d).toMatchObject({
      code: "INW006",
      severity: "error",
      file: "src/shop/domain/ext",
      module: "shop.domain.ext",
      line: 1,
    });
    expect(d?.message).toContain('symlink out of root "."');
  });

  test.each([
    ["a directory", "shop/domain/infra_alias", "shop/infrastructure", '"shop.infrastructure"'],
    ["a file", "shop/domain/db.py", "shop/infrastructure/db.py", '"shop.infrastructure.db"'],
    ["the package above the layers", "shop/domain/up", "shop", '"shop"'],
    ["the root", "shop/domain/top", "", "the config root"],
  ])("a link into %s crosses layers under the domain's name (#84)", (_, path, target, named) => {
    const [message, ...rest] = messages({ path, target });
    expect(rest).toEqual([]);
    expect(message).toContain(`symlink to ${named}`);
  });

  test.each([
    ["within its layer", "shop/domain/alias", "shop/domain/real"],
    ["into code outside every layer (checked under the link's name)", "shop/domain/sub", "vendor"],
    ["outside every layer", "shop/misc", "shop/infrastructure"],
  ])("a link %s is fine", (_, path, target) => {
    expect(messages({ path, target })).toEqual([]);
  });

  test("[tool.inwards.rules] applies outside a session, not in one", () => {
    const off = { ...CONFIG, rules: { ignore: ["INW006"] } };
    const now = {
      links: [{ path: "shop/domain/ext", target: undefined }],
      modules: MODULES,
      shownRoot: "",
    };
    expect(checkLinks(off, now)).toEqual([]);
    expect(checkLinks(off, now, { ...now, links: [] })).toHaveLength(1);
  });

  test("in a session, only links new since the start are reported, a retargeted one included", () => {
    const ext = { path: "shop/domain/ext", target: undefined };
    const alias = { path: "shop/domain/alias", target: "shop/domain/real" };
    const start = { links: [ext, alias], modules: MODULES, shownRoot: "" };
    expect(checkLinks(CONFIG, start, start)).toEqual([]);
    const moved = { ...start, links: [ext, { ...alias, target: "shop/infrastructure" }] };
    expect(checkLinks(CONFIG, moved, start).map((d) => d.file)).toEqual(["shop/domain/alias"]);
  });
});
