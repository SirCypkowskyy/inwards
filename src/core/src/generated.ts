/**
 * `generated` in `[tool.inwards]`: modules a build step writes, which INW010
 * treats as existing when they aren't on disk (#160, ADR-029). A developer's
 * checkout has `orders_pb2.py` from protoc and `_version.py` from
 * setuptools-scm; a fresh CI checkout doesn't, so without this the same
 * commit would pass locally and fail in CI.
 *
 * A pattern is a dotted module name whose segments may use `*` and `?`. It
 * matches when its segments match consecutive whole segments of a module
 * name, anywhere in it, like the `ignore` key: `*_pb2` covers
 * `shop.api.orders_pb2`, `shop.gen` covers everything under `shop/gen/`. A
 * wildcard never crosses a dot. There are no bracket sets: a set can hold any
 * character, so `[!/]*` would cover every segment past the validation.
 * Matching never uses a regular expression (see `glob.ts`), since the module
 * name comes from an import an agent writes.
 */

import { globMatches } from "./glob.ts";
import { ConfigError } from "./toml.ts";

/**
 * What `generated` is when not set: protoc's modules (`orders_pb2`,
 * `orders_pb2_grpc`) and the `_version` module setuptools-scm and hatch-vcs
 * write. Tools name these, people don't, so a missing one is almost always a
 * build step that hasn't run, not a hallucination.
 */
export const DEFAULT_GENERATED: readonly string[] = ["*_pb2", "*_pb2_grpc", "_version"];

/** One segment of a pattern: identifier characters, `*` and `?`. */
const SEGMENT = /^[\p{XID_Continue}*?]+$/u;
/** A pattern made only of wildcards and dots, which would cover almost any module. */
const WILDCARDS_ONLY = /^[*?.]+$/u;
/** What the config error says a pattern looks like. */
const HINT =
  'a list of module patterns such as "*_pb2" or "shop.gen": dotted names whose segments may use * and ?';

/**
 * Validates `generated`. A segment can't be empty or hold anything but
 * identifier characters, `*` and `?`, and a pattern made only of wildcards is
 * refused, since it would switch INW010 off, which is
 * `[tool.inwards.rules]`'s job.
 *
 * @param value - the raw `generated` value, if any.
 * @returns `{ generated }` when it is set, else nothing.
 * @throws {ConfigError} naming the first bad entry.
 */
export function parseGenerated(value: unknown): { generated?: string[] } {
  if (value === undefined) {
    return {};
  }
  if (!(Array.isArray(value) && value.every((p) => typeof p === "string"))) {
    throw new ConfigError(`tool.inwards.generated must be ${HINT}.`);
  }
  const bad = value.find(
    (pattern) =>
      WILDCARDS_ONLY.test(pattern) || !pattern.split(".").every((seg) => SEGMENT.test(seg)),
  );
  if (bad !== undefined) {
    throw new ConfigError(
      WILDCARDS_ONLY.test(bad)
        ? `tool.inwards.generated: "${bad}" has no fixed character, so it would cover almost any module. To turn INW010 off, use ignore = ["INW010"] in [tool.inwards.rules].`
        : `tool.inwards.generated: "${bad}" is not a module pattern. Use ${HINT}.`,
    );
  }
  return { generated: value };
}

/**
 * Tells whether a pattern covers a module (see the file comment), in
 * O(pattern × name) time per start segment.
 *
 * @param module - a dotted module name.
 * @param patterns - validated `generated` patterns.
 * @returns true when any pattern matches.
 */
export function isGenerated(module: string, patterns: readonly string[]): boolean {
  const name = module.split(".");
  return patterns.some((pattern) => {
    const want = pattern.split(".");
    return name.some((_, start) =>
      want.every((glob, i) => {
        const segment = name[start + i];
        return segment !== undefined && globMatches(glob, segment);
      }),
    );
  });
}
