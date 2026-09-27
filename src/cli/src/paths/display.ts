/**
 * How report paths are shown to people and agents. On macOS `/var` is a link
 * to `/private/var`, so a report can mix two spellings of the project root
 * and print `../../private/var/...`. These helpers respell the part of a path
 * up to the project root as the real root, and only when the result still
 * opens the same file.
 *
 * Display only. The hooks' start identity (`session/start-identity.ts`)
 * reads a report's own paths against its own base and must never see these
 * (#175): mixing the two reopens the symlink bypasses of #165 and #171.
 */
import { dirname, join, relative, resolve } from "node:path";
import type { Diagnostic, Report } from "@inwards/core";
import type { PathProbe } from "../platform/contracts.ts";
import { posix } from "./lexical.ts";
import { physicalRealpath } from "./physical.ts";

/** The `../` segments a forward-slash path starts with. */
const CLIMB = /^(?:\.\.\/)*/u;

/**
 * Shows a report path from the project, whichever way the base and the file
 * spell the project root. The part of each side up to the project root is
 * respelled as the real root; below the root both stay as written, so an
 * alias directory keeps its name. A path that doesn't climb, or that climbs
 * no less when respelled, is left as it is, and so is one that opened from
 * the base names another file: `relative` reads the base as text, but
 * through a link below the root the OS resolves `..` from the link's target.
 *
 * @param probe - resolves real paths.
 * @param project - the real project root.
 * @param base - the directory the report's paths are relative to.
 * @param file - a report path, with forward slashes.
 * @returns the path to show, with forward slashes.
 */
function shownPath(
  probe: Pick<PathProbe, "realpath">,
  project: string,
  base: string,
  file: string,
): string {
  if (!file.startsWith("../")) {
    return file;
  }
  const shown = posix(
    relative(underRoot(probe, project, base), underRoot(probe, project, resolve(base, file))),
  );
  const target = probe.realpath(resolve(base, file));
  const same = target !== undefined && physicalRealpath(probe, base, shown) === target;
  return same && climb(shown) < climb(file) ? shown : file;
}

/**
 * Measures how far a path climbs before it goes down.
 *
 * @param path - a relative path, with forward slashes.
 * @returns the length of its leading `../` run.
 */
function climb(path: string): number {
  return CLIMB.exec(path)?.[0].length ?? 0;
}

/**
 * Respells a path's way into the project as the real project root: the
 * outermost directory on it (itself included) whose real path is the root
 * is replaced by the root, and the rest is kept as written.
 *
 * @param probe - resolves real paths.
 * @param project - the real project root.
 * @param path - an absolute path.
 * @returns the path under the real root, or unchanged when it isn't in the project.
 */
function underRoot(probe: Pick<PathProbe, "realpath">, project: string, path: string): string {
  const chain: string[] = [];
  for (let dir = path; chain.at(-1) !== dir; dir = dirname(dir)) {
    chain.push(dir);
  }
  const root = chain.reverse().find((dir) => probe.realpath(dir) === project);
  return root === undefined ? path : join(project, relative(root, path));
}

/**
 * Copies findings with their paths as `shownPath` shows them, for output.
 *
 * @param probe - resolves real paths.
 * @param project - the real project root.
 * @param base - the directory their paths are relative to.
 * @param diagnostics - the findings, whose own paths stay untouched.
 * @returns new findings with the paths to show.
 */
export function shownDiagnostics(
  probe: Pick<PathProbe, "realpath">,
  project: string,
  base: string,
  diagnostics: readonly Diagnostic[],
): Diagnostic[] {
  return diagnostics.map((d) => ({ ...d, file: shownPath(probe, project, base, d.file) }));
}

/**
 * Copies a report with every path as `shownPath` shows it, for output: the
 * findings and the suppressed ones SARIF lists.
 *
 * @param probe - resolves real paths.
 * @param project - the real project root.
 * @param base - the directory its paths are relative to.
 * @param report - the report, whose own paths stay untouched.
 * @returns a new report with the paths to show.
 */
export function shownReport(
  probe: Pick<PathProbe, "realpath">,
  project: string,
  base: string,
  report: Report,
): Report {
  const suppressed = report.suppressed?.map((s) => ({
    ...s,
    diagnostic: { ...s.diagnostic, file: shownPath(probe, project, base, s.diagnostic.file) },
  }));
  return {
    ...report,
    diagnostics: shownDiagnostics(probe, project, base, report.diagnostics),
    ...(suppressed === undefined ? {} : { suppressed }),
  };
}
