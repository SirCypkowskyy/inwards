/**
 * @file The text a preset turns into: the `[tool.inwards]` table
 * `inwards init --style` writes (layers with sibling groups and templates,
 * the templates, the rules it turns off or on, its contexts and, with `--scaffold`,
 * its shapes), the `--list-styles` listing, and the annotated tree init and
 * the picker draw. Pure: what is on disk comes in through a callback.
 */
import { STYLES } from "./presets.ts";
import { tomlArray as array, describeShapes, fullModule, shapeLines } from "./shapes.ts";
import {
  allowedImports,
  type ExpandedLayer,
  expandLayers,
  STYLE_NAMES,
  type Style,
  type StyleLayer,
  type StyleOptIn,
} from "./styles.ts";
import { roleDenies, templateNotes, templateRulesLines } from "./template-text.ts";

export const MISSING = "(missing)";

/**
 * What a module below the package is: on disk as a file or a directory,
 * missing, or planned (drawn the way the scaffold creates it, never marked missing).
 */
export type ModuleKind = "file" | "dir" | "missing" | "planned";

/** One node of the tree: a package or module, and the layer it is, if any. */
interface TreeNode {
  children: Map<string, TreeNode>;
  layer: ExpandedLayer | undefined;
}

/**
 * Draws a preset's layer packages as a tree, each with its layer and what it
 * may import, e.g. `├── domain/   domain: imports no other layer`. A selector
 * segment is drawn as a package named `*` and never looked up. Used after init writes (with
 * what is on disk) and in the picker (with everything planned).
 *
 * @param style - the preset.
 * @param header - the first line, e.g. `src/app/  (hexagonal)`.
 * @param kind - tells what a module is, from its name segments below the package.
 * @returns the tree as lines of text, each layer annotated.
 */
export function drawTree(
  style: Style,
  header: string,
  kind: (parts: readonly string[]) => ModuleKind,
): string {
  const layers = expandLayers(style);
  const top: TreeNode = { children: new Map(), layer: undefined };
  for (const layer of layers) {
    let node = top;
    for (const part of layer.module === "" ? [] : layer.module.split(".")) {
      const child = node.children.get(part) ?? { children: new Map(), layer: undefined };
      node.children.set(part, child);
      node = child;
    }
    node.layer = layer;
  }
  const rows: [string, string][] = [];
  /**
   * Adds one node's children as rows, depth first, in name order.
   *
   * @param node - the package whose children to add.
   * @param parts - its name segments below the package.
   * @param indent - the tree lines drawn to its left.
   */
  function walk(node: TreeNode, parts: readonly string[], indent: string): void {
    const children = [...node.children].sort(([a], [b]) => a.localeCompare(b));
    children.forEach(([name, child], i) => {
      const last = i === children.length - 1;
      const path = [...parts, name];
      const what = path.includes("*") ? "planned" : kind(path);
      const file = what === "file" || (what !== "dir" && child.layer?.file === true);
      const label = `${indent}${last ? "└── " : "├── "}${file ? `${name}.py` : `${name}/`}`;
      rows.push([label, layerNote(layers, child.layer, what !== "missing")]);
      walk(child, path, `${indent}${last ? "    " : "│   "}`);
    });
  }
  walk(top, [], "");
  const width = Math.max(...rows.map(([label]) => label.length));
  const lines = rows.map(([label, note]) =>
    note === "" ? label : `${label.padEnd(width)}  ${note}`,
  );
  const root = layerNote(layers, top.layer, true);
  return [root === "" ? header : `${header}  ${root}`, ...lines].join("\n");
}

/**
 * Words the note next to a layer in the tree.
 *
 * @param layers - the preset's expanded layers.
 * @param layer - the node's layer, or undefined for a package that only holds layers.
 * @param exists - whether the layer's package or module is on disk.
 * @returns e.g. `application: may import domain`, or "" for a non-layer package.
 */
function layerNote(
  layers: readonly ExpandedLayer[],
  layer: ExpandedLayer | undefined,
  exists: boolean,
): string {
  if (layer === undefined) {
    return "";
  }
  const note = allowedImports(layers, layers.indexOf(layer));
  return `${layer.name}: ${note}${exists ? "" : ` ${MISSING}`}`;
}

/**
 * Prints every preset's layers for `inwards init --list-styles`: siblings
 * share a number, and a template's roles are listed as the layers they become.
 *
 * @param pkg - the package name to show in module names.
 * @returns the text, one block per preset.
 */
export function describeStyles(pkg: string): string {
  return STYLE_NAMES.map((name) => {
    const style = STYLES[name];
    const layers = expandLayers(style);
    const width = Math.max(...layers.map((layer) => layer.name.length));
    const modWidth = Math.max(...layers.map((layer) => fullModule(pkg, layer.module).length));
    const rows = layers.map(
      (layer) =>
        `  ${layer.rank + 1}. ${layer.name.padEnd(width)}  ${fullModule(pkg, layer.module).padEnd(modWidth)}  ${layer.role}`,
    );
    const rules = style.ignoreRules;
    return [
      `${name}: ${style.summary}`,
      ...rows,
      ...(style.contexts === undefined ? [] : [`  ${style.contexts.why[0] ?? ""}`]),
      ...(rules === undefined ? [] : [`  Turns off ${rules.codes.join(", ")}. ${rules.why}`]),
      ...(style.optIn === undefined
        ? []
        : [
            `  Turns on ${style.optIn.codes.join(", ")} as ${style.optIn.codes.length === 1 ? "a warning" : "warnings"}.`,
          ]),
      ...templateNotes(style, pkg),
      `  Gap: ${style.gap}.`,
      "  Shapes, with --scaffold:",
      ...describeShapes(style.shapes, pkg),
    ].join("\n");
  }).join("\n\n");
}

/**
 * Writes one layer entry as an inline table.
 *
 * @param layer - the preset's layer.
 * @param pkg - the project's import package.
 * @returns e.g. `{ name = "domain", modules = ["my_app.domain"] },`.
 */
function layerEntry(layer: StyleLayer, pkg: string): string {
  const template = layer.template === undefined ? "" : `, template = "${layer.template}"`;
  const deny =
    layer.denyLibraries === undefined ? "" : `, deny-libraries = ${array(layer.denyLibraries)}`;
  return `{ name = ${JSON.stringify(layer.name)}, modules = ${array([fullModule(pkg, layer.module)])}${template}${deny} },`;
}

/**
 * Writes the `layers` array's lines: one entry per layer with its role as a
 * comment, and a nested array around each group of siblings.
 *
 * @param style - the preset.
 * @param pkg - the project's import package.
 * @returns the lines between `layers = [` and `]`.
 */
function layerLines(style: Style, pkg: string): string[] {
  const rows: [string, string | undefined][] = [];
  style.layers.forEach((layer, i) => {
    const next = style.layers[i + 1];
    const opens = layer.sibling !== true && next?.sibling === true;
    const inGroup = opens || layer.sibling === true;
    if (opens) {
      rows.push(["  [", undefined]);
    }
    rows.push([`${inGroup ? "    " : "  "}${layerEntry(layer, pkg)}`, layer.role]);
    if (layer.sibling === true && next?.sibling !== true) {
      rows.push(["  ],", undefined]);
    }
  });
  const width = Math.max(...rows.map(([text, role]) => (role === undefined ? 0 : text.length)));
  return rows.map(([text, role]) =>
    role === undefined ? text : `${text.padEnd(width)}  # ${role}`,
  );
}

/**
 * Writes the templates, the rules the preset turns off, and its contexts:
 * the scaffold's with `--scaffold`, else the same entries commented out, as
 * an example to copy for each package the project already has.
 *
 * @param style - the preset.
 * @param pkg - the project's import package.
 * @param scaffold - whether the scaffold's packages will exist.
 * @returns the lines, each group after a blank line.
 */
function extraLines(style: Style, pkg: string, scaffold: boolean): string[] {
  const lines: string[] = [];
  for (const template of style.templates) {
    lines.push("", `# ${template.why}`, `[tool.inwards.templates.${template.name}]`);
    if (template.roles.length > 0) {
      lines.push(`roles = ${array(roleRanks(template.roles))}`);
    }
    lines.push(`public = ${array(template.public)}`);
    lines.push(...templateRulesLines(template));
  }
  lines.push(...rulesLines(style, pkg));
  const { contexts } = style;
  if (contexts !== undefined) {
    lines.push("", ...contexts.why.map((line) => `# ${line}`));
    const mark = scaffold ? "" : "# ";
    for (const name of contexts.names) {
      const module = fullModule(pkg, contexts.parent === "" ? name : `${contexts.parent}.${name}`);
      lines.push(
        `${mark}[[tool.inwards.contexts]]`,
        `${mark}name = ${JSON.stringify(name)}`,
        `${mark}modules = ${array([module])}`,
        `${mark}template = ${JSON.stringify(contexts.template)}`,
      );
    }
  }
  return lines;
}

/**
 * Writes a template's roles one rank each, siblings joined as `"a | b"`.
 *
 * @param roles - the roles innermost first.
 * @returns e.g. `["constants | config", "models"]`.
 */
function roleRanks(roles: readonly { name: string; sibling?: true }[]): string[] {
  const ranks: string[] = [];
  for (const role of roles) {
    const last = ranks.length - 1;
    if (role.sibling === true && last >= 0) {
      ranks[last] = `${ranks[last] ?? ""} | ${role.name}`;
    } else {
      ranks.push(role.name);
    }
  }
  return ranks;
}

/**
 * Writes `[tool.inwards.rules]`: the rules the preset turns off, the opt-in
 * rules it turns on, a severity table that makes each of them a warning (one
 * line per rule, so a user deletes a line to report the rule at its own severity again), their
 * options tables, and the libraries its templates deny to some roles (INW005's `deny`).
 *
 * @param style - the preset.
 * @param pkg - the project's import package, for options that name modules.
 * @returns the lines, after a blank line, or none when the preset sets no rules.
 */
function rulesLines(style: Style, pkg: string): string[] {
  const { ignoreRules: off, optIn: on } = style;
  const denies = roleDenies(style, pkg);
  if (off === undefined && on === undefined && denies.length === 0) {
    return [];
  }
  const lines = ["", "[tool.inwards.rules]"];
  if (off !== undefined) {
    lines.push(`# ${off.why}`, `ignore = ${array(off.codes)}`);
  }
  if (on !== undefined) {
    lines.push(...optInLines(on, pkg));
  }
  if (denies.length > 0) {
    lines.push(
      "",
      ...denies.map((deny) => `# ${deny.why}`),
      "[tool.inwards.rules.pure-domain]",
      "deny = [",
      ...denies.map(
        (deny) => `  { modules = ${array(deny.modules)}, libraries = ${array(deny.libraries)} },`,
      ),
      "]",
    );
  }
  return lines;
}

/**
 * Writes the opt-in rules a preset turns on: `extend-select`, a severity
 * table making each a warning, and their options tables.
 *
 * @param on - the preset's opt-in rules.
 * @param pkg - the project's import package, for options that name modules.
 * @returns the lines, to follow the `[tool.inwards.rules]` header.
 */
function optInLines(on: StyleOptIn, pkg: string): string[] {
  const lines = [
    `# ${on.why}`,
    `extend-select = ${array(on.codes)}`,
    "",
    "# Delete a line to report that rule at its own severity, an error for most findings.",
    "[tool.inwards.rules.severity]",
    ...on.codes.map((code) => `${code} = "warning"`),
  ];
  for (const table of on.options) {
    const options = typeof table.lines === "function" ? table.lines(pkg) : table.lines;
    lines.push("", `# ${table.why}`, `[tool.inwards.rules.${table.rule}]`, ...options);
  }
  return lines;
}

/**
 * Builds the `[tool.inwards]` table a preset writes, with a comment naming
 * the preset and the version, one comment per layer saying what goes in it,
 * then its templates, rules and contexts, and its shapes when the scaffold is
 * written too.
 *
 * @param style - the preset.
 * @param opts - the package, the config root, this release, the ignore list, the scaffold switch and the line ending.
 * @param opts.pkg - the project's import package, e.g. `my_app`.
 * @param opts.root - the config root, `src` or `.`.
 * @param opts.version - this release, for `required-version` and the comment.
 * @param opts.ignore - the `ignore` entries.
 * @param opts.scaffold - whether the scaffold is written: adds the shapes and turns the contexts on.
 * @param opts.eol - the file's line ending.
 * @returns the table's text, ending with a line break.
 */
export function configTable(
  style: Style,
  opts: {
    pkg: string;
    root: string;
    version: string;
    ignore: readonly string[];
    scaffold: boolean;
    eol: string;
  },
): string {
  const siblings = style.layers.some((layer) => layer.sibling === true);
  const templated = style.layers.some((layer) => layer.template !== undefined);
  const lines = [
    "[tool.inwards]",
    `# Preset "${style.name}" (inwards init --style ${style.name}, Inwards ${opts.version}).`,
    "# Layers are listed innermost first: each may import itself and the layers above it.",
    ...(siblings
      ? ["# A nested array holds sibling layers: they share a place and may not import each other."]
      : []),
    ...(templated
      ? ["# An entry with a template becomes one layer per role, inside each package it matches."]
      : []),
    `# Not enforced by this preset: ${style.gap}.`,
    `root = ${JSON.stringify(opts.root)}`,
    `required-version = ${JSON.stringify(opts.version)}`,
    `ignore = ${array(opts.ignore)}`,
    "layers = [",
    ...layerLines(style, opts.pkg),
    "]",
    ...extraLines(style, opts.pkg, opts.scaffold),
    ...(opts.scaffold ? shapeLines(style.shapes, opts.pkg) : []),
  ];
  return `${lines.join(opts.eol)}${opts.eol}`;
}
