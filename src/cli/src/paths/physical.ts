/**
 * The physical meaning of a path: what the OS opens, as opposed to what the
 * path says as text. `path.resolve` folds `dlink/..` away, but the OS follows
 * `dlink` first, so `dlink/../x.py` can be a different file. The hooks judge
 * agent-supplied paths this way (ADR-013). Filesystem access comes in through
 * the `PathProbe` contract.
 */
import { dirname, isAbsolute, join, parse } from "node:path";
import type { PathProbe } from "../platform/contracts.ts";
import { PATH_SEPARATORS } from "./lexical.ts";

/**
 * Resolves a path the way the OS does when it opens it: each `..` is applied
 * to the real path of what comes before it.
 *
 * @param probe - resolves real paths.
 * @param base - directory a relative `file` is resolved against.
 * @param file - the path as given, absolute or relative.
 * @returns the real path, or undefined when it does not exist.
 */
export function physicalRealpath(
  probe: Pick<PathProbe, "realpath">,
  base: string,
  file: string,
): string | undefined {
  const root = isAbsolute(file) ? parse(file).root : "";
  let current = root === "" ? base : root;
  for (const segment of PATH_SEPARATORS[Symbol.split](file.slice(root.length))) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      const resolved = probe.realpath(current);
      if (resolved === undefined) {
        return undefined;
      }
      current = dirname(resolved);
    } else {
      current = join(current, segment);
    }
  }
  return probe.realpath(current);
}
