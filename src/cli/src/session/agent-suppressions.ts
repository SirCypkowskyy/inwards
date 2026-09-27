/**
 * @file `agent-suppressions` in the hooks (#50, ADR-028). Under `"deny"`, the
 * default, an inline suppression counts only when its file is byte for byte
 * what it was at session start (the agent didn't change it), or when the
 * file as it was at session start had the same finding suppressed too, copy
 * for copy. A suppression the agent added, moved to another import or
 * widened to another code isn't honoured; editing only an existing
 * suppression's reason changes nothing. Start content and identity come from
 * this invocation's `StartLookups`, so a symlink alias can't borrow another
 * file's suppressions.
 */
import { resolve } from "node:path";
import {
  type AgentSuppressions,
  type Diagnostic,
  parseConfig,
  type Report,
  stableMessage,
} from "@inwards/core";
import { projectPath } from "../project/snapshot.ts";
import type { Check, Start } from "./contracts.ts";
import type { StartLookups } from "./lookups.ts";
import { atStart, carried } from "./old-errors.ts";

/**
 * Applies `agent-suppressions` to a hook's report. Under `"deny"`, the
 * default, a suppression is honoured when its file is byte for byte what it
 * was at session start (the start manifest's hash), since the agent didn't
 * change it, or when the file as it was at session start had the same
 * finding (rule, module, message) suppressed too, copy for copy. So a
 * suppression the agent added, one it moved to another import or one it
 * widened to another code isn't honoured; editing only an existing
 * suppression's reason changes nothing. Without a start record every
 * suppression counts as new. The mode comes from the config as it was at
 * session start, so a Bash edit of it changes nothing here (and fails the
 * Stop gate).
 *
 * A finding whose suppression isn't honoured is treated as if the comment
 * weren't there: back in `diagnostics`, unless a baseline entry accepts it
 * (`applyBaseline` marks it `baselined`), and the #134 old-error check the
 * caller runs next applies to it like to any other.
 *
 * @param lookups - this invocation's start lookups.
 * @param start - the session's start record, if there is one.
 * @param check - the config the report came from, its base and baseline setting.
 * @param report - the hook's check.
 * @returns the report as if the rejected comments weren't there, and the
 *   rejected findings the baseline doesn't accept.
 */
export async function agentSuppressions(
  lookups: StartLookups,
  start: Start | undefined,
  check: Check,
  report: Report,
): Promise<{ report: Report; rejected: Diagnostic[] }> {
  const suppressed = report.suppressed ?? [];
  if (suppressed.length === 0 || modeOf(lookups, start, check.configPath) === "allow") {
    return { report, rejected: [] };
  }
  const now = suppressed.map((s) => s.diagnostic);
  const ids = now.flatMap((d): [string, string][] => {
    const rel = lookups.identity.identityOf(lookups.project, check, d.file);
    return rel === undefined ? [] : [[rel, resolve(check.base, d.file)]];
  });
  const same = start ? lookups.content.unchangedFiles(start, ids) : new Set<string>();
  const touched = now.filter((d) => {
    const rel = lookups.identity.identityOf(lookups.project, check, d.file);
    return rel === undefined || !same.has(rel);
  });
  const before =
    start && touched.length > 0 ? await atStart(lookups, start, check, touched) : undefined;
  const kept = carried(touched, before?.suppressed?.map((s) => s.diagnostic) ?? []);
  const lost = suppressed.filter(
    (s) => touched.includes(s.diagnostic) && !kept.includes(s.diagnostic),
  );
  if (lost.length === 0) {
    return { report, rejected: [] };
  }
  const rejected = lost.filter((s) => s.baselined !== true).map((s) => s.diagnostic);
  return {
    report: {
      ...report,
      diagnostics: [...report.diagnostics, ...rejected],
      suppressed: suppressed.filter((s) => !lost.includes(s)),
      baselined: (report.baselined ?? 0) + lost.length - rejected.length,
    },
    rejected,
  };
}

/**
 * Tells the agent which suppressions weren't honoured, and what to do instead.
 *
 * @param rejected - the findings whose suppression was rejected, from `agentSuppressions`.
 * @returns one line of advice, then one line per finding.
 */
export function rejectedNote(rejected: readonly Diagnostic[]): string {
  const lines = rejected.map((d) => `- ${d.file}:${d.line} ${d.code} ${stableMessage(d.message)}`);
  return [
    "These findings have an inline suppression that wasn't in the file when the session started, or the file wasn't committed at session start, and this project doesn't let an agent add one (agent-suppressions). If you added it, fix the code instead, or remove the suppression and ask the user to add it; if it was already there, leave it and tell the user:",
    ...lines,
  ].join("\n");
}

/**
 * Reads `agent-suppressions` for a config: from the session start record
 * when there is one, else from the file now.
 *
 * @param lookups - this invocation's start lookups, for the project and reads.
 * @param start - the session's start record, if there is one.
 * @param configPath - the config's absolute path.
 * @returns the mode; "deny" when the key isn't set.
 * @throws {ConfigError} when there is no start record and the config is invalid.
 */
function modeOf(
  lookups: StartLookups,
  start: Start | undefined,
  configPath: string,
): AgentSuppressions {
  const config = start
    ? start.configs[projectPath(lookups.probe, lookups.project, configPath)]
    : parseConfig(lookups.read.text(configPath));
  return config?.agentSuppressions ?? "deny";
}
