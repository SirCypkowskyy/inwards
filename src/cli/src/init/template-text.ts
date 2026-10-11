/**
 * @file The text a preset's templates add beyond their roles: the opt-in rules
 * a role turns on (`[tool.inwards.templates.<name>.rules]`), the libraries some
 * roles may not import (INW005's `deny`, one selector per role), and how
 * `--list-styles` words both. Pure: it reads the preset only, and
 * `style-text.ts` places the lines in the config.
 */
import { RULES } from "@inwards/core";
import { fullModule } from "./shapes.ts";
import type { Style, StyleTemplate } from "./styles.ts";

/**
 * Writes a template's `rules` table, after a blank line and its comment.
 *
 * @param template - one of the preset's templates.
 * @returns the lines, or none when the template turns no rule on.
 */
export function templateRulesLines(template: StyleTemplate): string[] {
  if (template.rules === undefined) {
    return [];
  }
  return [
    "",
    `# ${template.rules.why}`,
    `[tool.inwards.templates.${template.name}.rules]`,
    ...Object.entries(template.rules.roles).map(
      ([role, rules]) => `${role} = ${inlineRules(rules)}`,
    ),
  ];
}

/**
 * Writes one role's rules as an inline table.
 *
 * @param rules - rule names and their values: `true` or a severity.
 * @returns e.g. `{ orm-naming = "warning" }`.
 */
function inlineRules(rules: Readonly<Record<string, "warning" | "error" | true>>): string {
  const pairs = Object.entries(rules).map(([rule, value]) => `${rule} = ${JSON.stringify(value)}`);
  return `{ ${pairs.join(", ")} }`;
}

/**
 * Finds the libraries a preset's templates deny to some of their roles, as
 * INW005's `deny` entries: one per template, with a selector per role for
 * each `layers` entry that uses it.
 *
 * @param style - the preset.
 * @param pkg - the project's import package.
 * @returns the entries with their comments, in the templates' order; none when no template denies anything.
 */
export function roleDenies(
  style: Style,
  pkg: string,
): { why: string; modules: string[]; libraries: readonly string[] }[] {
  return style.templates.flatMap((template) => {
    const { deny } = template;
    if (deny === undefined) {
      return [];
    }
    const entries = style.layers.filter((layer) => layer.template === template.name);
    const modules = entries.flatMap((layer) =>
      deny.roles.map((role) =>
        fullModule(pkg, layer.module === "" ? role : `${layer.module}.${role}`),
      ),
    );
    return modules.length === 0 ? [] : [{ why: deny.why, modules, libraries: deny.libraries }];
  });
}

/**
 * Words what a preset's templates add for `--list-styles`: the opt-in rules a
 * role turns on, and the libraries some roles may not import.
 *
 * @param style - the preset.
 * @param pkg - the package name to show in module names.
 * @returns one indented line per rule and per deny, e.g. `  Turns on INW016 in fastapi-domain's models, as a warning.`
 */
export function templateNotes(style: Style, pkg: string): string[] {
  const rules = style.templates.flatMap((template) =>
    Object.entries(template.rules?.roles ?? {}).flatMap(([role, named]) =>
      Object.entries(named).map(([rule, value]) => {
        const code = Object.values(RULES).find((meta) => meta.name === rule)?.code ?? rule;
        const level = value === true ? "" : `, as ${value === "error" ? "an error" : "a warning"}`;
        return `  Turns on ${code} in ${template.name}'s ${role}${level}.`;
      }),
    ),
  );
  const denies = roleDenies(style, pkg).map(
    (deny) => `  Denies ${deny.libraries.join(", ")} to ${deny.modules.join(", ")} (INW005).`,
  );
  return [...rules, ...denies];
}
