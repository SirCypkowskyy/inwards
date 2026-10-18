/**
 * @file The checks only a whole-project run of `inwards check` makes, besides
 * the engine's own pass over the files: the config against the modules found
 * (INW006, INW007, rule options), nested projects and symlinks in layers
 * (INW006), the marked diagrams `diagrams` lists (INW017, INW018) and the required
 * members of every shaped package (INW008). All reading goes through the
 * injected `ProjectIo`; the engine decides every finding.
 */
import { relative } from "node:path";
import {
  checkDiagrams,
  checkLinks,
  checkNestedProjects,
  checkPrefixes,
  checkRequired,
  checkRuleOptions,
  checkSelectors,
  type Diagnostic,
  type InwardsConfig,
  membersFrom,
  type ProjectFiles,
  packagesOf,
  rootPathOf,
  type SourceFile,
} from "@inwards/core";
import { posix } from "../shared/paths/lexical.ts";
import type { ListedDiagrams } from "./_diagrams.ts";
import { layerLinks, linksUnder } from "./_links.ts";
import type { ProjectIo } from "./contracts.ts";

/** What these checks need of a loaded project. */
interface WholeProject {
  config: InwardsConfig;
  /** The pyproject.toml, as found and as text. */
  configPath: string;
  configText: string;
  /** The config root as written. */
  lexicalRoot: string;
}

/**
 * Runs the checks only a whole-project run makes, besides the engine's own:
 * the layer prefixes, shape selectors and rule options against the modules
 * found (INW006, INW007), nested projects and symlinks in layers (INW006),
 * the marked diagrams `diagrams` lists (INW017, INW018), and every shaped
 * package's required members (INW008).
 *
 * @param io - probes, walks and reads the project.
 * @param project - the loaded project.
 * @param run - what the run found.
 * @param run.files - every checked source file.
 * @param run.listing - the listing the index was built on.
 * @param run.base - directory that report paths are made relative to.
 * @param run.shownRoot - the config root as report paths show it.
 * @param run.diagrams - the diagram files `readDiagrams` read, and the entries that matched none.
 * @returns the findings about the config and the diagrams (reported first),
 *   and the missing members (reported last).
 */
export function wholeProjectFindings(
  io: ProjectIo,
  project: WholeProject,
  {
    files,
    listing,
    base,
    shownRoot,
    diagrams,
  }: {
    files: readonly SourceFile[];
    listing: ProjectFiles;
    base: string;
    shownRoot: string;
    diagrams: ListedDiagrams;
  },
): { config: Diagnostic[]; required: Diagnostic[] } {
  const modules = new Set(files.map((file) => file.module));
  const pyproject = { path: posix(relative(base, project.configPath)), text: project.configText };
  const paths = files.map(rootPathOf);
  const packages = packagesOf(paths);
  return {
    config: [
      ...checkPrefixes(project.config, modules, pyproject),
      ...checkSelectors(project.config, packages, pyproject),
      ...checkRuleOptions(project.config.rules, pyproject),
      ...checkNestedProjects(project.config, pyproject, { modules, kind: listing.kind, shownRoot }),
      ...checkLinks(project.config, {
        links: linksUnder(
          io.probe,
          layerLinks(io, project.configPath, project.config),
          project.lexicalRoot,
          project.config,
        ),
        modules,
        shownRoot,
      }),
      ...checkDiagrams(project.config, { modules, ...diagrams, configFile: pyproject }),
    ],
    required: checkRequired(project.config, packages, membersFrom(paths), shownRoot),
  };
}
