/**
 * What a project looks like right now, as the session start and the Stop gate
 * compare it: every `[tool.inwards]` table, a content hash per Python file,
 * and the git HEAD. Paths are project-relative with forward slashes: real
 * paths for configs, the paths as walked for the manifest.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ConfigError, declaresInwards, type InwardsConfig, parseConfig } from "@inwards/core";
import { collectFiles, collectPythonFiles } from "./files.ts";
import { posix, realpath } from "./paths.ts";
import { layerDirs } from "./project.ts";

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
 * @param project - the real project root.
 * @returns the valid configs and the paths of invalid ones.
 */
export function projectConfigs(project: string): ProjectConfigs {
  const first = readConfigs(project, collectFiles([project], isPyproject));
  const open = openDirs(project, first.valid);
  // ponytail: a second walk, over layer packages only; one walk if SessionStart gets slow.
  const paths = [...collectFiles([project], isPyproject), ...collectFiles(open, isPyproject, open)];
  return readConfigs(project, [...new Set(paths)]);
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
 * @param project - the real project root.
 * @param paths - absolute pyproject.toml paths.
 * @returns the valid configs and the paths of invalid ones, sorted.
 */
function readConfigs(project: string, paths: string[]): ProjectConfigs {
  const found: ProjectConfigs = { valid: {}, invalid: [], found: {} };
  for (const path of paths.sort()) {
    const text = readFileSync(path, "utf8");
    const rel = projectPath(project, path);
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
 * @param project - the real project root.
 * @param configs - valid configs by project-relative path.
 * @returns the directories.
 */
function openDirs(project: string, configs: Record<string, InwardsConfig>): string[] {
  return Object.entries(configs).flatMap(([path, config]) =>
    layerDirs(join(project, path), config),
  );
}

/**
 * Hashes every Python file in the project, under every name it is reachable by. Layer packages are walked without
 * skips, so a file hidden in a pyvenv.cfg or node_modules directory inside a
 * layer is still seen.
 *
 * @param project - the real project root.
 * @param configs - the project's configs, from `projectConfigs`.
 * @returns SHA-256 hex digests, by project-relative path.
 */
export function projectManifest(
  project: string,
  configs: Record<string, InwardsConfig>,
): Record<string, string> {
  const manifest: Record<string, string> = {};
  for (const file of collectPythonFiles([project], openDirs(project, configs))) {
    // Keyed by the path as walked, not the real one: a file reached through a
    // symlink into a layer is that layer's module under that name.
    manifest[posix(relative(project, file))] = createHash("sha256")
      .update(readFileSync(file))
      .digest("hex");
  }
  return manifest;
}

/**
 * Runs git in the project.
 *
 * @param project - the real project root.
 * @param args - git arguments.
 * @returns stdout, or undefined when git fails or isn't installed.
 */
export function git(project: string, args: string[]): string | undefined {
  const run = spawnSync("git", args, { cwd: project, encoding: "utf8" });
  return run.status === 0 ? run.stdout : undefined;
}

/**
 * Names a path relative to the project with forward slashes, on real paths.
 * On macOS the project is /private/var/... while a payload may say /var/...;
 * mixing the two spellings would give ../../var paths.
 *
 * @param project - the real project root.
 * @param path - an absolute path inside the project.
 * @returns the project-relative path.
 */
export function projectPath(project: string, path: string): string {
  return posix(relative(project, realpath(path) ?? path));
}
