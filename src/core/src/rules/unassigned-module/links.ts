/**
 * @file INW006 for symlinks inside a layer: a link whose real target lies
 * outside the config root, in another layer, or above other layers. Python
 * imports through a link under the link's name, so its code is checked by
 * that name; but a target outside the root is never read (ADR-013), and a
 * target in another layer makes `shop.domain.alias.db` infrastructure code
 * that INW001 takes for domain code (#83, #84).
 *
 * Pure over what the adapter found: it walks the layer packages, resolves
 * each link and names both ends relative to the config root. A link into a
 * package outside every layer is fine: its code is checked under the link's
 * name, and INW006 already warns about the package itself.
 */
import type { InwardsConfig } from "../../config/parse.ts";
import { applyRules } from "../../config/rule-settings.ts";
import type { Diagnostic, SourceFile, Span } from "../../contracts/records.ts";
import { diagnostic, RULES } from "../../meta/registry.ts";
import { moduleNameFor } from "../../python/module-names.ts";
import { layerMembership } from "../shared/layer-ownership.ts";
import { holdsLayer, moduleEvidence } from "./imports.ts";

/** A symlink inside a layer package, as the adapter found it. */
export interface LayerLink {
  /** The link, relative to the config root, with forward slashes. */
  path: string;
  /**
   * Its real target, relative to the real config root with forward slashes
   * (`""` for the root itself), or undefined when the target lies outside the root.
   */
  target: string | undefined;
}

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
    return applyRules(found, config.rules);
  }
  const had = new Set(linkFindings(config, before).map(keyOf));
  return found.filter((d) => !had.has(keyOf(d)));
}

/**
 * Finds the offending links, before `[tool.inwards.rules]`.
 *
 * @param config - the layers.
 * @param tree - what to judge.
 * @param tree.links - the links, root-relative.
 * @param tree.modules - every first-party module, the evidence for selectors.
 * @param tree.shownRoot - the config root as report paths show it.
 * @returns one error per offending link.
 */
function linkFindings(
  config: InwardsConfig,
  { links, modules, shownRoot }: LinkTree,
): Diagnostic[] {
  const { layers } = config;
  const evidence = moduleEvidence(modules);
  const sorted = [...links].sort((a, b) => a.path.localeCompare(b.path));
  return sorted.flatMap((link) => {
    const alias = moduleNameFor(link.path);
    const owner = layerMembership(alias.module, layers);
    if (owner === undefined) {
      return []; // not in a layer: an import through it gets INW006 at the import
    }
    const shown = [shownRoot, link.path].filter(Boolean).join("/");
    const file: SourceFile = {
      path: shown,
      module: alias.module,
      isPackage: alias.isPackage,
      text: "",
    };
    const name = `"${alias.module}" (layer "${owner.layer.name}")`;
    if (link.target === undefined) {
      return [
        diagnostic(RULES.INW006, file, {
          span: FIRST_LINE,
          message: `${shown} is a symlink out of root "${config.root}": Python imports the code behind it as ${name}, but no rule reads it.`,
          fix: {
            summary: `Remove the link ${shown}, or ask the user where that code belongs.`,
            steps: [
              `Move the code under root "${config.root}" into layer "${owner.layer.name}", install it as a package, or give it its own [tool.inwards] (a uv workspace member), instead of linking it into the layer.`,
              "If it must stay a link, ask the user; don't change [tool.inwards] yourself.",
            ],
          },
        }),
      ];
    }
    const target = moduleNameFor(link.target).module;
    const into = layerMembership(target, layers);
    if (into?.index === owner.index) {
      return [];
    }
    if (into === undefined && target !== "" && !holdsLayer(target, layers, evidence)) {
      return []; // outside every layer: checked under the link's name
    }
    const where = into === undefined ? "which holds layers" : `in layer "${into.layer.name}"`;
    const real = target === "" ? "the config root" : `"${target}"`;
    return [
      diagnostic(RULES.INW006, file, {
        span: FIRST_LINE,
        message: `${shown} is a symlink to ${real}, ${where}: an import of ${name} loads that code, and no layer rule sees the dependency.`,
        fix: {
          summary: `Remove the link ${shown} and import the code by its real name.`,
          steps: [
            `Delete ${shown} and import ${real} directly, so the layer rules check the dependency.`,
            `If layer "${owner.layer.name}" really needs that code, move it into the layer or ask the user.`,
          ],
        },
      }),
    ];
  });
}

/**
 * Keys a finding by its place and message, to compare the start with now.
 *
 * @param d - a finding.
 * @returns the file and message joined.
 */
function keyOf(d: Diagnostic): string {
  return `${d.file}\u0000${d.message}`;
}
