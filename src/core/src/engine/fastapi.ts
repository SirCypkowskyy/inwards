/**
 * @file Runs the FAPI rules for a check: builds the FastAPI model once, reads
 * the checked files through it, and hands each one its FAPI001 to FAPI007
 * findings before its suppression comments apply. The project lookups
 * (`FastApiProject`: handlers, classes, the app and router graph) are shared
 * by the rules and read the rest of the project only when a rule asks. With
 * every FAPI rule off, nothing is read or parsed; a file that doesn't mention
 * FastAPI is never parsed for them, and neither is one INW000 refuses. FAPI007
 * is the exception: it reads any file that spells both `yield` and `except`,
 * since a dependency module needn't import FastAPI.
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
import { checkLifespan } from "../rules/fastapi/lifespan-events.ts";
import { FastApiModel } from "../rules/fastapi/model.ts";
import { FastApiProject } from "../rules/fastapi/project.ts";
import type { FastApiFile } from "../rules/fastapi/records.ts";
import { checkFileShadowing, checkGraphShadowing } from "../rules/fastapi/route-shadowing.ts";
import { checkFileWiring, checkGraphWiring } from "../rules/fastapi/router-wiring.ts";
import { checkYieldSwallows } from "../rules/fastapi/yield-dependency-swallows.ts";
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
  const on = rulesOn(rules);
  if (!(on.wiring || on.shadow || on.lifespan || on.yields || endpointRulesOn(rules))) {
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
      found.set(src.path, fileFindings({ src, m, scope }, { on, edit, rules, settings }));
    }
    for (const src of on.yields ? files.filter((file) => !checkEncoding(file)) : []) {
      const swallows = checkYieldSwallows(parser, src);
      found.set(src.path, [...(found.get(src.path) ?? []), ...swallows]);
    }
    const extra = graphFindings(scope, own, { edit, on, settings }, found);
    for (const d of extra) {
      found.set(d.file, [...(found.get(d.file) ?? []), d]);
    }
    return { found, hidden: edit ? new Set(extra) : new Set() };
  } finally {
    model.dispose();
  }
}

/** Which FAPI rules are on. */
interface RulesOn {
  readonly wiring: boolean;
  readonly shadow: boolean;
  readonly lifespan: boolean;
  readonly yields: boolean;
}

/**
 * Reads which FAPI rules `[tool.inwards.rules]` turns on. FAPI001 and FAPI002
 * are read by `endpointRulesOn` and `checkEndpoints`.
 *
 * @param rules - the project's `[tool.inwards.rules]`, if any.
 * @returns whether each of FAPI003 and FAPI005 to FAPI007 reports.
 */
function rulesOn(rules: InwardsConfig["rules"]): RulesOn {
  return {
    wiring: ruleLevel("FAPI003", rules) !== "off",
    shadow: ruleLevel("FAPI005", rules) !== "off",
    lifespan: ruleLevel("FAPI006", rules) !== "off",
    yields: ruleLevel("FAPI007", rules) !== "off",
  };
}

/** What the one-file checks of a FAPI rule need besides the file. */
interface FileChecks {
  readonly on: RulesOn;
  readonly edit: boolean;
  readonly rules: InwardsConfig["rules"];
  readonly settings: RuleOptions;
}

/**
 * Runs the FAPI rules that read one file (and the lookups it asks for).
 *
 * @param file - the checked file, its FastAPI records and the check's lookups.
 * @param file.src - the file, with normalised text.
 * @param file.m - its FastAPI records.
 * @param file.scope - this check's FastAPI lookups.
 * @param checks - which rules run, and in which mode.
 * @param checks.on - which of FAPI003 and FAPI005 to FAPI007 are on.
 * @param checks.edit - true for a per-edit check, which leaves the cross-file findings out.
 * @param checks.rules - the project's `[tool.inwards.rules]`, for FAPI001 and FAPI002.
 * @param checks.settings - FAPI003's options.
 * @returns the file's findings before suppressions.
 */
function fileFindings(
  { src, m, scope }: { src: SourceFile; m: FastApiFile; scope: FastApiProject },
  { on, edit, rules, settings }: FileChecks,
): Diagnostic[] {
  return [
    ...(on.wiring ? checkFileWiring(m, src, settings) : []),
    ...checkEndpoints(src, m, scope, rules),
    ...(on.shadow && edit ? checkFileShadowing(m, src, scope) : []),
    ...(on.lifespan ? checkLifespan(m, src, scope) : []),
  ];
}

/** What decides which whole-project FAPI rules run in a check. */
interface GraphRules {
  readonly edit: boolean;
  readonly on: RulesOn;
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
 * Drops the graph findings a one-file check already reported.
 *
 * @param graph - findings from the whole-project check.
 * @param found - the one-file findings so far, by file.
 * @returns the graph findings that are new.
 */
function unseen(
  graph: readonly Diagnostic[],
  found: ReadonlyMap<string, Diagnostic[]>,
): Diagnostic[] {
  const seen = new Set([...found.values()].flat().map((d) => `${d.file}:${d.line}:${d.code}`));
  return graph.filter((d) => !seen.has(`${d.file}:${d.line}:${d.code}`));
}

/**
 * Finds the FAPI findings that need the whole project's graph: FAPI003's
 * unmounted routers and cycles, FAPI005's shadowing across routers. A per-edit check builds the graph only for a rule the edited
 * file suppresses, and its findings are then dropped after the suppressions.
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
  const { edit, on, settings } = rules;
  const checked = new Map(own.map(({ src }) => [src.path, src]));
  const extra: Diagnostic[] = [];
  const wired = own.some(({ m }) => m.objects.length > 0 || m.wiring.length > 0);
  if (wants(own, { on: on.wiring, edit, code: "FAPI003", present: wired })) {
    extra.push(...checkGraphWiring(scope.graph(), checked, settings));
  }
  if (
    wants(own, {
      on: on.shadow,
      edit,
      code: "FAPI005",
      present: own.some(({ m }) => m.operations.length > 0),
    })
  ) {
    extra.push(...unseen(checkGraphShadowing(scope, checked), found));
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
