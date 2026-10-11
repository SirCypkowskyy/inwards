/**
 * @file Writes `[tool.inwards]` as a marked Mermaid flowchart or PlantUML
 * component diagram (`inwards diagram`, #349), the reverse of `draft.ts`: a
 * layers diagram with one node per layer and an arrow from each layer to
 * every layer one rank further in, so the longest path to a sink gives each
 * layer its rank back and same-rank layers stay siblings; a contexts diagram
 * with one node per context, a group holding its `public` modules as
 * `public` nodes, and an arrow per `depends-on`. INW017 and INW018 accept
 * the result against the same config, and `inwards import-diagram` reads it
 * back.
 *
 * A name that can be a node id is the id; any other name (a template's
 * `slices.domain`) gets a made-up id and is named by its first module as a
 * quoted label, the rule `names.ts` resolves (ADR-045). What a diagram can't
 * show comes back as notes. Pure: it takes the layers and contexts as plain
 * records and never reads the config itself.
 */
import type { MarkedBlock } from "./blocks.ts";
import { readFlowchart } from "./mermaid.ts";
import type { DiagramKind, DiagramNotation } from "./model.ts";
import { PUBLIC } from "./names.ts";
import { notationOf } from "./notation.ts";
import { readPlantUml } from "./plantuml.ts";
import { ID } from "./syntax.ts";

/** A layer as the writer needs it: `LayerSpec` fits. */
interface DiagramLayerInput {
  name: string;
  modules: readonly string[];
  /** The layer's place among siblings; absent, its index is its rank. */
  rank?: number | undefined;
}

/** A context as the writer needs it: `ContextSpec` fits. */
interface DiagramContextInput {
  name: string;
  modules: readonly string[];
  public: readonly string[];
  dependsOn: readonly string[];
}

/** What `writeDiagram` draws: the layers and contexts of one config. */
interface DiagramConfigInput {
  layers: readonly DiagramLayerInput[];
  contexts?: readonly DiagramContextInput[] | undefined;
}

/** A written diagram, and what it leaves out. */
export interface DiagramExport {
  /** The diagram, marked, ending with a line break. */
  text: string;
  /** What the diagram couldn't show, one sentence each. */
  notes: string[];
}

/** A PlantUML name written bare: letters, digits and `_` (`plantuml-syntax.ts`). */
const PLANTUML_NAME = /^[\p{L}\p{N}_]+$/u;
/** Ends a subgraph in Mermaid, so a node named `end` breaks the drawing (Mermaid's flowchart docs). */
const MERMAID_END = "end";
/** Anything that can't be part of a node id. */
const NOT_ID = /[^\p{L}\p{N}_]+/gu;
/** Underscores at either end of a made-up id. */
const EDGE_UNDERSCORES = /^_+|_+$/gu;
/** The indent of a statement, and of one inside a group. */
const INDENT = "  ";

/** How a layer or context is written in the diagram. */
interface Named {
  /** The id a node or group is declared with. */
  id: string;
  /** How an arrow names it: the id, or `[name]` in PlantUML. */
  ref: string;
  /** True when the id isn't the name, so the first module must name it. */
  byLabel: boolean;
  /** PlantUML only: true when the name goes in brackets (it has a hyphen). */
  bracket: boolean;
}

/**
 * Writes the layers or the contexts of a config as a marked diagram.
 *
 * @param config - the layers, innermost first, and the contexts.
 * @param kind - `layers` or `contexts`.
 * @param notation - `mermaid` or `plantuml`.
 * @returns the diagram and what it leaves out.
 */
export function writeDiagram(
  config: DiagramConfigInput,
  kind: DiagramKind,
  notation: DiagramNotation,
): DiagramExport {
  const body =
    kind === "layers"
      ? layerBody(config.layers, notation)
      : contextBody(config.contexts ?? [], notation);
  const lines =
    notation === "mermaid"
      ? [`%% inwards: ${kind}`, kind === "layers" ? "flowchart TB" : "flowchart LR", ...body.lines]
      : ["@startuml", `' inwards: ${kind}`, ...body.lines, "@enduml"];
  return { text: `${lines.join("\n")}\n`, notes: body.notes };
}

/**
 * Writes the statements of a layers diagram: the nodes, outermost first and
 * siblings in config order, then
 * an arrow from each layer to every layer of the next rank in.
 *
 * @param layers - the layers, innermost first.
 * @param notation - the diagram's notation.
 * @returns the statement lines, indented, and the notes.
 */
function layerBody(
  layers: readonly DiagramLayerInput[],
  notation: DiagramNotation,
): { lines: string[]; notes: string[] } {
  const notes: string[] = [];
  const names = nameAll(layers, notation, new Set(), { noun: "Layer", notes });
  const lines: string[] = [];
  const outermostFirst = layers
    .map((layer, i) => ({ layer, rank: layer.rank ?? i }))
    .sort((a, b) => b.rank - a.rank)
    .map(({ layer }) => layer);
  for (const layer of outermostFirst) {
    const named = names.get(layer.name);
    if (named !== undefined) {
      lines.push(...declare(layer, named, { notation, noun: "Layer", notes }));
    }
  }
  const byRank: string[][] = [];
  layers.forEach((layer, i) => {
    const rank = layer.rank ?? i;
    const ref = names.get(layer.name)?.ref;
    if (ref !== undefined) {
      byRank[rank] = [...(byRank[rank] ?? []), ref];
    }
  });
  const places = byRank.filter((place) => place.length > 0);
  for (let rank = places.length - 1; rank > 0; rank -= 1) {
    lines.push(...arrows(places[rank] ?? [], places[rank - 1] ?? [], notation));
  }
  return { lines, notes };
}

/**
 * Writes the statements of a contexts diagram: each context as a node, or as
 * a group around its public modules, then an arrow per `depends-on`.
 *
 * @param contexts - the contexts, in config order.
 * @param notation - the diagram's notation.
 * @returns the statement lines, indented, and the notes.
 */
function contextBody(
  contexts: readonly DiagramContextInput[],
  notation: DiagramNotation,
): { lines: string[]; notes: string[] } {
  const taken = new Set(contexts.map((c) => c.name));
  const notes: string[] = [];
  const names = nameAll(contexts, notation, taken, { noun: "Context", notes });
  const lines: string[] = [];
  for (const context of contexts) {
    const named = names.get(context.name);
    if (named === undefined) {
      continue;
    }
    if (context.public.length === 0) {
      lines.push(...declare(context, named, { notation, noun: "Context", notes }));
      continue;
    }
    lines.push(...group(context, named, { notation, taken, notes }));
  }
  for (const context of contexts) {
    const from = names.get(context.name)?.ref;
    const to = context.dependsOn.flatMap((name) => names.get(name)?.ref ?? []);
    if (from !== undefined && to.length > 0) {
      lines.push(...arrows([from], to, notation));
    }
  }
  return { lines, notes };
}

/**
 * Gives every layer or context its id. A name that can be an id keeps it; any
 * other gets one made from it, kept apart from every name and id so far. In
 * PlantUML a name the reader would take for a keyword (`interface`,
 * `package`) or that has a hyphen goes in brackets; in Mermaid such a name
 * (`class`, `end`) has no way out, which a note says.
 *
 * @param entries - the layers or contexts.
 * @param notation - the diagram's notation, whose ids differ.
 * @param taken - names and ids already in use; updated in place.
 * @param report - where a name that can't be written is reported.
 * @param report.noun - "Layer" or "Context", for the note.
 * @param report.notes - the notes so far; updated in place.
 * @returns how each name is written, by name.
 */
function nameAll(
  entries: readonly { name: string }[],
  notation: DiagramNotation,
  taken: Set<string>,
  report: { noun: string; notes: string[] },
): Map<string, Named> {
  for (const { name } of entries) {
    taken.add(name);
  }
  const names = new Map<string, Named>();
  for (const { name } of entries) {
    if (ID.exec(name)?.[0] !== name) {
      const id = freshId(name, taken);
      names.set(name, { id, ref: id, byLabel: true, bracket: false });
      continue;
    }
    const bracket =
      notation === "plantuml" && !(PLANTUML_NAME.test(name) && readsAsNode(name, notation));
    if (notation === "mermaid" && !(readsAsNode(name, notation) && name !== MERMAID_END)) {
      report.notes.push(
        `${report.noun} "${name}" is a Mermaid keyword, so a node can't be named after it; rename it, or draw the diagram with --format plantuml.`,
      );
    }
    names.set(name, { id: name, ref: bracket ? `[${name}]` : name, byLabel: false, bracket });
  }
  return names;
}

/**
 * Tells whether the diagram reader takes a bare name for a node, by reading
 * a node and an arrow written with it: `class`, `style` (Mermaid) and
 * `interface`, `package` (PlantUML) start statements of their own.
 *
 * @param name - a name that can be an id.
 * @param notation - the reader to ask.
 * @returns true when the reader sees the node and the arrow.
 */
function readsAsNode(name: string, notation: DiagramNotation): boolean {
  const block: MarkedBlock = {
    kind: "layers",
    markerLine: 1,
    firstLine: 2,
    lines:
      notation === "mermaid"
        ? [`${name}["${name}"]`, `${name} --> ${name}`]
        : [`${name} --> ${name}`],
  };
  const read = notation === "mermaid" ? readFlowchart(block, "") : readPlantUml(block, "");
  return read.edges.length === 1 && read.edges[0]?.from === name;
}

/**
 * Makes an id from a name that can't be one, such as `slices_domain` from
 * `slices.domain`, with a number added when it is in use.
 *
 * @param name - the name, or a base to build the id from.
 * @param taken - names and ids already in use; the new id is added.
 * @returns an id made of letters, digits and `_`.
 */
function freshId(name: string, taken: Set<string>): string {
  const base = name.replace(NOT_ID, "_").replace(EDGE_UNDERSCORES, "") || "node";
  let id = base;
  for (let n = 2; taken.has(id); n += 1) {
    id = `${base}_${n}`;
  }
  taken.add(id);
  return id;
}

/** What declaring one node needs besides the entry and its id. */
interface DeclareContext {
  notation: DiagramNotation;
  /** "Layer" or "Context", for the notes. */
  noun: string;
  /** The notes so far; updated in place. */
  notes: string[];
}

/**
 * Declares a layer or a context as a node: in Mermaid one line per module
 * (each quoted label is a module), in PlantUML one component for the first
 * module, since an alias names one component.
 *
 * @param entry - the layer or context.
 * @param entry.name - its name, for the notes and a PlantUML node without a module.
 * @param entry.modules - its module prefixes, each one a quoted label.
 * @param named - how it is written.
 * @param how - the notation, the noun and the notes.
 * @returns the statement lines, indented.
 */
function declare(
  entry: { name: string; modules: readonly string[] },
  named: Named,
  how: DeclareContext,
): string[] {
  const { notation, noun, notes } = how;
  const [first] = entry.modules;
  if (first === undefined) {
    if (named.byLabel) {
      notes.push(
        `${noun} "${entry.name}" has no module and its name can't be a node id, so the diagram can't name it; INW017 reports node "${named.id}".`,
      );
    }
    return [`${INDENT}${notation === "mermaid" ? named.id : `[${entry.name}]`}`];
  }
  if (notation === "mermaid") {
    return entry.modules.map((module) => `${INDENT}${named.id}["${module}"]`);
  }
  if (entry.modules.length > 1) {
    notes.push(
      `${noun} "${entry.name}" has ${entry.modules.length} modules; a PlantUML component names one, so the diagram shows "${first}" only.`,
    );
  }
  return [`${INDENT}${plantUmlNode(named, first)}`];
}

/**
 * Writes a PlantUML component that names a module: `[module] as id`, or
 * `[name] as "module"` for a name with a hyphen, which a bare alias can't hold.
 *
 * @param named - how the layer or context is written.
 * @param module - the module it stands for.
 * @returns the component, without indent.
 */
function plantUmlNode(named: Named, module: string): string {
  return named.bracket
    ? `[${named.id}] as "${module}"`
    : notationOf("plantuml").node(named.id, module);
}

/** What writing a context's group needs besides the context and its id. */
interface GroupContext {
  notation: DiagramNotation;
  /** Names and ids already in use; the public nodes' ids are added. */
  taken: Set<string>;
  /** The notes so far; updated in place. */
  notes: string[];
}

/**
 * Writes a context with public modules as a group (a Mermaid subgraph, a
 * PlantUML package) named by its first module, holding one `public` node per
 * `public` entry.
 *
 * @param context - the context, with its modules and `public` entries.
 * @param named - how it is written.
 * @param how - the notation, the ids in use and the notes.
 * @returns the statement lines, indented.
 */
function group(context: DiagramContextInput, named: Named, how: GroupContext): string[] {
  const { notation, taken, notes } = how;
  const [first = ""] = context.modules;
  if (context.modules.length > 1) {
    notes.push(
      `Context "${context.name}" has ${context.modules.length} modules; a ${notationOf(notation).group} names one, so the diagram shows "${first}" only.`,
    );
  }
  const inner = context.public.map((entry) => {
    const id = freshId(`${named.id}_${entry.split(".").at(-1) ?? ""}`, taken);
    return notation === "mermaid"
      ? `${INDENT}${INDENT}${id}["${entry}"]:::${PUBLIC}`
      : `${INDENT}${INDENT}[${entry}] as ${id} <<${PUBLIC}>>`;
  });
  if (notation === "mermaid") {
    return [`${INDENT}subgraph ${named.id}["${first}"]`, ...inner, `${INDENT}end`];
  }
  const open = named.bracket
    ? `package [${named.id}] as "${first}" {`
    : notationOf("plantuml").groupNode(named.id, first);
  return [`${INDENT}${open}`, ...inner, `${INDENT}}`];
}

/**
 * Writes "may import" arrows from every one of some nodes to every one of
 * others: one Mermaid statement joined with `&`, or one PlantUML arrow each.
 *
 * @param from - the importing nodes, as arrows name them.
 * @param to - the imported nodes.
 * @param notation - the diagram's notation.
 * @returns the statement lines, indented.
 */
function arrows(
  from: readonly string[],
  to: readonly string[],
  notation: DiagramNotation,
): string[] {
  if (notation === "mermaid") {
    return [`${INDENT}${from.join(" & ")} --> ${to.join(" & ")}`];
  }
  return from.flatMap((a) => to.map((b) => `${INDENT}${a} --> ${b}`));
}
