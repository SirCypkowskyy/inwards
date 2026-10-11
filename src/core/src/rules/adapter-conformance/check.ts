/**
 * @file INW020 `adapter-conformance` (#433, ADR-046): every public class of
 * an adapter module declares the port it implements with a conformance line
 * under a module-level `if TYPE_CHECKING:`, `_: Port = Adapter(...)` or
 * `_: type[Port] = Adapter`, so the type checker (ty's `invalid-assignment`,
 * mypy, pyright) checks the class against the port. It reports a class with
 * no line, a line that runs at import, and, with `ports` set, a line whose
 * annotation isn't a class from a port module (without it, `Any` and
 * `object` only). Without `modules` it checks the modules with an
 * `adapters` segment. It checks that the line exists, not what it says:
 * that is the type checker's job. A file with no `class` is never parsed.
 * I/O-free: the caller supplies the run's trees, the file and the options.
 */
import { stringList } from "../../config/rule-options.ts";
import type { RuleOptions } from "../../config/rule-settings.ts";
import type { Diagnostic, SourceFile } from "../../contracts/records.ts";
import { importedNames } from "../../python/parser.ts";
import {
  classNames,
  classQualifier,
  DEFAULT_ALLOW_BASES,
  DEFAULT_ALLOW_DECORATORS,
  moduleScope,
} from "../shared/classes.ts";
import type { FileTrees } from "../shared/module-trees.ts";
import { nameMatcher } from "../shared/name-patterns.ts";
import { adapterClasses, conformanceLines, type LineContext, portName } from "./lines.ts";
import { reportAnnotation, reportMissing, reportRuns } from "./wording.ts";

/** A `class` statement anywhere in a file's text. */
const CLASS = /\bclass\b/u;

/** The module segment that marks an adapter module when `modules` isn't set. */
const ADAPTERS_SEGMENT = "adapters";

/** The module segment that marks a port module when `ports` isn't set. */
const PORTS_SEGMENT = "ports";

/** The annotations that accept any value, so they check nothing. */
const ANYTHING: ReadonlySet<string> = new Set(["typing.Any", "typing_extensions.Any", "object"]);

/** A class name by PEP 8: it starts with a capital, after any underscores. */
const CAP_WORDS = /^_*\p{Lu}/u;

/** What the port in a missing line's example is when the module doesn't import exactly one. */
const UNKNOWN_PORT = "<Port>";

/**
 * Tells whether a dotted name is a class in one of the port modules: its
 * owner is a port module and its last segment is a CapWords name.
 *
 * shortcut: a CapWords name is taken for a class, a lower-case one for a submodule, since the rule reads no other file; read the index if a project names its classes otherwise.
 *
 * @param name - a qualified name.
 * @param isPort - the test for a port module.
 * @returns true for a class defined in a port module.
 */
function inPortModule(name: string, isPort: (module: string) => boolean): boolean {
  const dot = name.lastIndexOf(".");
  return dot > 0 && CAP_WORDS.test(name.slice(dot + 1)) && isPort(name.slice(0, dot));
}

/**
 * Names the port for a missing line's example: the one name the module
 * imports from a port module.
 *
 * @param names - what each imported name refers to.
 * @param isPort - the test for a port module.
 * @returns the local name, or `<Port>` when the module imports none or several.
 */
function soloPort(names: ReadonlyMap<string, string>, isPort: (module: string) => boolean): string {
  const ports = [...names].filter(([, target]) => inPortModule(target, isPort));
  const [only] = ports;
  return ports.length === 1 && only !== undefined ? only[0] : UNKNOWN_PORT;
}

/**
 * Checks one file against INW020. The caller decides whether the rule is on
 * for the file's module; this decides whether it is an adapter module, and
 * parses it only when its text has a class.
 *
 * @param trees - the run's trees, which parse the file once per run.
 * @param src - the file, with normalised text.
 * @param options - `[tool.inwards.rules.adapter-conformance]`, if set.
 * @returns the findings in source order, before suppressions and severities apply.
 */
export function checkAdapterConformance(
  trees: FileTrees,
  src: SourceFile,
  options: RuleOptions | undefined,
): Diagnostic[] {
  const inScope = moduleScope(stringList(options?.["modules"]), ADAPTERS_SEGMENT);
  if (!(inScope(src.module) && CLASS.test(src.text))) {
    return [];
  }
  const ports = stringList(options?.["ports"]);
  const isPort = moduleScope(ports, PORTS_SEGMENT);
  const bases = stringList(options?.["allow-bases"]) ?? DEFAULT_ALLOW_BASES;
  const extra = stringList(options?.["extend-allow-bases"]) ?? [];
  const decorators = stringList(options?.["allow-decorators"]) ?? DEFAULT_ALLOW_DECORATORS;
  const tree = trees.treeOf(src);
  const root = tree.rootNode;
  const names = importedNames(tree, src);
  const context: LineContext = {
    qualify: classQualifier(names, src.module, classNames(root)),
    allowBase: nameMatcher([...bases, ...extra]),
    allowDecorator: nameMatcher(decorators),
  };
  const classes = adapterClasses(root, src.module, context);
  if (classes.length === 0) {
    return [];
  }
  const lines = conformanceLines(root, new Set(classes.map((c) => c.name)), context.qualify);
  const declared = new Set(lines.map((line) => line.cls));
  const found = lines.flatMap((line): Diagnostic[] => {
    if (!line.typeOnly) {
      return [reportRuns(line, src)];
    }
    const named = portName(line.port, context.qualify);
    if (named === null) {
      return [];
    }
    const anything = ANYTHING.has(named);
    const wrong = anything || (ports !== undefined && !inPortModule(named, isPort));
    return wrong ? [reportAnnotation(line, src, named, anything)] : [];
  });
  const port = soloPort(names, isPort);
  const missing = classes
    .filter((c) => !declared.has(c.name))
    .map((c) => reportMissing(c, src, port));
  return [...missing, ...found].sort((a, b) => a.line - b.line || a.column - b.column);
}
