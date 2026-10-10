/**
 * @file What `where_should_this_go` answers, once the checks have run: the
 * layers with what each may import, the contexts, the choice among the
 * candidates (the named module, the innermost layer whose imports pass, or
 * the layer the description points to), and the Markdown the model reads.
 * Pure: the verdicts come in from `where.ts`, which runs the checks.
 */
import type { ContextSpec, LayerSpec } from "@inwards/core";

/** A layer as the answer lists it. */
export interface LayerView {
  name: string;
  modules: string[];
  /** The layers it may import: itself and those of a lower rank. */
  mayImport: string[];
}

/** An import the check refused, with the rule and its message. */
export interface Blocked {
  import: string;
  code: string;
  message: string;
}

/** One place the code could go, and what the check said about its imports there. */
export interface Candidate {
  layer: string;
  module: string;
  /** The file, relative to the working directory. */
  file: string;
  /** The imports refused there; empty when every import passes. */
  blocked: Blocked[];
}

/** What the tool chose, and on what. */
export interface Suggestion {
  layer: string | undefined;
  module: string;
  file: string;
  /** What the choice rests on: the module named, the imports, or the description. */
  basis: "module" | "imports" | "description";
}

/**
 * Lists the layers with what each may import.
 *
 * @param layers - the configured layers, innermost first.
 * @returns each layer's name, modules and the layers it may import.
 */
export function layerViews(layers: readonly LayerSpec[]): LayerView[] {
  return layers.map((layer, i) => {
    const rank = layer.rank ?? i;
    const mayImport = layers
      .filter((other, j) => other === layer || (other.rank ?? j) < rank)
      .map((other) => other.name);
    return { name: layer.name, modules: layer.modules, mayImport };
  });
}

/**
 * Picks the candidate to suggest: among those whose imports all pass, the
 * one in the layer the description points to, else the innermost.
 *
 * @param candidates - the candidates, innermost first.
 * @param hinted - the layer the description points to, if any.
 * @returns the candidate, or undefined when the imports pass nowhere.
 */
function bestOf(
  candidates: readonly Candidate[],
  hinted: string | undefined,
): Candidate | undefined {
  const clean = candidates.filter((c) => c.blocked.length === 0);
  return clean.find((c) => c.layer === hinted) ?? clean[0];
}

/**
 * Words a context for the answer.
 *
 * @param context - a bounded context from the config.
 * @returns its name, modules, public modules and dependencies.
 */
export function contextView(context: ContextSpec): Record<string, unknown> {
  return {
    name: context.name,
    modules: context.modules,
    public: context.public,
    dependsOn: context.dependsOn,
  };
}

/** The module the agent named, as the answer reports it. */
export interface Named {
  module: string;
  file: string;
  layer: string | undefined;
  context: string | undefined;
  blocked: Blocked[];
}

/**
 * Turns a candidate into the suggestion.
 *
 * @param candidate - the chosen layer's new module.
 * @param basis - what the choice rests on.
 * @returns its layer, module and file, with the basis.
 */
function placed(candidate: Candidate, basis: Suggestion["basis"]): Suggestion {
  return { layer: candidate.layer, module: candidate.module, file: candidate.file, basis };
}

/**
 * Chooses the suggestion: the named module when its imports pass, else the
 * best candidate when there are imports, else the layer the description
 * points to.
 *
 * @param named - the module the agent named, judged.
 * @param candidates - one per layer.
 * @param hinted - the layer the description points to.
 * @param imports - whether any imports were given.
 * @returns the suggestion, or undefined when there is nothing to go on.
 */
export function suggest(
  named: Named | undefined,
  candidates: readonly Candidate[],
  hinted: string | undefined,
  imports: boolean,
): Suggestion | undefined {
  if (named !== undefined && named.blocked.length === 0) {
    return { layer: named.layer, module: named.module, file: named.file, basis: "module" };
  }
  if (imports) {
    const best = bestOf(candidates, hinted);
    const basis = best?.layer === hinted ? "description" : "imports";
    return best === undefined ? undefined : placed(best, basis);
  }
  const hint = candidates.find((c) => c.layer === hinted);
  return hint === undefined ? undefined : placed(hint, "description");
}

/**
 * Writes the answer for the model: the suggestion and why, what the named
 * module's imports ran into, and the layers.
 *
 * @param views - the layers.
 * @param named - the module the agent named, judged.
 * @param candidates - one per layer.
 * @param suggestion - the choice.
 * @returns Markdown.
 */
export function prose(
  views: readonly LayerView[],
  named: Named | undefined,
  candidates: readonly Candidate[],
  suggestion: Suggestion | undefined,
): string {
  const lines: string[] = [];
  if (suggestion === undefined) {
    lines.push(
      "No suggestion: pass the imports the code needs, or a module, or a description that names a layer.",
    );
  } else {
    const where = suggestion.layer === undefined ? "no layer" : `layer "${suggestion.layer}"`;
    lines.push(
      `Suggested: \`${suggestion.module}\` (${suggestion.file}), in ${where}, based on the ${suggestion.basis}.`,
    );
  }
  if (named !== undefined && named.blocked.length > 0) {
    lines.push("", `In \`${named.module}\` these imports are refused:`);
    lines.push(...named.blocked.map((b) => `- \`${b.import}\`: ${b.code} ${b.message}`));
  }
  const refused = candidates.filter((c) => c.blocked.length > 0);
  if (refused.length > 0) {
    lines.push("", "Layers that refuse some import:");
    lines.push(
      ...refused.map(
        (c) => `- ${c.layer}: ${c.blocked.map((b) => `\`${b.import}\` (${b.code})`).join(", ")}`,
      ),
    );
  }
  lines.push("", "Layers, innermost first:");
  lines.push(
    ...views.map(
      (v) => `- ${v.name} (${v.modules.join(", ")}): may import ${v.mayImport.join(", ")}`,
    ),
  );
  return lines.join("\n");
}
