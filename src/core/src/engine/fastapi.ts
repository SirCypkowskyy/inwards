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
import { type RuleOptions, ruleLevel } from "../config/rule-settings.ts";
import type { Diagnostic, SourceFile } from "../contracts/records.ts";
import type { ProjectIndex } from "../lookup/project-index.ts";
import { checkEndpoints, endpointRulesOn } from "../rules/fastapi/check.ts";
import { FastApiModel } from "../rules/fastapi/model.ts";
import { FastApiProject } from "../rules/fastapi/project.ts";
import type { FastApiFile } from "../rules/fastapi/records.ts";
import { checkFileShadowing, checkGraphShadowing } from "../rules/fastapi/route-shadowing.ts";
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
  const shadowOn = ruleLevel("FAPI005", rules) !== "off";
  if (!(wiringOn || shadowOn || endpointRulesOn(rules))) {
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
      const shadowing = shadowOn && edit ? checkFileShadowing(m, src, scope) : [];
      found.set(src.path, [...wiring, ...checkEndpoints(src, m, scope, rules), ...shadowing]);
    }
    const extra = graphFindings(scope, own, { edit, wiringOn, shadowOn, settings }, found);
    if (extra.length === 0) {
      return { found, hidden: new Set() };
    }
    for (const d of extra) {
      found.set(d.file, [...(found.get(d.file) ?? []), d]);
    }
    return { found, hidden: edit ? new Set(extra) : new Set() };
  } finally {
    model.dispose();
  }
}

/** What decides which whole-project FAPI rules run in a check. */
interface GraphRules {
  readonly edit: boolean;
  readonly wiringOn: boolean;
  readonly shadowOn: boolean;
  readonly settings: RuleOptions;
}

/**
 * Tells whether a whole-project rule needs its graph findings in this check.
 *
 * @param own - the checked files that mention FastAPI.
 * @param rule - the rule's state.
 * @param rule.on - true when the rule is on.
 * @param rule.edit - true for a per-edit check.
 * @param rule.code - the rule's code, which an inline suppression names.
 * @param rule.present - true when the checked files hold something the rule reads.
 * @returns true when the rule is on, has something to read, and the check is
 *   a whole one or the edited file suppresses the rule (so the suppression counts as used).
 */
function wants(
  own: readonly { src: SourceFile }[],
  rule: { on: boolean; edit: boolean; code: string; present: boolean },
): boolean {
  const suppressed = own.some(
    ({ src }) => mentionsSuppression(src.text) && src.text.includes(rule.code),
  );
  return rule.on && rule.present && (!rule.edit || suppressed);
}

/**
 * Finds the FAPI findings that need the whole project's graph: FAPI003's
 * unmounted routers and cycles, FAPI005's shadowing across routers. A
 * per-edit check builds the graph only for a rule the edited file suppresses,
 * and its findings are then dropped after the suppressions.
 *
 * @param scope - the check's FastAPI lookups.
 * @param own - the checked files that mention FastAPI.
 * @param rules - which rules run, and in which mode.
 * @param found - the one-file findings so far, which FAPI005 doesn't repeat.
 * @returns the graph findings in the checked files.
 */
function graphFindings(
  scope: FastApiProject,
  own: readonly { src: SourceFile; m: FastApiFile }[],
  rules: GraphRules,
  found: ReadonlyMap<string, Diagnostic[]>,
): Diagnostic[] {
  const { edit, wiringOn, shadowOn, settings } = rules;
  const checked = new Map(own.map(({ src }) => [src.path, src]));
  const extra: Diagnostic[] = [];
  const wired = own.some(({ m }) => m.objects.length > 0 || m.wiring.length > 0);
  if (wants(own, { on: wiringOn, edit, code: "FAPI003", present: wired })) {
    extra.push(...checkGraphWiring(scope.graph(), checked, settings));
  }
  if (
    wants(own, {
      on: shadowOn,
      edit,
      code: "FAPI005",
      present: own.some(({ m }) => m.operations.length > 0),
    })
  ) {
    const seen = new Set([...found.values()].flat().map((d) => `${d.file}:${d.line}:${d.code}`));
    extra.push(
      ...checkGraphShadowing(scope, checked).filter(
        (d) => !seen.has(`${d.file}:${d.line}:${d.code}`),
      ),
    );
  }
  return extra;
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
