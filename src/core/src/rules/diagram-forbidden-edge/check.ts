/**
 * @file INW018 diagram-forbidden-edge (#345, ADR-045): a solid arrow in a
 * marked architecture diagram that draws an import `[tool.inwards]` forbids,
 * so the picture in the docs shows a dependency the checks would reject.
 *
 * In a `layers` diagram an arrow is forbidden when it points outward (from an
 * inner layer to an outer one) or between two sibling layers of one rank. In
 * a `contexts` diagram an arrow from one context to another is forbidden when
 * the first doesn't list the second in `depends-on`, and, when it does, when
 * it points at a node inside the second whose quoted label isn't one of its
 * `public` modules. Only one-way solid or thick arrows mean "may import";
 * dotted links, open links and `:::external` nodes are left alone, and so is
 * a node that names nothing declared (INW017 reports it). Each forbidden pair
 * is reported once per diagram, at its first arrow. No I/O.
 */
import { type ContextSpec, isPublicModule, publicModule } from "../../config/contexts.ts";
import type { LayerSpec } from "../../config/layers.ts";
import type { InwardsConfig } from "../../config/parse.ts";
import { applyRules } from "../../config/rule-settings.ts";
import type { Diagnostic, Fix, Span } from "../../contracts/records.ts";
import type { Diagram, DiagramEdge } from "../../diagram/model.ts";
import {
  diagramFile,
  EXTERNAL,
  idsWithClass,
  quotedLabel,
  resolveName,
  topLevel,
} from "../../diagram/names.ts";
import { diagnostic, RULES } from "../../meta/registry.ts";
import { joined } from "../shared/words.ts";

/** The step every fix ends with: the config is the user's. */
const ASK_USER =
  "If the code really needs this import, ask the user whether [tool.inwards] should allow it; don't edit [tool.inwards] yourself.";
/** The step for an arrow that stands for something other than an import. */
const DOTTED =
  "If the arrow shows a call at run time or a flow of data rather than an import, draw it dotted (-.->), which INW018 doesn't read.";

/** Why an arrow is forbidden, before it becomes a diagnostic. */
interface Breach {
  /** What the arrow draws, for the dedup key. */
  key: string;
  /** The end of the message after "forbids: ". */
  reason: string;
  fix: Fix;
}

/**
 * Checks the arrows of marked diagrams against the layer order, `depends-on`
 * and `public`.
 *
 * @param config - the layers, contexts and `[tool.inwards.rules]`.
 * @param diagrams - the marked diagrams the `diagrams` files hold.
 * @returns one finding per forbidden pair per diagram, at its first arrow,
 *   in line order, after `[tool.inwards.rules]`.
 */
export function checkDiagramEdges(
  config: InwardsConfig,
  diagrams: readonly Diagram[],
): Diagnostic[] {
  const found = diagrams.flatMap((diagram) => {
    const external = idsWithClass(diagram, EXTERNAL);
    const seen = new Set<string>();
    const findings: Diagnostic[] = [];
    for (const edge of diagram.edges) {
      if (
        !edge.mayImport ||
        edge.from === edge.to ||
        external.has(edge.from) ||
        external.has(edge.to)
      ) {
        continue;
      }
      const breach =
        diagram.kind === "layers"
          ? layerBreach(diagram, edge, config.layers)
          : contextBreach(diagram, edge, config.contexts ?? []);
      if (breach === undefined || seen.has(breach.key)) {
        continue;
      }
      seen.add(breach.key);
      findings.push(
        diagnostic(RULES.INW018, diagramFile(diagram), {
          span: edgeSpan(diagram, edge),
          message: `"${edge.from} ${edge.link} ${edge.to}" draws an import [tool.inwards] forbids: ${breach.reason}`,
          fix: breach.fix,
        }),
      );
    }
    return findings;
  });
  return applyRules(found, config.rules);
}

/**
 * Judges an arrow of a layers diagram: it may point only at a layer of a
 * lower rank.
 *
 * @param diagram - the layers diagram.
 * @param edge - a "may import" arrow.
 * @param layers - the configured layers, innermost first.
 * @returns why it is forbidden, or undefined when it is allowed or names no two layers.
 */
function layerBreach(
  diagram: Diagram,
  edge: DiagramEdge,
  layers: readonly LayerSpec[],
): Breach | undefined {
  const from = resolveName(edge.from, quotedLabel(diagram, edge.from), layers);
  const to = resolveName(edge.to, quotedLabel(diagram, edge.to), layers);
  if (from === undefined || to === undefined || from === to) {
    return undefined;
  }
  const fromRank = from.rank ?? layers.indexOf(from);
  const toRank = to.rank ?? layers.indexOf(to);
  if (toRank < fromRank) {
    return undefined;
  }
  const key = `${from.name}\0${to.name}`;
  if (toRank === fromRank) {
    return {
      key,
      reason: `"${from.name}" and "${to.name}" are sibling layers, which may not import each other.`,
      fix: {
        summary: "Remove the arrow: sibling layers don't import each other.",
        steps: [
          "If the code imports this way, the import is the problem; INW001 reports it in the code.",
          DOTTED,
          ASK_USER,
        ],
      },
    };
  }
  return {
    key,
    reason: `"${from.name}" is inner to "${to.name}", and an inner layer may not import an outer one.`,
    fix: {
      summary: `Turn the arrow around or remove it: "${edge.to} ${edge.link} ${edge.from}" is the direction [tool.inwards] allows.`,
      steps: [
        "Arrows point from the importing layer to the imported one, so they point inward.",
        DOTTED,
        ASK_USER,
      ],
    },
  };
}

/**
 * Judges an arrow of a contexts diagram that crosses from one context to
 * another: the first must list the second in `depends-on`, and a node it
 * points at inside the second must be one of its public modules.
 *
 * @param diagram - the contexts diagram.
 * @param edge - a "may import" arrow.
 * @param contexts - the configured contexts.
 * @returns why it is forbidden, or undefined when it is allowed or names no two contexts.
 */
function contextBreach(
  diagram: Diagram,
  edge: DiagramEdge,
  contexts: readonly ContextSpec[],
): Breach | undefined {
  const fromTop = topLevel(diagram, edge.from);
  const toTop = topLevel(diagram, edge.to);
  const from = resolveName(fromTop, quotedLabel(diagram, fromTop), contexts);
  const to = resolveName(toTop, quotedLabel(diagram, toTop), contexts);
  if (from === undefined || to === undefined || from === to) {
    return undefined;
  }
  if (!from.dependsOn.includes(to.name)) {
    return {
      key: `${from.name}\0${to.name}`,
      reason: `context "${from.name}" doesn't list "${to.name}" in depends-on.`,
      fix: {
        summary: `Remove the arrow, or ask the user to add "${to.name}" to the depends-on of "${from.name}".`,
        steps: [
          "If the code imports this way, the import is the problem; INW002 reports it in the code.",
          DOTTED,
          ASK_USER,
        ],
      },
    };
  }
  const target = toTop === edge.to ? undefined : quotedLabel(diagram, edge.to);
  if (target === undefined || isPublicModule(to, target)) {
    return undefined;
  }
  return {
    key: `${from.name}\0${to.name}\0${target}`,
    reason: `"${target}" isn't one of the public modules of context "${to.name}".`,
    fix: publicFix(to),
  };
}

/**
 * Writes the fix for an arrow into a module that isn't public.
 *
 * @param context - the context the arrow points into.
 * @returns the summary and steps, naming its public modules.
 */
function publicFix(context: ContextSpec): Fix {
  const listed = joined(context.public.map((entry) => `"${publicModule(entry)}"`));
  return {
    summary:
      context.public.length === 0
        ? `"${context.name}" declares no public modules; remove the arrow or ask the user which of its modules other contexts may import.`
        : `Point the arrow at a public module of "${context.name}": ${listed}.`,
    steps: [
      "Code in another context imports only the public modules (INW003 reports it in the code).",
      DOTTED,
      ASK_USER,
    ],
  };
}

/**
 * Finds where an arrow is written: from its first node's id to its last
 * node's id on the arrow's line.
 *
 * @param diagram - the diagram the arrow is in.
 * @param edge - the arrow.
 * @returns the span on the arrow's line; the whole line when the ids can't be found.
 */
function edgeSpan(diagram: Diagram, edge: DiagramEdge): Span {
  const onLine = diagram.nodes.filter((n) => n.line === edge.line);
  const from = onLine.find((n) => n.id === edge.from);
  const to = onLine.findLast((n) => n.id === edge.to);
  const column = from?.column ?? 1;
  return {
    line: edge.line,
    column,
    endLine: edge.line,
    endColumn: Math.max(to?.endColumn ?? column + 1, column + 1),
  };
}
