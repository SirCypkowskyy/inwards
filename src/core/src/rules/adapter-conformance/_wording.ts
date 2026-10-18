/**
 * @file Words INW020's three findings and their fix steps: a class with no
 * conformance line (on the class's name), a line outside
 * `if TYPE_CHECKING:` (on the line), and a line whose annotation names no
 * port (on the annotation). Plain text from the records `lines.ts` builds;
 * it decides nothing about what is reported.
 */
import type { Diagnostic, SourceFile } from "../../contracts/records.ts";
import { diagnostic, RULES } from "../../meta/registry.ts";
import { firstLine, nodeSpan } from "../shared/node-span.ts";
import type { AdapterClass, ConformanceLine } from "./_lines.ts";

/** The longest line a message quotes before it is cut. */
const MAX_QUOTE = 80;

/** The option a user adds a record's base to. */
const TABLE = "[tool.inwards.rules.adapter-conformance]";

/**
 * Turns a class with no conformance line into a finding.
 *
 * @param cls - the class.
 * @param src - the checked file.
 * @param port - the port's name for the example line: the one port the module imports, else `<Port>`.
 * @returns the finding, on the class's name.
 */
export function reportMissing(cls: AdapterClass, src: SourceFile, port: string): Diagnostic {
  const line = `_: ${port} = ${cls.name}(...)`;
  return diagnostic(RULES.INW020, src, {
    span: nodeSpan(cls.nameNode),
    message: `\`${cls.name}\` in adapter module \`${src.module}\` declares no port it implements. Add \`${line}\` under \`if TYPE_CHECKING:\` at the end of the module, so the type checker checks the class against its port.`,
    fix: {
      summary: `Add \`${line}\` under \`if TYPE_CHECKING:\` at the end of the module.`,
      steps: [
        `Import the port \`${cls.name}\` implements under \`if TYPE_CHECKING:\` (\`from typing import TYPE_CHECKING\`), unless the module already imports it.`,
        `Add \`${line}\` in that block, at the end of the module; the arguments don't matter, since the line never runs. \`_: type[${port}] = ${cls.name}\` works too. For a class that implements several ports, add one line per port.`,
        `If \`${cls.name}\` is a helper, not an adapter, rename it \`_${cls.name}\` or move it out of the adapter module. If it is a record on a base of the project's own, ask the user to add that base to \`extend-allow-bases\` in ${TABLE}. Don't edit [tool.inwards] yourself.`,
      ],
    },
  });
}

/**
 * Turns a conformance line outside `if TYPE_CHECKING:` into a finding.
 *
 * @param line - the conformance line that runs at import.
 * @param src - the checked file.
 * @returns the finding, on the line.
 */
export function reportRuns(line: ConformanceLine, src: SourceFile): Diagnostic {
  const effect =
    line.form === "call" ? `builds a \`${line.cls}\`` : "needs the port imported at runtime";
  return diagnostic(RULES.INW020, src, {
    span: nodeSpan(line.statement),
    message: `\`${firstLine(line.statement, MAX_QUOTE)}\` in adapter module \`${src.module}\` is outside \`if TYPE_CHECKING:\`, so it runs when the module is imported and ${effect}. A conformance line is only for the type checker.`,
    fix: {
      summary: "Move the line into an `if TYPE_CHECKING:` block at the end of the module.",
      steps: [
        "Move the line into an `if TYPE_CHECKING:` block at module level (`from typing import TYPE_CHECKING`), at the end of the module.",
        "Move the port's import into the same block if nothing else in the module uses it at runtime.",
      ],
    },
  });
}

/**
 * Turns a conformance line whose annotation names no port into a finding.
 *
 * @param line - the conformance line, whose `port` node the finding spans.
 * @param src - the checked file.
 * @param named - the annotation's qualified name.
 * @param anything - true for `Any` or `object`, which accept any value; false for a class outside the port modules.
 * @returns the finding, on the annotation.
 */
export function reportAnnotation(
  line: ConformanceLine,
  src: SourceFile,
  named: string,
  anything: boolean,
): Diagnostic {
  const why = anything
    ? "which accepts any value"
    : "which isn't a class from a port module (`ports`)";
  return diagnostic(RULES.INW020, src, {
    span: nodeSpan(line.port),
    message: `The conformance line for \`${line.cls}\` in adapter module \`${src.module}\` is annotated \`${named}\`, ${why}, so the type checker doesn't check the class against a port.`,
    fix: {
      summary: `Annotate the line with the port \`${line.cls}\` implements.`,
      steps: [
        `Replace \`${line.port.text}\` with the port \`${line.cls}\` implements, imported from its port module under \`if TYPE_CHECKING:\`.`,
        `If that port lives outside the modules \`ports\` lists in ${TABLE}, ask the user to add its module there. Don't edit [tool.inwards] yourself.`,
      ],
    },
  });
}
