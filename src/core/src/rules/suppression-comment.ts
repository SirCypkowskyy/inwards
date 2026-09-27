/**
 * @file Inline suppressions (ADR-028): `# inwards: ignore[INW001] reason="why"` on
 * the line a finding points at hides that finding. For a parenthesised
 * import that is the line of the imported name, not the `from` line.
 * Several codes go in one comment, `ignore[INW001,INW005]`, and the comment
 * may follow another tool's (`# noqa: F401  # inwards: ignore[...]`).
 *
 * Every suppression is accountable: the reason is mandatory, and a comment
 * that is malformed, has no reason, or names a code that is unknown or can't
 * be suppressed hides nothing and is itself an INW009 error. A valid code
 * that matches no finding on its line is an INW009 warning, since it would
 * silently hide a new finding there later. A code whose rule is off in
 * `[tool.inwards.rules]` isn't reported as unused.
 *
 * Comments are read from a full parse, so text inside a string never counts
 * as one. The engine sends a file whose text mentions the marker straight to
 * its full parse and reads the comments from that tree (`commentsIn`), so a
 * marked file costs one parse, as a file with a violation does; the import
 * prescan itself is untouched. A file with INW000 is left alone: under its
 * declared encoding a "comment" may be code.
 */
import type { Node, Parser, Tree } from "web-tree-sitter";
import { type RuleSettings, ruleLevel } from "../config/rule-settings.ts";
import type {
  Diagnostic,
  SourceFile,
  Suppressed,
  SuppressionComment,
} from "../contracts/records.ts";
import { diagnostic, RULES } from "../meta/registry.ts";
import { parsePython } from "../python/parser.ts";

/** Cheap check before any parse: can the text hold a suppression at all? */
const MARKER = /inwards:\s*ignore\b/u;
/** The directive inside a comment node's text. */
const DIRECTIVE = /#\s*inwards:\s*ignore\b(?<rest>.*)$/u;
/** What follows `ignore`: the codes, the reason, and optionally another comment. */
const FORM = /^\[(?<codes>[^\]]*)\](?:\s+reason="(?<reason>[^"]*)")?\s*(?<tail>#.*)?$/u;
/** How the comment should look, for messages. */
const EXAMPLE = '# inwards: ignore[INW001] reason="why this import is allowed"';

/**
 * Rules a comment can't suppress: INW000 marks a file that isn't checked at
 * all, INW007 and INW008 are about the package tree (configure the shape
 * instead), and INW009 is about the suppressions themselves.
 */
const FIXED: ReadonlySet<string> = new Set(["INW000", "INW007", "INW008", "INW009"]);

/**
 * Tells whether a file may hold a suppression comment, before any parse.
 *
 * @param text - the normalised file text.
 * @returns true when the text mentions `inwards: ignore`.
 */
export function mentionsSuppression(text: string): boolean {
  return MARKER.test(text);
}

/**
 * Hides the findings a valid suppression comment covers and reports the
 * comments that are invalid or unused (INW009). A no-op, without a parse,
 * for a file that doesn't mention the marker.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param file - the source file, with normalised text.
 * @param checked - the file's findings, before `[tool.inwards.rules]`, and
 *   its comments when the caller already parsed it (`commentsIn`).
 * @param checked.found - the findings.
 * @param checked.comments - the comments, if read.
 * @param rules - the project's `[tool.inwards.rules]`, to skip rules that are off.
 * @returns the findings left with INW009 added, in source order when the file
 *   has a suppression comment, and the findings suppressed.
 */
export function suppress(
  parser: Parser,
  file: SourceFile,
  { found, comments: read }: { found: Diagnostic[]; comments?: readonly SuppressionComment[] },
  rules: RuleSettings | undefined,
): { kept: Diagnostic[]; suppressed: Suppressed[] } {
  if (!MARKER.test(file.text) || found.some((d) => d.code === "INW000")) {
    return { kept: found, suppressed: [] };
  }
  const comments = read ?? parsedComments(parser, file.text);
  const kept: Diagnostic[] = [];
  const suppressed: Suppressed[] = [];
  const used = new Set<string>();
  for (const d of found) {
    const by = comments.find(
      (c) => c.problems.length === 0 && c.span.line === d.line && c.codes.includes(d.code),
    );
    if (by === undefined) {
      kept.push(d);
    } else {
      suppressed.push({ diagnostic: d, reason: by.reason });
      used.add(`${d.line}\u0000${d.code}`);
    }
  }
  for (const c of comments) {
    kept.push(...commentFindings(file, c, used, rules));
  }
  return { kept: kept.sort((a, b) => a.line - b.line || a.column - b.column), suppressed };
}

/**
 * Reads every suppression comment from a parse of its own, for a file the
 * engine didn't parse in full (one outside every layer).
 *
 * @param parser - parser with the Python grammar loaded.
 * @param text - the normalised file text.
 * @returns the comments that hold the directive, valid or not.
 */
function parsedComments(parser: Parser, text: string): SuppressionComment[] {
  const tree = parsePython(parser, text);
  try {
    return commentsIn(tree);
  } finally {
    tree.delete(); // WASM memory is not garbage collected
  }
}

/**
 * Reads every suppression comment from a full parse of the file.
 *
 * @param tree - the file's syntax tree.
 * @returns the comments that hold the directive, valid or not.
 */
export function commentsIn(tree: Tree): SuppressionComment[] {
  return tree.rootNode.descendantsOfType("comment").flatMap((node) => {
    const rest = node ? DIRECTIVE.exec(node.text.trimEnd())?.groups?.["rest"] : undefined;
    return node && rest !== undefined ? [readComment(node, rest)] : [];
  });
}

/**
 * Parses one directive and lists what is wrong with it.
 *
 * @param node - the tree-sitter `comment` node holding the directive.
 * @param rest - the text after `# inwards: ignore`.
 * @returns the codes, the reason and the problems found, with the comment's span.
 */
function readComment(node: Node, rest: string): SuppressionComment {
  const span = {
    line: node.startPosition.row + 1,
    column: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column + 1,
  };
  const form = FORM.exec(rest)?.groups;
  const codes = (form?.["codes"] ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter((code) => code !== "");
  const reason = (form?.["reason"] ?? "").trim();
  if (form === undefined || codes.length === 0) {
    return { span, codes, reason, problems: [`It isn't in the form \`${EXAMPLE}\`.`] };
  }
  const problems = [
    ...(reason === "" ? ['It has no reason: say why in `reason="..."`.'] : []),
    ...(MARKER.test(form["tail"] ?? "")
      ? ["It holds a second `inwards: ignore`; put every code in the first one."]
      : []),
    ...codes.flatMap(codeProblem),
  ];
  return { span, codes, reason, problems };
}

/**
 * Says what is wrong with one code in a suppression, if anything.
 *
 * @param code - the code as written.
 * @returns one sentence, or none when the code can be suppressed.
 */
function codeProblem(code: string): string[] {
  if (!Object.hasOwn(RULES, code)) {
    return [`${code} is not a rule this Inwards knows; it knows ${Object.keys(RULES).join(", ")}.`];
  }
  if (FIXED.has(code)) {
    const allowed = Object.keys(RULES).filter((c) => !FIXED.has(c));
    return [`${code} can't be suppressed inline; only ${allowed.join(", ")} can.`];
  }
  return [];
}

/**
 * Builds the INW009 findings for one comment: an error when it is invalid, a
 * warning for the codes that matched no finding on its line.
 *
 * @param file - the source file.
 * @param comment - one `# inwards: ignore` directive as read.
 * @param used - `line\0code` of every finding a suppression hid.
 * @param rules - the project's `[tool.inwards.rules]`, if any.
 * @returns zero or one finding.
 */
function commentFindings(
  file: SourceFile,
  comment: SuppressionComment,
  used: ReadonlySet<string>,
  rules: RuleSettings | undefined,
): Diagnostic[] {
  const { span, codes, problems } = comment;
  if (problems.length > 0) {
    return [
      diagnostic(RULES.INW009, file, {
        span,
        message: `This suppression comment hides nothing. ${problems.join(" ")}`,
        fix: {
          summary: "Fix the comment, or remove it and fix the finding it was meant to hide.",
          steps: [
            `Write it as \`${EXAMPLE}\`, with codes of rules that can be suppressed and a reason a reviewer can check.`,
            "Better, fix the import it covers, so no suppression is needed.",
          ],
        },
      }),
    ];
  }
  const unused = codes.filter(
    (code) => !used.has(`${span.line}\u0000${code}`) && ruleLevel(code, rules) !== "off",
  );
  if (unused.length === 0) {
    return [];
  }
  return [
    diagnostic(RULES.INW009, file, {
      span,
      severity: "warning",
      message: `This suppression of ${unused.join(", ")} matches no finding on its line, so it would silently hide a new one.`,
      fix: {
        summary: "Remove the unused suppression.",
        steps: [
          `Remove ${unused.join(", ")} from the comment, or the whole comment if no code is left.`,
        ],
      },
    }),
  ];
}
