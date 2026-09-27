/**
 * @file What a project looks like right now, as the session start and the Stop gate
 * compare it: every `[tool.inwards]` table, and a content hash per Python
 * file. Paths are project-relative with forward slashes: real paths for
 * configs, the paths as walked for the manifest. The filesystem comes in
 * through the injected probe, reader and walker.
 */
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { ConfigError, declaresInwards, type InwardsConfig, parseConfig } from "@inwards/core";
import { posix } from "../paths/lexical.ts";
import type { FileReader, FileWalker, PathProbe } from "../platform/contracts.ts";
import { layerDirs } from "./check.ts";

/** What taking a snapshot reads. */
export interface SnapshotIo {
  probe: Pick<PathProbe, "realpath">;
  read: Pick<FileReader, "text" | "bytes">;
  walk: FileWalker;
}

/** Every `[tool.inwards]` table in a project, by project-relative pyproject.toml path. */
export interface ProjectConfigs {
  valid: Record<string, InwardsConfig>;
  /** Tables that don't parse. They govern nothing: any check under them stops with a config error. */
  invalid: string[];
  /**
   * Where each valid config was found, by its real path's key. A symlinked
   * pyproject.toml governs the tree it sits in, not its target's.
   */
  found: Record<string, string[]>;
}

/**
 * Reads every `[tool.inwards]` table in the project, monorepo packages
 * included. Layer packages are walked again without skips, so a config
 * inside a disguised directory there is found too.
 *
 * @param io - walks the project and reads the configs.
 * @param project - the real project root.
 * @returns the valid configs and the paths of invalid ones.
 * @throws when a pyproject.toml can't be read.
 */
export function projectConfigs(io: SnapshotIo, project: string): ProjectConfigs {
  const first = readConfigs(io, project, io.walk.files([project], isPyproject));
  const open = openDirs(io, project, first.valid);
  // ponytail: a second walk, over layer packages only; one walk if SessionStart gets slow.
  const paths = [
    ...io.walk.files([project], isPyproject),
    ...io.walk.files(open, isPyproject, open),
  ];
  return readConfigs(io, project, [...new Set(paths)]);
}

/**
 * Tells whether a file name is pyproject.toml.
 *
 * @param name - a file name.
 * @returns true for `pyproject.toml`.
 */
function isPyproject(name: string): boolean {
  return name === "pyproject.toml";
}

/**
 * Parses the pyproject.toml files that declare `[tool.inwards]`.
 *
 * @param io - reads the files and resolves their real paths.
 * @param project - the real project root.
 * @param paths - absolute pyproject.toml paths.
 * @returns the valid configs and the paths of invalid ones, sorted.
 * @throws when a file can't be read, or on an error other than a `ConfigError`.
 */
function readConfigs(io: SnapshotIo, project: string, paths: string[]): ProjectConfigs {
  const found: ProjectConfigs = { valid: {}, invalid: [], found: {} };
  for (const path of paths.sort()) {
    const text = io.read.text(path);
    const rel = projectPath(io.probe, project, path);
    try {
      if (declaresInwards(text)) {
        found.valid[rel] = parseConfig(text);
        found.found[rel] = [...(found.found[rel] ?? []), path];
      }
    } catch (err) {
      if (!(err instanceof ConfigError)) {
        throw err;
      }
      found.invalid.push(rel);
    }
  }
  return found;
}

/**
 * Lists the layer package directories of every config, walked without skips.
 *
 * @param io - resolves real paths.
 * @param project - the real project root.
 * @param configs - valid configs by project-relative path.
 * @returns the directories.
 */
function openDirs(
  io: Pick<SnapshotIo, "probe">,
  project: string,
  configs: Record<string, InwardsConfig>,
): string[] {
  return Object.entries(configs).flatMap(([path, config]) =>
    layerDirs(io.probe, join(project, path), config),
  );
}

/**
 * Hashes every Python file in the project, under every name it is reachable
 * by. Layer packages are walked without skips, so a file hidden in a
 * pyvenv.cfg or node_modules directory inside a layer is still seen.
 *
 * @param io - walks the project and reads each file's bytes.
 * @param project - the real project root.
 * @param configs - the project's configs, from `projectConfigs`.
 * @returns SHA-256 hex digests, by project-relative path.
 * @throws when a file can't be read.
 */
export function projectManifest(
  io: SnapshotIo,
  project: string,
  configs: Record<string, InwardsConfig>,
): Record<string, string> {
  const manifest: Record<string, string> = {};
  for (const file of io.walk.pythonFiles([project], openDirs(io, project, configs))) {
    // Keyed by the path as walked, not the real one: a file reached through a
    // symlink into a layer is that layer's module under that name.
    manifest[posix(relative(project, file))] = createHash("sha256")
      .update(io.read.bytes(file))
      .digest("hex");
  }
  return manifest;
}

/**
 * Names a path relative to the project with forward slashes, on real paths.
 * On macOS the project is /private/var/... while a payload may say /var/...;
 * mixing the two spellings would give ../../var paths.
 *
 * @param probe - resolves real paths.
 * @param project - the real project root.
 * @param path - an absolute path inside the project.
 * @returns the project-relative path.
 */
export function projectPath(
  probe: Pick<PathProbe, "realpath">,
  project: string,
  path: string,
): string {
  return posix(relative(project, probe.realpath(path) ?? path));
}
