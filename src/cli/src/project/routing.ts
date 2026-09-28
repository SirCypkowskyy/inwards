/**
 * @file Which config checks which paths, for `inwards check` without
 * `--config` (#57). Each named path goes to the nearest pyproject.toml with
 * `[tool.inwards]` above it; at a uv workspace root, every member with its
 * own `[tool.inwards]` is checked with that config, and a config above the
 * members leaves their directories to them. It only plans: the command runs
 * the checks and merges the reports. Files come in through the injected
 * probe, reader and TOML parser.
 */
import { dirname, join, resolve } from "node:path";
import { declaresInwards, inwardsTable } from "@inwards/core";
import { isRecord } from "../json/guards.ts";
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
 * nearest config, and a directory holding such members also to theirs. The
 * workspace is looked for from each path (or the working directory), so the
 * answer doesn't depend on where the command runs.
 *
 * @param io - probes paths, reads pyproject.toml files and parses TOML.
 * @param cwd - the working directory.
 * @param targets - absolute files or directories; undefined for a whole run.
 * @returns the checks, sorted by config path, and what they leave out.
 * @throws when a pyproject.toml on the way can't be read.
 */
export function planCheck(io: RoutingIo, cwd: string, targets: string[] | undefined): CheckPlan {
  const building: Building = { units: new Map(), skipped: new Set(), unrouted: [] };
  for (const target of targets ?? [cwd]) {
    planTarget(io, target, targets === undefined, building);
  }
  const sorted = [...building.units.values()].sort((a, b) => (a.config < b.config ? -1 : 1));
  return { units: sorted, skipped: [...building.skipped].sort(), unrouted: building.unrouted };
}

/** A plan being built, by config path. */
interface Building {
  units: Map<string, CheckUnit>;
  skipped: Set<string>;
  unrouted: string[];
}

/**
 * Adds one path's checks to a plan: the configured members under it, the
 * nearest config above it (not one above the workspace root when members
 * are checked), and the members no config covers.
 *
 * @param io - probes paths and reads pyproject.toml files.
 * @param target - an absolute file or directory; the working directory for a whole run.
 * @param whole - true for a run without paths, whose checks cover whole roots.
 * @param building - the plan so far; changed in place.
 * @throws when a pyproject.toml on the way can't be read.
 */
function planTarget(io: RoutingIo, target: string, whole: boolean, building: Building): void {
  const isDir = io.probe.kind(target) === "dir";
  const dir = isDir ? target : dirname(target);
  const workspace = workspaceOf(io, dir);
  const inner = isDir ? workspace.configured.filter((m) => isInside(target, m)) : [];
  for (const member of inner) {
    const unit = unitOf(building.units, join(member, "pyproject.toml"), whole);
    unit.targets?.push(member);
    unit.exclude.push(...nestedIn(member, workspace.configured));
  }
  const found = findConfig(io, dir);
  // A config above the workspace root is another project's: it would index the members by path.
  const foreign =
    found !== undefined && inner.length > 0 && isInside(dirname(found), workspace.root);
  const nearest = foreign ? undefined : found;
  if (nearest !== undefined) {
    const unit = unitOf(building.units, nearest, whole);
    unit.targets?.push(target);
    unit.exclude.push(...inner);
  } else if (inner.length === 0 && !whole) {
    building.unrouted.push(target);
  }
  if (inner.length > 0) {
    for (const member of leftOut(io, { target, nearest, workspace })) {
      building.skipped.add(member);
    }
  }
}

/** A uv workspace as planning sees it: its root, its members, and those with a config. */
interface Workspace {
  root: string;
  members: string[];
  configured: string[];
}

/**
 * Finds the uv workspace at or above a directory, and which members have `[tool.inwards]`.
 *
 * @param io - reads the pyproject.toml files.
 * @param dir - the directory to look from.
 * @returns the workspace; outside one, `dir` as the root and no members.
 * @throws when a pyproject.toml on the way can't be read.
 */
function workspaceOf(io: RoutingIo, dir: string): Workspace {
  const found = workspaceMembers(io, dir);
  const members = found?.members ?? [];
  return {
    root: found?.dir ?? dir,
    members,
    configured: members.filter((member) => hasInwards(io, member)),
  };
}

/**
 * Lists the configured members nested inside another member, which their
 * own config checks, so the outer member leaves them out.
 *
 * @param member - a member directory.
 * @param configured - every configured member directory.
 * @returns those strictly inside `member`.
 */
function nestedIn(member: string, configured: readonly string[]): string[] {
  return configured.filter((other) => isInside(member, other));
}

/**
 * Lists the members under a named directory that no config checks: they
 * have no `[tool.inwards]`, don't sit inside a configured member, and lie
 * outside the root of the config that checks the directory, if any.
 *
 * @param io - reads the checking config's `root`.
 * @param where - the directory, its config and its workspace.
 * @param where.target - the named directory (or the working directory).
 * @param where.nearest - the config that checks it, if one does.
 * @param where.workspace - the workspace around it.
 * @returns the member directories left out.
 * @throws when the config can't be read.
 */
function leftOut(
  io: RoutingIo,
  {
    target,
    nearest,
    workspace,
  }: { target: string; nearest: string | undefined; workspace: Workspace },
): string[] {
  const root = nearest === undefined ? undefined : configRoot(io, nearest);
  return workspace.members.filter(
    (member) =>
      isInside(target, member) &&
      !workspace.configured.includes(member) &&
      !workspace.configured.some((dir) => isInside(dir, member)) &&
      !(root !== undefined && (member === root || isInside(root, member))),
  );
}

/**
 * Reads where a config's module names start, from its `root` key.
 *
 * @param io - reads the pyproject.toml.
 * @param config - the pyproject.toml's absolute path.
 * @returns the absolute root directory; the config's own directory by default.
 * @throws when the file can't be read.
 */
function configRoot(io: RoutingIo, config: string): string {
  const table = inwardsTable(io.read.text(config));
  const root = isRecord(table) ? table["root"] : undefined;
  return resolve(dirname(config), typeof root === "string" ? root : ".");
}

/**
 * Finds a config's check in a plan being built, adding it when it is new.
 *
 * @param units - the checks so far, by config path; changed in place.
 * @param config - the config's absolute path.
 * @param whole - true for a run without paths: the check covers its whole root.
 * @returns the config's check.
 */
function unitOf(units: Map<string, CheckUnit>, config: string, whole: boolean): CheckUnit {
  const found = units.get(config) ?? { config, targets: whole ? undefined : [], exclude: [] };
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
