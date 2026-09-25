/**
 * What a project looks like right now, as the session start and the Stop gate
 * compare it: every `[tool.inwards]` table, a content hash per Python file,
 * and the git HEAD. All paths are project-relative, forward-slash real paths.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ConfigError, declaresInwards, type InwardsConfig, parseConfig } from "@inwards/core";
import { collectFiles, collectPythonFiles } from "./files.ts";
import { posix, realpath } from "./paths.ts";
import { layerDirs } from "./project.ts";

/**
 * Reads every valid `[tool.inwards]` table in the project, monorepo packages
 * included. An invalid one (say, a test fixture) is left out: it governs
 * nothing, since any check under it stops with a config error. Breaking a
 * valid table still shows, as that table disappears from the snapshot.
 *
 * @param project - the real project root.
 * @returns the parsed configs, by project-relative pyproject.toml path.
 */
export function projectConfigs(project: string): Record<string, InwardsConfig> {
  const configs: Record<string, InwardsConfig> = {};
  for (const path of collectFiles([project], (name) => name === "pyproject.toml")) {
    const text = readFileSync(path, "utf8");
    try {
      if (declaresInwards(text)) {
        configs[projectPath(project, path)] = parseConfig(text);
      }
    } catch (err) {
      if (!(err instanceof ConfigError)) {
        throw err;
      }
    }
  }
  return configs;
}

/**
 * Hashes every Python file in the project. Layer packages are walked without
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
  const open = Object.entries(configs).flatMap(([path, config]) =>
    layerDirs(join(project, path), config),
  );
  for (const file of collectPythonFiles([project], open)) {
    manifest[projectPath(project, file)] = createHash("sha256")
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
