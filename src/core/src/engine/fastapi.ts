/**
 * @file Runs the FAPI rules for a check: builds the FastAPI model once, reads
 * the checked files through it, and hands each one its FAPI001, FAPI002 and
 * FAPI003 findings before its suppression comments apply. The project lookups
 * (`FastApiProject`: handlers, classes, the app and router graph) are shared
 * by all three and read the rest of the project only when a rule asks. With
 * every FAPI rule off, nothing is read or parsed; a file that doesn't mention
 * FastAPI is never parsed for them, and neither is one INW000 refuses.
 *
 * A per-edit check (the PostToolUse hook, the editor) keeps only FAPI003's
 * one-file findings: wiring a new router into the app is a second edit, so the
 * graph's findings wait for the Stop gate. The graph is still built when the
 * file suppresses FAPI003, so the suppression counts as used; the findings it
 * would have reported are then dropped after the suppressions. In a per-edit
 * check, FAPI002 builds the graph only for a route that has a code its own
 * decorator and router don't declare.
 */
import type { Parser } from "web-tree-sitter";
import type { InwardsConfig } from "../config/parse.ts";
import { ruleLevel } from "../config/rule-settings.ts";
import type { Diagnostic, SourceFile } from "../contracts/records.ts";
import type { ProjectIndex } from "../lookup/project-index.ts";
import { checkEndpoints, endpointRulesOn } from "../rules/fastapi/check.ts";
import { FastApiModel } from "../rules/fastapi/model.ts";
import { FastApiProject } from "../rules/fastapi/project.ts";
import { checkFileWiring, checkGraphWiring } from "../rules/fastapi/router-wiring.ts";
import { mentionsSuppression } from "../rules/suppression-comment.ts";
import { checkEncoding } from "../rules/unsupported-encoding.ts";
import type { Confirmed } from "./stages.ts";

/** The FAPI findings for a check, and the ones to drop after suppressions. */
export interface FastApiFound {
  /** Findings by checked file path. */
  readonly found: ReadonlyMap<string, Diagnostic[]>;
  /** Findings a per-edit check computes only so a suppression of them counts as used. */
  readonly hidden: ReadonlySet<Diagnostic>;
}

const NONE: FastApiFound = { found: new Map(), hidden: new Set() };

/**
 * Finds the FAPI rules' findings in the checked files.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param project - the project's module index; the lookups read other
 *   FastAPI files of the project through it when a rule asks.
 * @param files - the checked files, with normalised text.
 * @param options - the check's config and mode.
 * @param options.config - the project's config.
 * @param options.edit - true for a per-edit check.
 * @returns the findings by file, and the ones to drop after suppressions.
 */
export function fastApiFindings(
  parser: Parser,
  project: ProjectIndex,
  files: readonly SourceFile[],
  { config, edit }: { config: InwardsConfig; edit: boolean },
): FastApiFound {
  const { rules } = config;
  const wiringOn = ruleLevel("FAPI003", rules) !== "off";
  if (!(wiringOn || endpointRulesOn(rules))) {
    return NONE;
  }
  const model = new FastApiModel(parser, project);
  try {
    const own = files.flatMap((src) => {
      const m = checkEncoding(src) ? null : model.fileModel(src);
      return m === null ? [] : [{ src, m }];
    });
    const scope = new FastApiProject(
      model,
      project,
      own.map(({ m }) => m),
      edit,
    );
    const found = new Map<string, Diagnostic[]>();
    const settings = rules?.options?.["router-wiring"] ?? {};
    for (const { src, m } of own) {
      const wiring = wiringOn ? checkFileWiring(m, src, settings) : [];
      found.set(src.path, [...wiring, ...checkEndpoints(src, m, scope, rules)]);
    }
    const wired = own.some(({ m }) => m.objects.length > 0 || m.wiring.length > 0);
    const suppressed = own.some(
      ({ src }) => mentionsSuppression(src.text) && src.text.includes("FAPI003"),
    );
    if (!(wiringOn && wired) || (edit && !suppressed)) {
      return { found, hidden: new Set() };
    }
    const checked = new Map(own.map(({ src }) => [src.path, src]));
    const extra = checkGraphWiring(scope.graph(), checked, settings);
    for (const d of extra) {
      found.set(d.file, [...(found.get(d.file) ?? []), d]);
    }
    return { found, hidden: edit ? new Set(extra) : new Set() };
  } finally {
    model.dispose();
  }
}

/**
 * Adds a file's FAPI findings to its confirmed ones, in source order.
 *
 * @param confirmed - the file's confirmed findings.
 * @param src - the file.
 * @param fapi - the FAPI findings for the check.
 * @returns the confirmed findings with the file's FAPI ones.
 */
export function withFastApi(confirmed: Confirmed, src: SourceFile, fapi: FastApiFound): Confirmed {
  const extra = fapi.found.get(src.path) ?? [];
  if (extra.length === 0) {
    return confirmed;
  }
  const found = [...confirmed.found, ...extra].sort(
    (a, b) => a.line - b.line || a.column - b.column,
  );
  return { ...confirmed, found };
}
