/**
 * @file Runs the FAPI rules for a check: builds the FastAPI model once, reads
 * the checked files through it, and hands each one its FAPI findings before
 * its suppression comments apply. The project lookups (`FastApiProject`:
 * handlers, classes, the app and router graph) are shared by every rule and
 * read the rest of the project only when a rule asks, and each app's route
 * list (`routes.ts`) is built at most once, for the rules that compare routes.
 * With every FAPI rule off, nothing is read or parsed; a file that doesn't
 * mention FastAPI is never parsed for them, and neither is one INW000 refuses.
 *
 * A per-edit check (the PostToolUse hook, the editor) keeps only the one-file
 * findings of the rules that also read the graph (FAPI003, FAPI005): wiring a
 * new router into the app is a second edit, so the graph's findings wait for
 * the Stop gate. A graph check still runs when a checked file suppresses its
 * code, so the suppression counts as used; the findings it would have
 * reported are then dropped after the suppressions. In a per-edit check,
 * FAPI002 builds the graph only for a route that has a code its own decorator
 * and router don't declare.
 */
import type { Parser } from "web-tree-sitter";
import type { InwardsConfig } from "../config/parse.ts";
import { ruleLevel } from "../config/rule-settings.ts";
import type { Diagnostic, SourceFile } from "../contracts/records.ts";
import type { ProjectIndex } from "../lookup/project-index.ts";
import { checkEndpoints, endpointRulesOn } from "../rules/fastapi/check.ts";
import { FastApiModel } from "../rules/fastapi/model.ts";
import { FastApiProject } from "../rules/fastapi/project.ts";
import { checkFileShadowing, checkGraphShadowing } from "../rules/fastapi/route-shadowing.ts";
import { checkFileWiring, checkGraphWiring } from "../rules/fastapi/router-wiring.ts";
import { appRoutes, type Route } from "../rules/fastapi/routes.ts";
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

/** A FAPI check that needs the app and router graph, and when it has anything to look at. */
interface GraphCheck {
  readonly code: string;
  /** False when no checked file holds what the check reports on. */
  readonly needed: boolean;
  readonly run: () => Diagnostic[];
}

/**
 * Tells whether a checked file has a suppression comment for a rule, so a
 * per-edit check still runs the rule's graph part and the suppression counts
 * as used.
 *
 * @param own - the checked files that mention FastAPI.
 * @param code - the rule's code.
 * @returns true when some file's text has a suppression comment and the code.
 */
function suppresses(own: readonly { src: SourceFile }[], code: string): boolean {
  return own.some(({ src }) => mentionsSuppression(src.text) && src.text.includes(code));
}

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
  const on = new Set(["FAPI003", "FAPI005"].filter((code) => ruleLevel(code, rules) !== "off"));
  if (!(on.has("FAPI003") || on.has("FAPI005") || endpointRulesOn(rules))) {
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
      const wiring = on.has("FAPI003") ? checkFileWiring(m, src, settings) : [];
      const shadowing = on.has("FAPI005") ? checkFileShadowing(m, src) : [];
      found.set(src.path, [...wiring, ...shadowing, ...checkEndpoints(src, m, scope, rules)]);
    }
    const wired = own.some(({ m }) => m.objects.length > 0 || m.wiring.length > 0);
    const routed = own.some(({ m }) => m.operations.length > 0);
    const checked = new Map(own.map(({ src }) => [src.path, src]));
    let routes: ReadonlyMap<string, readonly Route[]> | undefined;
    /**
     * Lists every app's routes, built on first use and shared by the rules that compare routes.
     *
     * @returns each app's routes in match order.
     */
    function appRoutesOnce(): ReadonlyMap<string, readonly Route[]> {
      routes ??= appRoutes(scope.graph());
      return routes;
    }
    const graphChecks: readonly GraphCheck[] = [
      {
        code: "FAPI003",
        needed: wired,
        run: () => checkGraphWiring(scope.graph(), checked, settings),
      },
      {
        code: "FAPI005",
        needed: routed,
        run: () => checkGraphShadowing(appRoutesOnce(), checked),
      },
    ];
    const extra = graphChecks
      .filter(({ code, needed }) => on.has(code) && needed && (!edit || suppresses(own, code)))
      .flatMap(({ run }) => run());
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
