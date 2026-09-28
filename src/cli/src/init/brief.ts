/**
 * @file The architecture brief (`inwards context`, `inwards init --brief`, #58):
 * a short Markdown summary of `[tool.inwards]` for AGENTS.md, so an agent
 * knows the layers, the allowed import directions, where ports live, and any
 * library or context rules before it writes an import, rather than after a
 * violation. It builds the text deterministically from the parsed config, the
 * preset named in init's comment, and a probe for `ports` modules; it reads
 * through the platform's probe and reader and never writes a file itself.
 */
import { dirname, join } from "node:path";
import { type InwardsConfig, type LayerSpec, parseConfig, ruleLevel } from "@inwards/core";
import type { FileReader, PathProbe } from "../platform/contracts.ts";
import type { Change } from "./contracts.ts";
import { STYLES } from "./presets.ts";
import { readIfThere, upsertSection } from "./section.ts";
import { allowedImports, expandLayers, isStyle, type Style } from "./styles.ts";

/** The markers around the brief in AGENTS.md, apart from the check section's. */
const BRIEF_MARKERS = { begin: "<!-- inwards-brief:begin -->", end: "<!-- inwards-brief:end -->" };
/** The comment `init --style` writes into `[tool.inwards]`, naming the preset. */
const PRESET_COMMENT = /^# Preset "(?<name>[a-z-]+)" \(inwards init --style /mu;

/** What building a brief reads: whether a module is on disk, and AGENTS.md. */
export interface BriefIo {
  probe: Pick<PathProbe, "exists" | "kind">;
  read: Pick<FileReader, "text">;
}

/** What the brief is built from. */
interface BriefInput {
  config: InwardsConfig;
  /** The preset `init --style` wrote, when its comment is still there. */
  style: Style | undefined;
  /** Modules where ports live, e.g. `app.application.ports`, sorted. */
  ports: readonly string[];
}

/**
 * Writes the brief: the layers innermost first with what each may import,
 * where ports live, and the library and context rules when configured and on.
 *
 * @param input - the config, the preset and the ports.
 * @returns Markdown without markers, ending without a line break.
 */
export function architectureBrief(input: BriefInput): string {
  const { config, style, ports } = input;
  const preset = style === undefined ? "" : ` (the ${style.name} preset)`;
  const where = ports.length === 0 ? "the inner layer" : ports.map(code).join(" or ");
  const hasSiblings = config.layers.some((layer) => layer.rank !== undefined);
  const siblings = hasSiblings ? ", nor a sibling of your own layer" : "";
  const lines = [
    "## Architecture brief (Inwards)",
    "",
    `\`[tool.inwards]\` in pyproject.toml enforces these layers${preset}, innermost first. Imports point inwards: never import a layer listed after your own${siblings}.`,
    "",
    ...config.layers.map(
      (layer, i) =>
        `${i + 1}. ${layer.name} (${layer.modules.map(code).join(", ")}): ${allowedImports(config.layers, i)}`,
    ),
    "",
    `Ports: when an inner layer needs something from an outer one, declare a \`typing.Protocol\` in ${where} and implement it in the outer layer.`,
    ...librarySection(config),
    ...contextSection(config),
  ];
  return lines.join("\n");
}

/**
 * Lists each layer's library rules (INW005), including the default the
 * innermost of two or more layers gets.
 *
 * @param config - the parsed config.
 * @returns the lines, with a blank line first, or none when INW005 is off or nothing applies.
 */
function librarySection(config: InwardsConfig): string[] {
  if (ruleLevel("INW005", config.rules) === "off") {
    return [];
  }
  const rules = config.layers.flatMap((layer, i) => {
    const rule = libraryRule(layer, (layer.rank ?? i) === 0 && config.layers.length > 1);
    return rule === undefined ? [] : [`- ${layer.name}: ${rule}`];
  });
  return rules.length === 0 ? [] : ["", "Libraries (INW005):", ...rules];
}

/**
 * Words one layer's library rule.
 *
 * @param layer - one configured layer, with its library lists.
 * @param innermost - whether it gets the default deny list (innermost of two or more).
 * @returns e.g. `third-party only \`pydantic\``, or undefined when the layer has no rule.
 */
function libraryRule(layer: LayerSpec, innermost: boolean): string | undefined {
  const parts: string[] = [];
  if (layer.allowLibraries !== undefined) {
    parts.push(`third-party only ${list(layer.allowLibraries)}`);
  }
  const deny = [...(layer.denyLibraries ?? []), ...(layer.extendDenyLibraries ?? [])];
  if (innermost && layer.denyLibraries === undefined) {
    const extra = deny.length === 0 ? "" : `, nor ${list(deny)}`;
    parts.push(
      `no web frameworks, database or network clients, \`subprocess\` or \`socket\`${extra}`,
    );
  } else if (deny.length > 0) {
    parts.push(`not ${list(deny)}`);
  }
  return parts.length === 0 ? undefined : parts.join("; ");
}

/**
 * Lists the contexts (INW002, INW003): what each owns, what others may import, and what it depends on.
 *
 * @param config - the parsed config.
 * @returns the lines, with a blank line first, or none without contexts or with both rules off.
 */
function contextSection(config: InwardsConfig): string[] {
  const off = ["INW002", "INW003"].every((rule) => ruleLevel(rule, config.rules) === "off");
  if (config.contexts === undefined || off) {
    return [];
  }
  const header =
    ruleLevel("INW002", config.rules) === "off"
      ? "Contexts (INW003): import only another context's public modules."
      : "Contexts (INW002, INW003): import another context only when yours depends on it, and only its public modules.";
  return [
    "",
    header,
    ...config.contexts.map((ctx) => {
      const pub = ctx.public.length === 0 ? "nothing public" : `public ${list(ctx.public)}`;
      const deps =
        ctx.dependsOn.length === 0 ? "no dependencies" : `depends on ${ctx.dependsOn.join(", ")}`;
      return `- ${ctx.name} (${list(ctx.modules)}): ${pub}; ${deps}`;
    }),
  ];
}

/**
 * Formats names as inline code, comma separated.
 *
 * @param names - module or library names.
 * @returns e.g. `` `a`, `b` ``.
 */
function list(names: readonly string[]): string {
  return names.map(code).join(", ");
}

/**
 * Formats one name as inline code.
 *
 * @param name - a module or library name.
 * @returns the name in backticks.
 */
function code(name: string): string {
  return `\`${name}\``;
}

/**
 * Finds the preset `init --style` wrote, from the comment it puts in the table.
 *
 * @param text - the pyproject.toml text.
 * @returns the preset, or undefined when the comment is gone or names none.
 */
function presetOf(text: string): Style | undefined {
  const name = PRESET_COMMENT.exec(text)?.groups?.["name"];
  return isStyle(name) ? STYLES[name] : undefined;
}

/**
 * Finds where ports live: a `ports` package or module directly inside a
 * layer's literal module on disk, and the preset's ports module when the
 * preset's layer is still configured (so it is named before `--scaffold`
 * creates it). Layer selectors aren't probed.
 *
 * @param probe - tells what is on disk.
 * @param project - the directory of pyproject.toml.
 * @param config - the parsed config.
 * @param style - the preset, if any.
 * @returns the dotted modules, sorted and without duplicates.
 */
function portModules(
  probe: Pick<PathProbe, "kind">,
  project: string,
  config: InwardsConfig,
  style: Style | undefined,
): string[] {
  const found = new Set<string>();
  // A selector (`shop.*.domain`) names no one directory to probe; its layer gets the generic hint.
  const literal = config.layers.flatMap((layer) => layer.modules).filter((m) => !m.includes("*"));
  for (const module of literal) {
    const base = join(project, config.root, ...module.split("."), "ports");
    if (probe.kind(base) === "dir" || probe.kind(`${base}.py`) === "file") {
      found.add(`${module}.ports`);
    }
  }
  const fromPreset = style === undefined ? undefined : presetPorts(style, config);
  if (fromPreset !== undefined) {
    found.add(fromPreset);
  }
  return [...found].sort();
}

/**
 * Names the preset's ports module in this project: the parent of the
 * scaffold's port, below the configured layer that holds it.
 *
 * @param style - the preset `init --style` wrote.
 * @param config - the parsed config.
 * @returns e.g. `app.application.ports`, or undefined when that layer isn't configured or has only selectors.
 */
function presetPorts(style: Style, config: InwardsConfig): string | undefined {
  const { example } = style;
  if (typeof example === "function") {
    return undefined;
  }
  const parent = example.port.split(".").slice(0, -1).join(".");
  const owner = expandLayers(style).find(
    (layer) => parent === layer.module || parent.startsWith(`${layer.module}.`),
  );
  // The layer's first literal prefix: a selector (`app.*.application`) names no one module.
  const module = config.layers
    .find((layer) => layer.name === owner?.name)
    ?.modules.find((m) => !m.includes("*"));
  return owner === undefined || module === undefined
    ? undefined
    : `${module}${parent.slice(owner.module.length)}`;
}

/**
 * Builds the brief for one config.
 *
 * @param io - probes for `ports` modules.
 * @param configPath - the pyproject.toml.
 * @param text - its text (possibly not written yet, during init).
 * @returns the brief, without markers.
 * @throws {ConfigError} when the config is invalid.
 */
export function briefFor(io: Pick<BriefIo, "probe">, configPath: string, text: string): string {
  const config = parseConfig(text);
  const style = presetOf(text);
  const ports = portModules(io.probe, dirname(configPath), config, style);
  return architectureBrief({ config, style, ports });
}

/**
 * Adds the brief's marked section to the AGENTS.md next to the config, on
 * top of any change to AGENTS.md already planned (init's check section).
 *
 * @param io - reads AGENTS.md and probes for `ports` modules.
 * @param changes - the changes planned so far.
 * @param config - the config the brief describes.
 * @param config.path - its pyproject.toml.
 * @param config.text - its text, as it will be written.
 * @returns the changes with AGENTS.md's replaced or added, or an error for broken markers.
 * @throws {ConfigError} when the config is invalid; when AGENTS.md exists but can't be read.
 */
export function withBrief(
  io: BriefIo,
  changes: readonly Change[],
  config: { path: string; text: string },
): Change[] | string {
  const path = join(dirname(config.path), "AGENTS.md");
  const prior = changes.find((change) => change.path === path);
  const before = prior === undefined ? readIfThere(io, path) : prior.before;
  const current = prior === undefined ? (before ?? "") : prior.after;
  const brief = briefFor(io, config.path, config.text);
  const section = [BRIEF_MARKERS.begin, brief, BRIEF_MARKERS.end].join("\n");
  const result = upsertSection(current, BRIEF_MARKERS, section);
  if ("error" in result) {
    return `${path} has ${result.error}`;
  }
  return [...changes.filter((change) => change !== prior), { path, before, after: result.after }];
}
