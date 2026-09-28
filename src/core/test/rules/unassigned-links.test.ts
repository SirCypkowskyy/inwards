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
 * Builds a link as the adapter reports it.
 *
 * @param path - where the link is, relative to the config root.
 * @param target - its target, root-relative, or undefined outside the root.
 * @param real - its real target; by default the target, or an outside directory.
 * @returns the link record `checkLinks` takes.
 */
function link(path: string, target: string | undefined, real = target ?? "/outside"): LayerLink {
  return { path, target, real };
}

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
      links: [link("shop/domain/ext", undefined)],
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
    const [message, ...rest] = messages(link(path, target));
    expect(rest).toEqual([]);
    expect(message).toContain(`symlink to ${named}`);
  });

  test.each([
    ["within its layer", "shop/domain/alias", "shop/domain/real"],
    ["into code outside every layer (checked under the link's name)", "shop/domain/sub", "vendor"],
    ["outside every layer", "shop/misc", "shop/infrastructure"],
  ])("a link %s is fine", (_, path, target) => {
    expect(messages(link(path, target))).toEqual([]);
  });

  test("[tool.inwards.rules] applies outside a session, not in one", () => {
    const off = { ...CONFIG, rules: { ignore: ["INW006"] } };
    const now = {
      links: [link("shop/domain/ext", undefined)],
      modules: MODULES,
      shownRoot: "",
    };
    expect(checkLinks(off, now)).toEqual([]);
    expect(checkLinks(off, now, { ...now, links: [] })).toHaveLength(1);
  });

  test("in a session, only links new since the start are reported, a retargeted one included", () => {
    const ext = link("shop/domain/ext", undefined);
    const alias = link("shop/domain/alias", "shop/domain/real");
    const start = { links: [ext, alias], modules: MODULES, shownRoot: "" };
    expect(checkLinks(CONFIG, start, start)).toEqual([]);
    const moved = { ...start, links: [ext, link("shop/domain/alias", "shop/infrastructure")] };
    expect(checkLinks(CONFIG, moved, start).map((d) => d.file)).toEqual(["shop/domain/alias"]);
  });

  test("in a session, a link moved from one outside directory to another is new", () => {
    const start = {
      links: [link("shop/domain/ext", undefined, "/a")],
      modules: MODULES,
      shownRoot: "",
    };
    const moved = { ...start, links: [link("shop/domain/ext", undefined, "/b")] };
    expect(checkLinks(CONFIG, moved, start)).toHaveLength(1);
  });

  test("a link above the layers is reported only when it leaves the root", () => {
    const slices = parseConfig(`[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.*.domain"] },
  { name = "infrastructure", modules = ["shop.*.infrastructure"] },
]
`);
    /**
     * Builds the links of a project with one link above the layers, `shop/payments`.
     *
     * @param target - where it points, root-relative, or undefined outside the root.
     * @returns the tree to check.
     */
    function tree(target: string | undefined): Parameters<typeof checkLinks>[1] {
      return {
        links: [link("shop/payments", target)],
        modules: new Set(["shop.orders.domain.order"]),
        shownRoot: "",
      };
    }
    const [d, ...rest] = checkLinks(slices, tree(undefined));
    expect(rest).toEqual([]);
    expect(d?.message).toContain('"shop.payments", where layer entries can match, but no rule');
    // In the root, the walk names the code behind it by the link, which the layers own.
    expect(checkLinks(slices, tree("shop/orders"))).toEqual([]);
    expect(checkLinks(slices, { ...tree(undefined), links: [link("tools/x", undefined)] })).toEqual(
      [],
    );
    // A name `import` can't spell holds no slice.
    const assets = { ...tree(undefined), links: [link("shop/static-assets", undefined)] };
    expect(checkLinks(slices, assets)).toEqual([]);
  });

  test("a target that holds a linked layer package's real code holds layers", () => {
    const holding = { ...link("shop/domain/p", "packages"), holdsLayers: true };
    expect(messages(holding)).toEqual([
      'shop/domain/p is a symlink to "packages", which holds layers: an import of "shop.domain.p" (layer "domain") loads that code, and no layer rule sees the dependency.',
    ]);
    expect(messages(link("shop/domain/p", "packages"))).toEqual([]);
  });
});
