/**
 * @file INW012's `delegate-to` option in `[tool.inwards.rules.thin-endpoint]`:
 * the shape check the options parser runs, and the check that needs the
 * layers, which `parse.ts` runs once they are parsed. An entry is a layer
 * name, or else a module prefix or selector in the grammar of
 * `layers[].modules`. It only validates strings; INW012 reads the entries.
 */
import { isSelector, selectorProblem } from "./layer-selector.ts";
import { isModuleList } from "./layers.ts";
import { ConfigError, isDottedName } from "./toml.ts";

/**
 * Parses INW012's `delegate-to`: a non-empty list of layer names or module
 * prefixes and selectors. Which entries name a layer is known only once the
 * layers are parsed, so `delegateProblem` checks the rest then.
 *
 * @param value - the raw list.
 * @param where - the key's dotted path.
 * @returns the entries as written.
 * @throws {ConfigError} when the list is empty or holds a blank or non-string entry.
 */
export function delegateTargets(value: unknown, where: string): string[] {
  if (!(isModuleList(value) && value.length > 0 && value.every((e) => e.trim() !== ""))) {
    throw new ConfigError(
      `${where} must be a non-empty list of layer names or module prefixes and selectors, such as ["application"] or ["shop.*.service"].`,
    );
  }
  return value;
}

/**
 * Checks the `delegate-to` entries that name no layer: each must then be a
 * module prefix or selector, as in `layers[].modules`.
 *
 * @param entries - the entries as parsed.
 * @param layerNames - the names of the configured layers.
 * @returns the error message for the first bad entry, or undefined when all are fine.
 */
export function delegateProblem(
  entries: readonly string[],
  layerNames: ReadonlySet<string>,
): string | undefined {
  for (const entry of entries) {
    let problem = isSelector(entry) ? selectorProblem(entry) : undefined;
    if (!(layerNames.has(entry) || isSelector(entry) || isDottedName(entry))) {
      problem = "it names no layer and isn't a dotted module name";
    }
    if (problem !== undefined && !layerNames.has(entry)) {
      return `tool.inwards.rules.thin-endpoint.delegate-to: "${entry}" is not a layer name, module prefix or selector: ${problem}.`;
    }
  }
  return undefined;
}
