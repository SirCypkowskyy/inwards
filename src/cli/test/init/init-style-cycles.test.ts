/**
 * @file Every `inwards init --style` preset turns on module cycles (#340):
 * after the scaffold passes, two new modules of one layer that import each
 * other give exactly one INW004, on the first module of the cycle. Each
 * preset gets the pair where its shapes allow new modules, so nothing but
 * the cycle is reported.
 */
import { describe, expect, test } from "bun:test";
import {
  findings,
  init,
  PASSING,
  STYLES,
  UV_PROJECT,
  write,
} from "../support/init-style-helpers.ts";
import { project } from "../support/run.ts";

/**
 * Where each preset gets its two modules, below `src/my_app/`: one layer
 * package with no shape, or, where the shapes list a package's members,
 * two members they allow that share a layer.
 */
const PAIRS: Readonly<Record<(typeof STYLES)[number], readonly [string, string]>> = {
  layered: ["domain/alpha", "domain/beta"],
  clean: ["domain/alpha", "domain/beta"],
  hexagonal: ["domain/alpha", "domain/beta"],
  "vertical-slices": ["features/orders/alpha", "features/orders/beta"],
  "bounded-contexts": ["orders/domain/alpha", "orders/domain/beta"],
  django: ["orders/admin", "orders/apps"],
  fastapi: ["database", "pagination"],
};

/**
 * Turns a path below the package into its dotted module.
 *
 * @param path - e.g. `domain/alpha`.
 * @returns e.g. `my_app.domain.alpha`.
 */
function moduleOf(path: string): string {
  return `my_app.${path.replaceAll("/", ".")}`;
}

describe("inwards init --style X --scaffold turns on module cycles", () => {
  test.each([...STYLES])("%s: a planted two-module cycle gives one INW004", (style) => {
    const root = project(UV_PROJECT);
    expect(init(root, "--style", style, "--scaffold").code).toBe(PASSING.init);
    expect(findings(root)).toEqual(PASSING.check);
    const [first, second] = PAIRS[style];
    write(root, {
      [`src/my_app/${first}.py`]: `from ${moduleOf(second)} import B\n\n\nclass A:\n    pass\n`,
      [`src/my_app/${second}.py`]: `from ${moduleOf(first)} import A\n\n\nclass B:\n    pass\n`,
    });
    expect(findings(root)).toEqual({ code: 1, findings: [`INW004 src/my_app/${first}.py`] });
  });
});
