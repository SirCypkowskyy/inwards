/**
 * @file The symlinks in a config's layer packages, for INW006 (#83, #84): the
 * CLI check and the session snapshot list them here, and `checkLinks` in the
 * engine decides which hide code from the rules. Nothing here reads a file;
 * the walk and the real paths come through the injected walker and probe.
 */
import { dirname, join, relative, resolve } from "node:path";
import { type InwardsConfig, type LayerLink, layerPackages } from "@inwards/core";
import { isInside, posix } from "../paths/lexical.ts";
import type { FileWalker, PathProbe } from "../platform/contracts.ts";

/**
 * Lists the symlinks in every layer's top-level package (`layerPackages`),
 * the package itself included when it is a link, or a `.py` or `.pyi` file
 * of that name is. Links that stay in the config root are followed, so a
 * chain through code outside every layer is listed under the path Python
 * imports it by. A package whose real path lies outside the root is reported
 * as a link but not walked, so a link to `/` never starts a walk of the disk.
 * The engine decides which links hide code (`checkLinks`).
 *
 * @param io - resolves real paths and lists links.
 * @param io.probe - resolves real paths.
 * @param io.walk - lists the links below a directory.
 * @param configPath - absolute path of the pyproject.toml.
 * @param config - its parsed config.
 * @returns each link as written, absolute, with its real target.
 */
export function layerLinks(
  io: { probe: Pick<PathProbe, "realpath">; walk: Pick<FileWalker, "links"> },
  configPath: string,
  config: InwardsConfig,
): { path: string; target: string }[] {
  const root = resolve(dirname(configPath), config.root);
  const realRoot = io.probe.realpath(root) ?? root;
  return layerPackages(config).flatMap((pkg) =>
    [pkg, `${pkg}.py`, `${pkg}.pyi`].flatMap((name) => {
      const path = join(root, name);
      const target = io.probe.realpath(path);
      if (target === undefined) {
        return [];
      }
      const self = target === join(realRoot, name) ? [] : [{ path, target }];
      return [...self, ...(atOrInside(realRoot, target) ? io.walk.links(path, realRoot) : [])];
    }),
  );
}

/**
 * Names a config's layer links relative to its root, as `checkLinks` takes
 * them. A target is named by its import spelling: under a layer package that
 * is itself a link in the root (`shop -> packages/shop`), by the package's
 * name (`shop/infrastructure`), not its real path (`packages/shop/infrastructure`).
 *
 * @param probe - resolves real paths.
 * @param links - the links as `layerLinks` gives them, or read back from a session record.
 * @param root - the config root as written.
 * @param config - the config, for its layer packages.
 * @returns the links under the root, each with its target relative to the
 *   root, or undefined for a target outside it.
 */
export function linksUnder(
  probe: Pick<PathProbe, "realpath">,
  links: readonly { path: string; target: string }[],
  root: string,
  config: InwardsConfig,
): LayerLink[] {
  const realRoot = probe.realpath(root) ?? root;
  const spellings = layerPackages(config).flatMap((pkg) => {
    const dir = join(root, pkg);
    const real = probe.realpath(dir);
    const moved = real !== undefined && real !== join(realRoot, pkg) && isInside(realRoot, real);
    return moved ? [{ dir, real }] : [];
  });
  return links
    .filter(({ path }) => isInside(root, path))
    .map(({ path, target }) => ({
      path: posix(relative(root, path)),
      target: spell(target, { root, realRoot }, spellings),
      real: target,
      // A directory holding a linked layer package's real code holds layers too.
      ...(spellings.some(({ real }) => atOrInside(target, real)) ? { holdsLayers: true } : {}),
    }));
}

/**
 * Names a real target as Python imports it, relative to the config root.
 *
 * @param target - the real target.
 * @param roots - the config root, as written and real.
 * @param roots.root - the config root as written.
 * @param roots.realRoot - the config root with symlinks resolved.
 * @param spellings - layer packages that are links in the root: each as written and real.
 * @returns the root-relative name, or undefined for a target outside the root.
 */
function spell(
  target: string,
  { root, realRoot }: { root: string; realRoot: string },
  spellings: readonly { dir: string; real: string }[],
): string | undefined {
  const spelled = spellings.find(({ real }) => atOrInside(real, target));
  if (spelled !== undefined) {
    return posix(relative(root, join(spelled.dir, relative(spelled.real, target))));
  }
  return atOrInside(realRoot, target) ? posix(relative(realRoot, target)) : undefined;
}

/**
 * Tells whether a path is a directory or lies below it, by the text alone.
 *
 * @param dir - the directory.
 * @param path - the path to test.
 * @returns true when `path` is `dir` or inside it.
 */
function atOrInside(dir: string, path: string): boolean {
  return path === dir || isInside(dir, path);
}
