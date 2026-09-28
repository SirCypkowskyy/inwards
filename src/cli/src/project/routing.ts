/**
 * @file Which config checks which paths, for `inwards check` without
 * `--config` (#57). Each named path goes to the nearest pyproject.toml with
 * `[tool.inwards]` above it; at a uv workspace root, every member with its
 * own `[tool.inwards]` is checked with that config, and a config above the
 * members leaves their directories to them. It only plans: the command runs
 * the checks and merges the reports. Files come in through the injected
 * probe, reader and TOML parser.
 */
import { dirname, join } from "node:path";
import { declaresInwards } from "@inwards/core";
import { isInside } from "../paths/lexical.ts";
import { findConfig } from "./config-discovery.ts";
import type { ProjectIo } from "./contracts.ts";
import { workspaceMembers } from "./workspace.ts";

/** What planning reads: path kinds, real paths, files, directory listings and TOML. */
type RoutingIo = Pick<ProjectIo, "probe" | "read" | "toml">;

/** One check to run: a config, what it checks, and what it leaves to other configs. */
export interface CheckUnit {
  /** Absolute path of the pyproject.toml. */
  config: string;
  /** Absolute files or directories; undefined means the whole config root. */
  targets: string[] | undefined;
  /** Member directories under this config that their own config checks. */
  exclude: string[];
}

/** The checks to run, and what no config covers. */
export interface CheckPlan {
  units: CheckUnit[];
  /** uv workspace members with no `[tool.inwards]`, left out of a workspace run. */
  skipped: string[];
  /** Named paths with no config above them. */
  unrouted: string[];
}

/**
 * Plans the checks for `inwards check` without `--config`. Without paths,
 * a directory that holds uv workspace members with their own `[tool.inwards]`
 * gets one whole-project check per such member, plus the nearest config
 * above them (if any) with the members' directories left out; anywhere else
 * it is the nearest config, as before. With paths, each one goes to its
 * nearest config, and a directory holding such members also to theirs.
 *
 * @param io - probes paths, reads pyproject.toml files and parses TOML.
 * @param cwd - the working directory, where the workspace is looked for.
 * @param targets - absolute files or directories; undefined for a whole run.
 * @returns the checks, sorted by config path, and what they leave out.
 * @throws when a pyproject.toml on the way can't be read.
 */
export function planCheck(io: RoutingIo, cwd: string, targets: string[] | undefined): CheckPlan {
  const workspace = workspaceMembers(io, cwd);
  const members = workspace?.members ?? [];
  const configured = members.filter((dir) => hasInwards(io, dir));
  const plan =
    targets === undefined
      ? planWhole(io, cwd, { root: workspace?.dir ?? cwd, members, configured })
      : planTargets(io, targets, configured);
  plan.units.sort((a, b) => (a.config < b.config ? -1 : 1));
  return plan;
}

/**
 * Plans a run without paths: every configured member below the working
 * directory, and the nearest config above it with those members left out.
 * With members to check, a config above the workspace root is another
 * project's and is not checked.
 *
 * @param io - probes and reads pyproject.toml files.
 * @param cwd - the working directory.
 * @param workspace - the uv workspace around it.
 * @param workspace.root - the directory whose pyproject.toml has `[tool.uv.workspace]`.
 * @param workspace.members - every member directory.
 * @param workspace.configured - the members whose pyproject.toml has `[tool.inwards]`.
 * @returns the checks, and the members below `cwd` left out for want of a config.
 * @throws when a pyproject.toml on the way can't be read.
 */
function planWhole(
  io: RoutingIo,
  cwd: string,
  { root, members, configured }: { root: string; members: string[]; configured: string[] },
): CheckPlan {
  const below = configured.filter((dir) => isInside(cwd, dir));
  const units: CheckUnit[] = below.map((dir) => ({
    config: join(dir, "pyproject.toml"),
    targets: undefined,
    exclude: [],
  }));
  // Its directory is at or above cwd, so it is never one of the members below.
  const nearest = findConfig(io, cwd);
  if (nearest !== undefined && !(below.length > 0 && isInside(dirname(nearest), root))) {
    units.push({ config: nearest, targets: undefined, exclude: below });
  }
  const skipped =
    below.length === 0
      ? []
      : members.filter((dir) => isInside(cwd, dir) && !configured.includes(dir));
  return { units, skipped, unrouted: [] };
}

/**
 * Plans a run over named paths: each goes to its nearest config, and a
 * directory that holds configured members also to each of theirs, which the
 * nearest config then leaves out.
 *
 * @param io - probes and reads pyproject.toml files.
 * @param targets - absolute files or directories.
 * @param configured - the workspace members whose pyproject.toml has `[tool.inwards]`.
 * @returns the checks, and the paths no config covers.
 * @throws when a pyproject.toml on the way can't be read.
 */
function planTargets(io: RoutingIo, targets: string[], configured: string[]): CheckPlan {
  const units = new Map<string, NamedUnit>();
  const unrouted: string[] = [];
  for (const target of targets) {
    const isDir = io.probe.kind(target) === "dir";
    const inner = isDir ? configured.filter((dir) => isInside(target, dir)) : [];
    for (const dir of inner) {
      unitOf(units, join(dir, "pyproject.toml")).targets.push(dir);
    }
    const nearest = findConfig(io, isDir ? target : dirname(target));
    if (nearest !== undefined) {
      const unit = unitOf(units, nearest);
      unit.targets.push(target);
      unit.exclude.push(...inner);
    } else if (inner.length === 0) {
      unrouted.push(target);
    }
  }
  return { units: [...units.values()], skipped: [], unrouted };
}

/** A check over named paths, which always has its targets. */
type NamedUnit = CheckUnit & { targets: string[] };

/**
 * Finds a config's check in a plan being built, adding it when it is new.
 *
 * @param units - the checks so far, by config path; changed in place.
 * @param config - the config's absolute path.
 * @returns the config's check.
 */
function unitOf(units: Map<string, NamedUnit>, config: string): NamedUnit {
  const found = units.get(config) ?? { config, targets: [], exclude: [] };
  units.set(config, found);
  return found;
}

/**
 * Tells whether a directory's pyproject.toml declares `[tool.inwards]`.
 *
 * @param io - probes and reads the file.
 * @param dir - a workspace member directory.
 * @returns true when the file exists and has the table.
 * @throws when the file exists but can't be read.
 */
function hasInwards(io: RoutingIo, dir: string): boolean {
  const path = join(dir, "pyproject.toml");
  return io.probe.kind(path) === "file" && declaresInwards(io.read.text(path));
}
