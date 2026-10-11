/**
 * @file Reading the files `[tool.inwards].diagrams` names, for INW017
 * (ADR-045): a plain entry is one file next to the config, a glob is walked
 * from its directory before the first wildcard with the CLI's usual skip
 * rules. The engine decides what the diagrams say (`checkDiagrams`); this
 * module only finds and reads them, through the injected `ProjectIo`, and
 * only when the rule is on, so a project that doesn't use diagrams pays
 * nothing.
 */
import { dirname, join, relative } from "node:path";
import {
  type DiagramSource,
  diagramBase,
  diagramMatches,
  type InwardsConfig,
  ruleLevel,
} from "@inwards/core";
import { posix } from "../paths/lexical.ts";
import type { ProjectIo } from "./contracts.ts";

/** The diagram files a config names, and the entries that named none. */
export interface ListedDiagrams {
  sources: DiagramSource[];
  unmatched: string[];
}

/**
 * Finds and reads the diagram files a config lists. Nothing is read when the
 * config lists none or INW017 is off.
 *
 * @param io - probes, walks and reads the project.
 * @param configPath - absolute path of the pyproject.toml; entries are relative to its directory.
 * @param config - its parsed config.
 * @param base - directory that report paths are made relative to.
 * @returns each matched file once, in path order, with its report path, and
 *   the entries that matched no file.
 * @throws when a matched file can't be read.
 */
export function readDiagrams(
  io: Pick<ProjectIo, "probe" | "walk" | "read">,
  configPath: string,
  config: InwardsConfig,
  base: string,
): ListedDiagrams {
  const entries = config.diagrams ?? [];
  if (entries.length === 0 || ruleLevel("INW017", config.rules) === "off") {
    return { sources: [], unmatched: [] };
  }
  const dir = dirname(configPath);
  const found = new Set<string>();
  const unmatched: string[] = [];
  for (const entry of entries) {
    const files = filesFor(io, dir, entry);
    if (files.length === 0) {
      unmatched.push(entry);
    }
    for (const file of files) {
      found.add(file);
    }
  }
  const sources = [...found].sort().map((abs) => ({
    path: posix(relative(base, abs)),
    text: io.read.text(abs),
  }));
  return { sources, unmatched };
}

/**
 * Lists the files one entry names.
 *
 * @param io - probes and walks the project.
 * @param dir - the config file's directory.
 * @param entry - a `diagrams` entry.
 * @returns the absolute paths of the files it matches.
 */
function filesFor(io: Pick<ProjectIo, "probe" | "walk">, dir: string, entry: string): string[] {
  const start = diagramBase(entry);
  if (start === undefined) {
    const abs = join(dir, entry);
    return io.probe.kind(abs) === "file" ? [abs] : [];
  }
  const root = join(dir, start);
  if (io.probe.kind(root) !== "dir") {
    return [];
  }
  return io.walk
    .files([root], () => true)
    .filter((abs) => diagramMatches(entry, posix(relative(dir, abs))));
}
