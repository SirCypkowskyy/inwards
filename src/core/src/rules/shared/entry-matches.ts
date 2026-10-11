/**
 * @file Whether a layer entry, a context prefix or a diagram label names any
 * module that exists: INW006 asks it of each layer prefix, INW017 of each
 * quoted diagram label. Pure; the caller passes the module names it found.
 */
import { isSelector, matchEntry } from "../../config/layer-selector.ts";

/**
 * Tells whether a layer entry matches any module, whatever the precedence.
 *
 * @param prefix - a layer prefix or selector.
 * @param modules - module names.
 * @returns true when a module equals the prefix or lies inside it, or the selector matches one.
 */
export function matchesAny(prefix: string, modules: ReadonlySet<string>): boolean {
  if (isSelector(prefix)) {
    return [...modules].some((module) => matchEntry(prefix, module) !== undefined);
  }
  if (modules.has(prefix)) {
    return true;
  }
  const inside = `${prefix}.`;
  for (const module of modules) {
    if (module.startsWith(inside)) {
      return true;
    }
  }
  return false;
}
