/**
 * @file `cycles` in `[tool.inwards]`: which import cycles INW004 reports.
 * `"modules"` reports cycles between modules, `"contexts"` cycles between
 * bounded contexts. The default is `["contexts"]`, which only matters where
 * contexts are declared, so turning the rule on doesn't fail every project
 * that lives with module cycles; `[]` turns it off.
 */
import { ConfigError } from "./toml.ts";

/** One kind of cycle INW004 can report. */
export type CycleMode = "modules" | "contexts";
const MODES: readonly string[] = ["modules", "contexts"] satisfies CycleMode[];

/**
 * Tells whether a value names a cycle mode.
 *
 * @param value - any parsed value.
 * @returns true for `"modules"` or `"contexts"`.
 */
function isCycleMode(value: unknown): value is CycleMode {
  return typeof value === "string" && MODES.includes(value);
}

/**
 * Validates `cycles`.
 *
 * @param value - the raw `cycles` value, if any.
 * @returns `{ cycles }` when it is set, else nothing.
 * @throws {ConfigError} when it isn't a list of distinct modes.
 */
export function parseCycles(value: unknown): { cycles?: CycleMode[] } {
  if (value === undefined) {
    return {};
  }
  if (!Array.isArray(value)) {
    throw new ConfigError(
      'tool.inwards.cycles must be a list of "modules" and "contexts", such as ["contexts"].',
    );
  }
  const cycles: CycleMode[] = [];
  value.forEach((entry: unknown, i) => {
    if (!isCycleMode(entry)) {
      throw new ConfigError(`tool.inwards.cycles[${i}] must be "modules" or "contexts".`);
    }
    if (cycles.includes(entry)) {
      throw new ConfigError(`tool.inwards.cycles[${i}] repeats "${entry}".`);
    }
    cycles.push(entry);
  });
  return { cycles };
}
