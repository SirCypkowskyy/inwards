/**
 * @file INW010 and namespace packages shared with an installed distribution
 * (#161): a module another portion holds (the project's virtualenv, through
 * the `portions` probe) or one directly inside a package `namespace-packages`
 * lists passes, and gets no INW006 either. A made-up module inside a
 * subpackage the project has is still reported.
 */
import { describe, expect, test } from "bun:test";
import { Engine, parseConfig } from "../../src/index.ts";
import { file, grammars } from "../support/helpers.ts";

describe("namespace packages shared with an installed distribution (#161)", () => {
  // Local `acme/platform/billing/` (a regular package) under PEP 420 `acme` and `acme.platform`;
  // `acme-platform-auth` installs `acme/platform/auth/`.
  const here = new Map<string, "file" | "dir">([
    ["acme", "dir"],
    ["acme/platform", "dir"],
    ["acme/platform/billing", "dir"],
    ["acme/platform/billing/__init__.py", "file"],
    ["acme/platform/billing/invoices.py", "file"],
  ]);
  const sitePackages = new Map<string, "file" | "dir">([
    ["acme", "dir"],
    ["acme/platform", "dir"],
    ["acme/platform/auth", "dir"],
    ["acme/platform/auth/__init__.py", "file"],
    ["acme/platform/auth/tokens.py", "file"],
  ]);
  const layers =
    '[tool.inwards]\nlayers = [{ name = "billing", modules = ["acme.platform.billing"] }]\n';

  /**
   * Checks the billing module against the local tree, with an optional
   * site-packages portion and config lines.
   *
   * @param src - Python source of `acme/platform/billing/invoices.py`.
   * @param options - what else the check sees.
   * @param options.portions - the site-packages tree, if any.
   * @param options.extra - config lines after `layers`.
   * @returns every finding, as `code target` pairs.
   */
  async function findings(
    src: string,
    options: { portions?: ReadonlyMap<string, "file" | "dir">; extra?: string } = {},
  ): Promise<string[]> {
    const { portions, extra = "" } = options;
    const acme = await Engine.create(grammars(), parseConfig(`${layers}${extra}`));
    const project = acme.index({
      kind: (rel: string): "file" | "dir" | undefined => here.get(rel),
      list: (): string[] => [],
      read: (): string => "",
      listDir: (): undefined => undefined,
      ...(portions ? { portions: (rel: string) => portions.get(rel) } : {}),
    });
    return acme
      .checkFile(file("acme/platform/billing/invoices.py", src), project)
      .map((d) => `${d.code} ${d.message.split(" ")[0] ?? ""}`);
  }

  test("a module the virtualenv's portion holds reports nothing", async () => {
    const src = "import acme.platform.auth.tokens\nfrom acme.platform.auth import tokens\n";
    expect(await findings(src, { portions: sitePackages })).toEqual([]);
  });

  test("a made-up module inside the local package is still reported", async () => {
    const src = "from acme.platform.billing.pricing import Price\n";
    expect(await findings(src, { portions: sitePackages })).toEqual([
      'INW010 "acme.platform.billing.pricing"',
    ]);
    expect(await findings(src, { extra: 'namespace-packages = ["acme.platform"]\n' })).toEqual([
      'INW010 "acme.platform.billing.pricing"',
    ]);
  });

  test("a module no portion holds is reported without namespace-packages", async () => {
    expect(await findings("import acme.platform.auth.tokens\n")).toEqual([
      'INW010 "acme.platform.auth.tokens"',
    ]);
    expect(await findings("import acme.platform.sso\n", { portions: sitePackages })).toEqual([
      'INW010 "acme.platform.sso"',
    ]);
  });

  test("namespace-packages accepts a sibling of the local part without a virtualenv", async () => {
    const extra = 'namespace-packages = ["acme.platform"]\n';
    expect(await findings("import acme.platform.auth.tokens\n", { extra })).toEqual([]);
  });

  test("namespace-packages covers only the packages it lists", async () => {
    expect(
      await findings("import acme.platform.auth.tokens\n", {
        extra: 'namespace-packages = ["acme"]\n',
      }),
    ).toEqual(['INW010 "acme.platform.auth.tokens"']);
  });
});
