/**
 * @file INW017 diagram-unknown-name (#344, ADR-045): a node in a marked
 * architecture diagram that names a layer or context `[tool.inwards]` doesn't
 * declare, or whose quoted label names no module that exists, so the picture
 * in the docs has drifted from the config or the code. Each finding sits on
 * the diagram's own line. A `diagrams` entry that matches no file is
 * reported on the entry in pyproject.toml.
 *
 * In a `layers` diagram every node id is a layer name. In a `contexts`
 * diagram every top-level subgraph and every node outside a subgraph is a
 * context name, and the nodes inside a subgraph are free ids. A node with
 * the class `external` is skipped, and so is a node id that is a subgraph's
 * (a link to the subgraph). Edges are INW018's and INW019's (#345). No I/O:
 * the adapter reads the files and the engine reads the diagrams.
 */

import { isSelector, selectorProblem } from "../../config/layer-selector.ts";
import type { InwardsConfig } from "../../config/parse.ts";
import { applyRules } from "../../config/rule-settings.ts";
import { type ConfigFile, spanOf } from "../../config/source-span.ts";
import { isDottedName } from "../../config/toml.ts";
import type { Diagnostic, Fix, SourceFile } from "../../contracts/records.ts";
import type { Diagram, NodeMention, SubgraphMention } from "../../diagram/model.ts";
import {
  type Declared,
  diagramFile,
  EXTERNAL,
  idsWithClass,
  mentionSpan,
  quotedLabel,
  resolveName,
  topLevel,
} from "../../diagram/names.ts";
import { diagnostic, RULES } from "../../meta/registry.ts";
import { distance } from "../shared/edit-distance.ts";
import { matchesAny } from "../shared/entry-matches.ts";
import { joined } from "../shared/words.ts";

/** A name this many times longer than its distance to a declared one is a typo of it. */
const TYPO_SHARE = 3;
/** The step every fix ends with: the config is the user's. */
const ASK_USER =
  "If the diagram is right and [tool.inwards] is missing it, ask the user; don't edit [tool.inwards] yourself.";

/** What INW017 checks a project's diagrams against. */
export interface DiagramNames {
  config: InwardsConfig;
  /** Every first-party module of the project. */
  modules: ReadonlySet<string>;
  diagrams: readonly Diagram[];
}

/**
 * Checks the names in marked diagrams against the config and the modules.
 *
 * @param input - what to check, and against what.
 * @param input.config - the layers, contexts and `[tool.inwards.rules]`.
 * @param input.modules - every first-party module of the project.
 * @param input.diagrams - the marked diagrams the `diagrams` files hold.
 * @returns one finding per unknown name per diagram, at its first mention,
 *   in line order, after `[tool.inwards.rules]`.
 */
export function checkDiagramNames({ config, modules, diagrams }: DiagramNames): Diagnostic[] {
  const found = diagrams.flatMap((diagram) => {
    const names = declaredNames(config, diagram);
    return [
      ...unknownNodes(diagram, names),
      ...unknownSubgraphs(diagram, names),
      ...unknownLabels(diagram, modules),
    ].sort((a, b) => a.line - b.line || a.column - b.column);
  });
  return applyRules(found, config.rules);
}

/**
 * Reports the `diagrams` entries that matched no file, on the entry in
 * pyproject.toml: a typo there leaves the diagram it meant unchecked.
 *
 * @param config - the config, for `[tool.inwards.rules]`.
 * @param unmatched - the entries no file matched.
 * @param file - the pyproject.toml.
 * @returns one finding per entry.
 */
export function checkDiagramEntries(
  config: InwardsConfig,
  unmatched: readonly string[],
  file: ConfigFile,
): Diagnostic[] {
  const source: SourceFile = { path: file.path, module: "", isPackage: false, text: file.text };
  const found = unmatched.map((entry) =>
    diagnostic(RULES.INW017, source, {
      span: spanOf(file.text, entry),
      message: `diagrams entry "${entry}" matches no file, so no diagram is checked for it.`,
      fix: {
        summary: `Ask the user to fix or remove "${entry}" in [tool.inwards].diagrams.`,
        steps: [
          "Check the path for a typo: it is relative to the pyproject.toml, and a glob needs ** to reach into subdirectories.",
          "Don't edit [tool.inwards] yourself; tell the user.",
        ],
      },
    }),
  );
  return applyRules(found, config.rules);
}

/** The names a diagram's nodes may use, and what they are called in messages. */
interface Names {
  declared: readonly Declared[];
  /** "layer" or "context". */
  noun: string;
}

/**
 * Lists the names a diagram may use: the layers for a `layers` diagram, the
 * contexts for a `contexts` one.
 *
 * @param config - the layers and contexts to take the names from.
 * @param diagram - the diagram, for its kind.
 * @returns the names and their noun.
 */
function declaredNames(config: InwardsConfig, diagram: Diagram): Names {
  return diagram.kind === "layers"
    ? { declared: config.layers, noun: "layer" }
    : { declared: config.contexts ?? [], noun: "context" };
}

/**
 * Finds the nodes whose id must be a declared name and isn't: every node of
 * a `layers` diagram, the top-level nodes of a `contexts` one.
 *
 * @param diagram - a marked diagram, read.
 * @param names - what the ids may be.
 * @returns one finding per unknown id, at its first mention.
 */
function unknownNodes(diagram: Diagram, names: Names): Diagnostic[] {
  const subgraphs = new Set(diagram.subgraphs.map((s) => s.id));
  const external = idsWithClass(diagram, EXTERNAL);
  const first = new Map<string, NodeMention>();
  for (const node of diagram.nodes) {
    if (!first.has(node.id)) {
      first.set(node.id, node);
    }
  }
  return [...first.values()]
    .filter(
      (node) =>
        !(subgraphs.has(node.id) || external.has(node.id) || isDeclared(diagram, node.id, names)) &&
        (diagram.kind === "layers" || topLevel(diagram, node.id) === node.id),
    )
    .map((node) => nameFinding(diagram, node, names, "node"));
}

/**
 * Finds the top-level subgraphs of a `contexts` diagram that name no context.
 *
 * @param diagram - a marked diagram, read.
 * @param names - the contexts.
 * @returns one finding per unknown subgraph.
 */
function unknownSubgraphs(diagram: Diagram, names: Names): Diagnostic[] {
  if (diagram.kind !== "contexts") {
    return [];
  }
  const external = idsWithClass(diagram, EXTERNAL);
  return diagram.subgraphs
    .filter(
      (s) => s.parent === undefined && !external.has(s.id) && !isDeclared(diagram, s.id, names),
    )
    .map((s) => nameFinding(diagram, s, names, "subgraph"));
}

/**
 * Tells whether a node or subgraph names a declared layer or context, by its
 * id or, for a name that can't be an id, by its quoted label.
 *
 * @param diagram - a marked diagram, read.
 * @param id - the node or subgraph id.
 * @param names - the layers or contexts.
 * @returns true when it names one.
 */
function isDeclared(diagram: Diagram, id: string, names: Names): boolean {
  return resolveName(id, quotedLabel(diagram, id), names.declared) !== undefined;
}

/**
 * Finds the quoted labels that look like module names and match no module.
 * A label that isn't a dotted name or a selector (a caption with spaces) is
 * left alone.
 *
 * @param diagram - a marked diagram, read.
 * @param modules - every first-party module.
 * @returns one finding per node and label, at its first mention.
 */
function unknownLabels(diagram: Diagram, modules: ReadonlySet<string>): Diagnostic[] {
  const external = idsWithClass(diagram, EXTERNAL);
  const seen = new Set<string>();
  const found: Diagnostic[] = [];
  for (const node of [...diagram.nodes, ...diagram.subgraphs]) {
    const label = node.label?.quoted === true ? node.label.text : undefined;
    const key = `${node.id}\0${label ?? ""}`;
    if (label === undefined || seen.has(key) || external.has(node.id) || !isModuleName(label)) {
      continue;
    }
    seen.add(key);
    if (!matchesAny(label, modules)) {
      found.push(
        diagnostic(RULES.INW017, diagramFile(diagram), {
          span: mentionSpan(node),
          message: `"${node.id}" is labelled "${label}" in this ${diagram.kind} diagram, and no module matches "${label}".`,
          fix: labelFix(label, modules),
        }),
      );
    }
  }
  return found;
}

/**
 * Builds the finding for a node or subgraph id that names nothing declared.
 *
 * @param diagram - a marked diagram, read.
 * @param named - the node or subgraph, at its first mention.
 * @param names - what the id may be.
 * @param what - "node" or "subgraph", for the message.
 * @returns the INW017 warning, on the id's first mention.
 */
function nameFinding(
  diagram: Diagram,
  named: NodeMention | SubgraphMention,
  names: Names,
  what: string,
): Diagnostic {
  const { declared, noun } = names;
  const listed =
    declared.length === 0
      ? `[tool.inwards] declares no ${noun}s`
      : `the ${noun}s are ${joined(declared.map(({ name }) => `"${name}"`))}`;
  const near = nearest(
    named.id,
    declared.map(({ name }) => name),
  );
  const rename =
    near === undefined
      ? `Rename the ${what} to the ${noun} it shows.`
      : `Rename the ${what} to "${near}", the ${noun} it most likely means.`;
  return diagnostic(RULES.INW017, diagramFile(diagram), {
    span: mentionSpan(named),
    message: `${what === "node" ? "Node" : "Subgraph"} "${named.id}" in this ${diagram.kind} diagram names no ${noun}: ${listed}.`,
    fix: {
      summary:
        near === undefined
          ? `Rename "${named.id}" or mark it :::external.`
          : `Rename "${named.id}" to "${near}".`,
      steps: [
        rename,
        `If it stands for something outside [tool.inwards] (a database, a third-party service), mark it ${named.id}:::${EXTERNAL}.`,
        ASK_USER,
      ],
    },
  });
}

/**
 * Writes the fix for a label that matches no module.
 *
 * @param label - the quoted label.
 * @param modules - every first-party module; the closest of their prefixes is suggested.
 * @returns the summary and steps.
 */
function labelFix(label: string, modules: ReadonlySet<string>): Fix {
  const prefixes = new Set<string>();
  for (const module of modules) {
    const parts = module.split(".");
    for (let i = 1; i <= parts.length; i += 1) {
      prefixes.add(parts.slice(0, i).join("."));
    }
  }
  const near = nearest(label, [...prefixes]);
  return {
    summary: near === undefined ? `Fix the label "${label}".` : `Change the label to "${near}".`,
    steps: [
      near === undefined
        ? "Use the module prefix the node stands for, as [tool.inwards] spells it, or drop the quotes to make the label a caption."
        : `"${near}" exists; if that is the module meant, use it.`,
      "If the module was moved or renamed, update the diagram to match the code.",
      ASK_USER,
    ],
  };
}

/**
 * Tells whether a label is written like a module prefix or a layer selector.
 *
 * @param label - the quoted label.
 * @returns true for `shop.domain` or `shop.*.domain`, false for a caption.
 */
function isModuleName(label: string): boolean {
  return isSelector(label) ? selectorProblem(label) === undefined : isDottedName(label);
}

/**
 * Picks the declared name closest to a misspelt one, when it is close enough
 * to be a typo: at most a third of its length away, and at least one edit.
 *
 * @param name - the unknown name.
 * @param candidates - the names it may have meant.
 * @returns the closest candidate, or undefined when none is close.
 */
function nearest(name: string, candidates: readonly string[]): string | undefined {
  const limit = Math.max(1, Math.floor(name.length / TYPO_SHARE));
  let best: { name: string; d: number } | undefined;
  for (const candidate of candidates) {
    const d = distance(name, candidate);
    if (d <= limit && (best === undefined || d < best.d)) {
      best = { name: candidate, d };
    }
  }
  return best?.name;
}
