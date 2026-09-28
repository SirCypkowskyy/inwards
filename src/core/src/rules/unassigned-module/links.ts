/**
 * @file INW006 for symlinks inside a layer: a link whose real target lies
 * outside the config root, in another layer, or above other layers. Python
 * imports through a link under the link's name, so its code is checked by
 * that name; but a target outside the root is never read (ADR-013), and a
 * target in another layer makes `shop.domain.alias.db` infrastructure code
 * that INW001 takes for domain code (#83, #84).
 *
 * Pure over what the adapter found: it walks the layer packages, following
 * links that stay in the root, and names each link by the path Python imports
 * it through and its target by its import spelling. A link into a package
 * outside every layer is fine: its code is checked under the link's name,
 * and INW006 already warns about the package itself. A link above the layers
 * (`shop/payments` under `shop.*.domain`) is judged only when it leaves the
 * root: in the root, the walk names its code by the link, which the layers
 * then own.
 */
import { entryReach } from "../../config/layer-selector.ts";
import type { LayerSpec } from "../../config/layers.ts";
import type { InwardsConfig } from "../../config/parse.ts";
import { applyRules } from "../../config/rule-settings.ts";
import type { Diagnostic, SourceFile, Span } from "../../contracts/records.ts";
import { diagnostic, RULES } from "../../meta/registry.ts";
import { moduleNameFor } from "../../python/module-names.ts";
import { layerMembership } from "../shared/layer-ownership.ts";
import { type Evidence, holdsLayer, moduleEvidence } from "./imports.ts";

/** A symlink inside a layer package, as the adapter found it. */
export interface LayerLink {
  /** The link, relative to the config root, with forward slashes. */
  path: string;
  /**
   * Its real target, relative to the real config root with forward slashes
   * (`""` for the root itself), or undefined when the target lies outside the root.
   */
  target: string | undefined;
  /**
   * The real target as the adapter found it, only to tell one target from
   * another in a session: two outside targets have no `target` to compare.
   */
  real: string;
  /**
   * True when the target holds layer code the name alone doesn't show: it
   * contains the real directory of a layer package that is a link (`packages`
   * above `packages/shop` with `shop -> packages/shop`).
   */
  holdsLayers?: boolean;
}

/** A Python identifier: what `import` accepts as one name segment. */
const IDENTIFIER = /^[\p{XID_Start}_]\p{XID_Continue}*$/u;

/** The links of one config and what they are judged against. */
export interface LinkTree {
  links: readonly LayerLink[];
  /** Every first-party module, the evidence for selectors (see `holdsLayer`). */
  modules: ReadonlySet<string>;
  /** The config root as report paths show it (`""` or `src`). */
  shownRoot: string;
}

const FIRST_LINE: Span = { line: 1, column: 1, endLine: 1, endColumn: 1 };

/**
 * Reports the symlinks inside layers that hide code from the rules: a link
 * out of the config root (nothing reads its code), and a link into another
 * layer or into a package that holds layers (an import through it crosses
 * layers under an inner layer's name). A link within its own layer, or into
 * code outside every layer, is fine. Dangling links never reach here.
 *
 * With `before`, the links at session start, only findings that are new
 * since then are returned, and `[tool.inwards.rules]` doesn't apply: a new
 * link is a way around the layers, like moving a layer away (ADR-027).
 *
 * @param config - the layers and `[tool.inwards.rules]`.
 * @param now - the links found in the layer packages, with the modules and the shown root.
 * @param before - the links at session start, when a session is being checked.
 * @returns one error per offending link, located at the link.
 */
export function checkLinks(config: InwardsConfig, now: LinkTree, before?: LinkTree): Diagnostic[] {
  const found = linkFindings(config, now);
  if (before === undefined) {
    return applyRules(
      found.map(({ finding }) => finding),
      config.rules,
    );
  }
  const had = new Set(linkFindings(config, before).map(keyOf));
  return found.filter((d) => !had.has(keyOf(d))).map(({ finding }) => finding);
}

/**
 * Finds the offending links, before `[tool.inwards.rules]`.
 *
 * @param config - the layers.
 * @param tree - what to judge.
 * @param tree.links - the links, root-relative.
 * @param tree.modules - every first-party module, the evidence for selectors.
 * @param tree.shownRoot - the config root as report paths show it.
 * @returns one error per offending link, with the link it is about.
 */
function linkFindings(
  config: InwardsConfig,
  { links, modules, shownRoot }: LinkTree,
): { finding: Diagnostic; link: LayerLink }[] {
  const evidence = moduleEvidence(modules);
  const sorted = [...links].sort((a, b) => a.path.localeCompare(b.path));
  return sorted.flatMap((link) => {
    const finding = judge(config, link, { evidence, shownRoot });
    return finding === undefined ? [] : [{ finding, link }];
  });
}

/**
 * Decides whether one link hides code, see `checkLinks`.
 *
 * @param config - the layers.
 * @param link - the link, root-relative.
 * @param context - the selector evidence and the shown root.
 * @param context.evidence - tells whether a package holds a selector's match.
 * @param context.shownRoot - the config root as report paths show it.
 * @returns the finding, or undefined when the link is fine.
 */
function judge(
  config: InwardsConfig,
  link: LayerLink,
  { evidence, shownRoot }: { evidence: Evidence; shownRoot: string },
): Diagnostic | undefined {
  const { layers } = config;
  const alias = moduleNameFor(link.path);
  const owner = layerMembership(alias.module, layers);
  const shown = [shownRoot, link.path].filter(Boolean).join("/");
  const file: SourceFile = {
    path: shown,
    module: alias.module,
    isPackage: alias.isPackage,
    text: "",
  };
  if (link.target === undefined) {
    // Above the layers, only a link out of the root hides code: in the root,
    // the walk names the code behind it by the link, which the layers then own.
    // A name `import` can't spell (`static-assets`) holds no slice there.
    const importable = alias.module.split(".").every((segment) => IDENTIFIER.test(segment));
    return owner !== undefined || (importable && mayHoldLayer(alias.module, layers))
      ? outOfRoot(config, file, owner?.layer.name)
      : undefined;
  }
  if (owner === undefined) {
    return undefined; // an import through it gets INW006 at the import
  }
  const target = moduleNameFor(link.target).module;
  const into = layerMembership(target, layers);
  const unassigned =
    into === undefined &&
    target !== "" &&
    link.holdsLayers !== true &&
    !holdsLayer(target, layers, evidence);
  if (into?.index === owner.index || unassigned) {
    return undefined; // same layer, or outside every layer: checked under the link's name
  }
  const where = into === undefined ? "which holds layers" : `in layer "${into.layer.name}"`;
  const real = target === "" ? "the config root" : `"${target}"`;
  return diagnostic(RULES.INW006, file, {
    span: FIRST_LINE,
    message: `${shown} is a symlink to ${real}, ${where}: an import of "${alias.module}" (layer "${owner.layer.name}") loads that code, and no layer rule sees the dependency.`,
    fix: {
      summary: `Remove the link ${shown} and import the code by its real name.`,
      steps: [
        `Delete ${shown} and import ${real} directly, so the layer rules check the dependency.`,
        `If layer "${owner.layer.name}" really needs that code, move it into the layer or ask the user.`,
      ],
    },
  });
}

/**
 * Words a link out of the root: nothing reads the code behind it.
 *
 * @param config - the config, for its root.
 * @param file - the link as a report location, with its module name.
 * @param layer - the layer that owns the link, or undefined above the layers.
 * @returns the finding.
 */
function outOfRoot(config: InwardsConfig, file: SourceFile, layer: string | undefined): Diagnostic {
  const name =
    layer === undefined
      ? `"${file.module}", where layer entries can match`
      : `"${file.module}" (layer "${layer}")`;
  const into = layer === undefined ? "under a layer" : `into layer "${layer}"`;
  return diagnostic(RULES.INW006, file, {
    span: FIRST_LINE,
    message: `${file.path} is a symlink out of root "${config.root}": Python imports the code behind it as ${name}, but no rule reads it.`,
    fix: {
      summary: `Remove the link ${file.path}, or ask the user where that code belongs.`,
      steps: [
        `Move the code under root "${config.root}" ${into}, install it as a package, or give it its own [tool.inwards] (a uv workspace member), instead of linking it there.`,
        "If it must stay a link, ask the user; don't change [tool.inwards] yourself.",
      ],
    },
  });
}

/**
 * Tells whether a module that no layer owns could hold layer code below it:
 * `shop` above `shop.domain`, or `shop.payments` under `shop.*.domain`.
 *
 * @param module - a dotted module name owned by no layer.
 * @param layers - the configured layers.
 * @returns true when some layer entry could match a module below it.
 */
function mayHoldLayer(module: string, layers: readonly LayerSpec[]): boolean {
  const segments = module.split(".");
  return layers.some((layer) =>
    layer.modules.some((entry) => entryReach(entry, segments) === "descend"),
  );
}

/**
 * Keys a finding by its place, message and real target, to compare the
 * start with now: a link moved from one outside directory to another says
 * the same thing, but hides other code.
 *
 * @param found - a finding and its link.
 * @param found.finding - the diagnostic reported for the link.
 * @param found.link - the link it is about, for its real target.
 * @returns the file, message and real target joined.
 */
function keyOf({ finding, link }: { finding: Diagnostic; link: LayerLink }): string {
  return `${finding.file}\u0000${finding.message}\u0000${link.real}`;
}
