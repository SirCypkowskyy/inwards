/**
 * @file Runs FAPI003 `router-wiring` for a check: builds the FastAPI model and,
 * when a checked file holds a router or an `include_router`, the project's
 * app and router graph, then hands each checked file its findings before its
 * suppression comments apply. With FAPI003 off, nothing is read or parsed;
 * with it on, a file that doesn't mention FastAPI is never parsed for it.
 *
 * A per-edit check (the PostToolUse hook, the editor) keeps only the
 * one-file findings: wiring a new router into the app is a second edit, so
 * the graph's findings wait for the Stop gate. The graph is still built when
 * the file suppresses FAPI003, so the suppression counts as used; the
 * findings it would have reported are then dropped after the suppressions.
 */
import type { Parser } from "web-tree-sitter";
import type { InwardsConfig } from "../config/parse.ts";
import { ruleLevel } from "../config/rule-settings.ts";
import type { Diagnostic, SourceFile } from "../contracts/records.ts";
import type { ProjectIndex } from "../lookup/project-index.ts";
import { WiringGraph } from "../rules/fastapi/graph.ts";
import { FastApiModel } from "../rules/fastapi/model.ts";
import type { FastApiFile } from "../rules/fastapi/records.ts";
import { checkFileWiring, checkGraphWiring } from "../rules/fastapi/router-wiring.ts";
import { mentionsSuppression } from "../rules/suppression-comment.ts";
import type { Confirmed } from "./stages.ts";

/** FAPI003's findings for a check, and the ones to drop after suppressions. */
export interface Wired {
  /** Findings by checked file path. */
  readonly found: ReadonlyMap<string, Diagnostic[]>;
  /** Findings a per-edit check computes only so a suppression of them counts as used. */
  readonly hidden: ReadonlySet<Diagnostic>;
}

const NONE: Wired = { found: new Map(), hidden: new Set() };

/**
 * Finds FAPI003's findings in the checked files.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param project - the project's module index; the graph reads every
 *   FastAPI file of the project through it, not just the checked ones.
 * @param files - the checked files, with normalised text.
 * @param options - the check's config and mode.
 * @param options.config - the project's config.
 * @param options.edit - true for a per-edit check, which keeps only one-file findings.
 * @returns the findings by file, and the ones to drop after suppressions.
 */
export function routerWiring(
  parser: Parser,
  project: ProjectIndex,
  files: readonly SourceFile[],
  { config, edit }: { config: InwardsConfig; edit: boolean },
): Wired {
  if (ruleLevel("FAPI003", config.rules) === "off") {
    return NONE;
  }
  const settings = config.rules?.options?.["router-wiring"] ?? {};
  const model = new FastApiModel(parser, project);
  try {
    const own = files.flatMap((src) => {
      const m = model.fileModel(src);
      return m === null ? [] : [{ src, m }];
    });
    const found = new Map<string, Diagnostic[]>();
    for (const { src, m } of own) {
      found.set(src.path, checkFileWiring(m, src, settings));
    }
    const wired = own.some(({ m }) => m.objects.length > 0 || m.wiring.length > 0);
    const suppressed = own.some(
      ({ src }) => mentionsSuppression(src.text) && src.text.includes("FAPI003"),
    );
    if (!wired || (edit && !suppressed)) {
      return { found, hidden: new Set() };
    }
    const checked = new Map(own.map(({ src }) => [src.path, src]));
    const graph = WiringGraph.build(model, projectFiles(model, project, own), project.ownerOf);
    const extra = checkGraphWiring(graph, checked, settings);
    for (const d of extra) {
      found.set(d.file, [...(found.get(d.file) ?? []), d]);
    }
    return { found, hidden: edit ? new Set(extra) : new Set() };
  } finally {
    model.dispose();
  }
}

/**
 * Collects every FastAPI file of the project: the checked ones as checked,
 * the rest through the index.
 *
 * @param model - the check's model.
 * @param project - the module index.
 * @param own - the checked files that mention FastAPI, with their records.
 * @returns the records of every project file that passes the pre-filter.
 */
function projectFiles(
  model: FastApiModel,
  project: ProjectIndex,
  own: readonly { src: SourceFile; m: FastApiFile }[],
): FastApiFile[] {
  const checked = new Set(own.map(({ src }) => src.module));
  const rest = [...project.modules]
    .filter((module) => !checked.has(module))
    .flatMap((module) => model.moduleModel(module) ?? []);
  return [...own.map(({ m }) => m), ...rest];
}

/**
 * Adds a file's FAPI003 findings to its confirmed ones, in source order.
 *
 * @param confirmed - the file's confirmed findings.
 * @param src - the file.
 * @param wired - FAPI003's findings for the check.
 * @returns the confirmed findings with the file's FAPI003 ones.
 */
export function withWiring(confirmed: Confirmed, src: SourceFile, wired: Wired): Confirmed {
  const extra = wired.found.get(src.path) ?? [];
  if (extra.length === 0) {
    return confirmed;
  }
  const found = [...confirmed.found, ...extra].sort(
    (a, b) => a.line - b.line || a.column - b.column,
  );
  return { ...confirmed, found };
}
