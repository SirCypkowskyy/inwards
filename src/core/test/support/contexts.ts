/**
 * @file The bounded-context fixture the INW002 tests share: three slices,
 * `orders`, `billing` and `shipping`, a `tax` context nested in billing, a
 * shared kernel in no context, and `shop/shipping/api.py` in a context but in
 * no layer. Orders depends on billing; extra `depends-on` and `public`
 * entries, extra contexts and file contents can be added per test.
 */
import {
  type Diagnostic,
  Engine,
  type ProjectFiles,
  type ProjectIndex,
  parseConfig,
} from "../../src/index.ts";
import { file, grammars, indexOn } from "./helpers.ts";

/**
 * The fixture's config.
 *
 * @param extra - more `depends-on` and `public` by context name, and TOML appended at the end.
 * @param extra.dependsOn - extra dependencies, e.g. `{ billing: ["shipping"] }`.
 * @param extra.public - public prefixes, e.g. `{ billing: ["shop.billing.api"] }`.
 * @param extra.toml - more tables, e.g. another context.
 * @returns the TOML text.
 */
function configText({ dependsOn = {}, public: open = {}, toml = "" }: Extra): string {
  /**
   * Writes one context's depends-on list.
   *
   * @param name - the context.
   * @param base - what the fixture declares for it anyway.
   * @returns the TOML array.
   */
  function deps(name: string, base: string[] = []): string {
    return JSON.stringify([...base, ...(dependsOn[name] ?? [])]);
  }
  /**
   * Writes one context's public list.
   *
   * @param name - the context.
   * @returns the TOML array.
   */
  function pub(name: string): string {
    return JSON.stringify(open[name] ?? []);
  }
  return `
[tool.inwards]
layers = [
  { name = "domain", modules = ["shop.orders.domain", "shop.billing.domain", "shop.shipping.domain", "shop.shared"] },
  { name = "app", modules = ["shop.orders.app", "shop.billing.app", "shop.billing.tax", "shop.shipping.app"] },
]

[[tool.inwards.contexts]]
name = "orders"
modules = ["shop.orders"]
public = ${pub("orders")}
depends-on = ${deps("orders", ["billing"])}

[[tool.inwards.contexts]]
name = "billing"
modules = ["shop.billing"]
public = ${pub("billing")}
depends-on = ${deps("billing")}

[[tool.inwards.contexts]]
name = "tax"
modules = ["shop.billing.tax"]
public = ${pub("tax")}
depends-on = ${deps("tax")}

[[tool.inwards.contexts]]
name = "shipping"
modules = ["shop.shipping"]
public = ${pub("shipping")}
depends-on = ${deps("shipping")}
${toml}`;
}

const MODULES = [
  "shop/orders/domain/order.py",
  "shop/orders/app/place.py",
  "shop/billing/domain/invoice.py",
  "shop/billing/app/charge.py",
  "shop/billing/tax/rates.py",
  "shop/shipping/domain/parcel.py",
  "shop/shipping/app/ship.py",
  "shop/shipping/api.py",
  "shop/shared/money.py",
  "shop/billing/api.py",
];

/**
 * Lists a module file and the packages above it, as the disk would.
 *
 * @param path - the module's path.
 * @returns each package directory with its `__init__.py`, then the file.
 */
function onDisk(path: string): [string, "file" | "dir"][] {
  const parts = path.split("/");
  const entries: [string, "file" | "dir"][] = [];
  for (let i = 1; i < parts.length; i += 1) {
    const dir = parts.slice(0, i).join("/");
    entries.push([dir, "dir"], [`${dir}/__init__.py`, "file"]);
  }
  entries.push([path, "file"]);
  return entries;
}

/** The files on disk: every module above, with its packages. */
const DISK = new Map(MODULES.flatMap(onDisk));

/** The project on disk, every file empty. */
const PROJECT: ProjectIndex = indexOn(DISK);

/** What a fixture can add to the config and the files. */
interface Extra {
  dependsOn?: Record<string, string[]>;
  public?: Record<string, string[]>;
  toml?: string;
  /** File contents by path, for the rules that read other modules (INW003's fix). */
  texts?: ReadonlyMap<string, string>;
}

/** Checks files of the fixture. */
export interface ContextFixture {
  /**
   * Checks one file.
   *
   * @param path - where it sits.
   * @param text - its source.
   * @returns every diagnostic.
   */
  check: (path: string, text: string) => Diagnostic[];
  /**
   * Lists one file's INW002 findings.
   *
   * @param path - where it sits.
   * @param text - its source.
   * @returns each finding's line and message.
   */
  across: (path: string, text: string) => [number, string][];
  /** The engine, for checking several files at once. */
  engine: Engine;
}

/**
 * Builds an engine over the fixture.
 *
 * @param extra - more `depends-on` and `public` by context, more TOML, and file contents.
 * @returns the check helpers.
 */
export async function contextFixture(extra: Extra = {}): Promise<ContextFixture> {
  const engine = await Engine.create(grammars(), parseConfig(configText(extra)));
  const project = extra.texts ? engine.index(filesOf(extra.texts)) : PROJECT;
  /**
   * Checks one file.
   *
   * @param path - where it sits.
   * @param text - its source.
   * @returns every diagnostic.
   */
  function check(path: string, text: string): Diagnostic[] {
    return engine.checkFiles([file(path, text)], project);
  }
  return {
    check,
    across: (path: string, text: string): [number, string][] =>
      check(path, text)
        .filter((d) => d.code === "INW002")
        .map((d) => [d.line, d.message]),
    engine,
  };
}

/** The fixture's module index, for checking several files at once. */
export const CONTEXT_PROJECT: ProjectIndex = PROJECT;

/**
 * The fixture's files with some contents, as an adapter would give them.
 *
 * @param texts - file contents by path; other files are empty.
 * @returns the port the engine indexes.
 */
function filesOf(texts: ReadonlyMap<string, string>): ProjectFiles {
  return {
    kind: (rel: string): "file" | "dir" | undefined => DISK.get(rel),
    list: (): string[] => [...DISK].flatMap(([rel, kind]) => (kind === "file" ? [rel] : [])),
    read: (rel: string): string => texts.get(rel) ?? "",
    listDir: (): undefined => undefined,
  };
}
