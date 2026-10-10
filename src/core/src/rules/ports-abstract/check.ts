/**
 * @file INW014 `ports-abstract` (#295, from #98): a port module holds only
 * the interfaces adapters implement. Every top-level class there is an ABC,
 * a `typing.Protocol` or a subclass of a class from a port module, and every
 * method body is only a docstring, `...`, `pass` or
 * `raise NotImplementedError`. A subclass of a port whose methods do work is
 * an implementation, reported once on the class. Exceptions, DTOs and dataclasses are exempt
 * through `allow-bases` and `allow-decorators`. Without `modules`, the rule
 * checks the modules with a `ports` segment (`shop.application.ports.users`);
 * with it, the modules it selects. A file with no `class` is never parsed.
 * I/O-free: the caller supplies the parser, the file, the options and the
 * layers.
 */
import type { Node, Parser } from "web-tree-sitter";
import { matchEntry } from "../../config/layer-selector.ts";
import type { LayerSpec } from "../../config/layers.ts";
import { stringList } from "../../config/rule-options.ts";
import type { RuleOptions } from "../../config/rule-settings.ts";
import type { Diagnostic, SourceFile } from "../../contracts/records.ts";
import { identifierName } from "../../python/nodes.ts";
import { importedNames, parsePython } from "../../python/parser.ts";
import { type Qualify, qualifierFor } from "../../python/qualify.ts";
import { nameMatcher } from "../shared/name-patterns.ts";
import { type ClassContext, classNames, concreteMethods, portClasses } from "./classes.ts";
import { adapterTarget, reportClass, reportImplementation, reportMethod } from "./wording.ts";

/** A `class` statement anywhere in a file's text. */
const CLASS = /\bclass\b/u;

/** The module segment that marks a port module when `modules` isn't set. */
const PORTS_SEGMENT = "ports";

/**
 * The bases a class may extend and stay out of the check: exceptions
 * (builtin ones are spelled bare), Pydantic models, named tuples, typed
 * dicts and enums.
 */
const DEFAULT_ALLOW_BASES: readonly string[] = [
  "BaseException",
  "Exception",
  "*Error",
  "*Exception",
  "*Warning",
  "pydantic.BaseModel",
  "typing.NamedTuple",
  "typing.TypedDict",
  "typing_extensions.NamedTuple",
  "typing_extensions.TypedDict",
  "enum.*",
];

/** The decorators that make a class a data record and keep it out of the check. */
const DEFAULT_ALLOW_DECORATORS: readonly string[] = [
  "dataclasses.dataclass",
  "pydantic.dataclasses.dataclass",
  "attrs.define",
  "attrs.frozen",
  "attrs.mutable",
  "attr.s",
  "attr.attrs",
  "attr.define",
  "attr.frozen",
];

/** What INW014 needs from its options and the layers. */
interface Inputs {
  /** `[tool.inwards.rules.ports-abstract]`, if set. */
  readonly options: RuleOptions | undefined;
  readonly layers: readonly LayerSpec[];
}

/**
 * Makes the test for "is this a port module": the `modules` entries when
 * set, else a `ports` segment anywhere in the name.
 *
 * @param modules - the `modules` option, if set.
 * @returns the test.
 */
function scopeOf(modules: readonly string[] | undefined): (module: string) => boolean {
  if (modules === undefined) {
    return (module: string): boolean => module.split(".").includes(PORTS_SEGMENT);
  }
  return (module: string): boolean =>
    modules.some((entry) => matchEntry(entry, module) !== undefined);
}

/**
 * Makes the file's qualifier: an imported name reads as its target, a
 * same-file class as the module's, and any other bare name (a builtin such
 * as `Exception`) as itself, so the allow patterns can name builtins.
 *
 * @param names - what each imported name refers to.
 * @param module - the file's dotted module name.
 * @param local - the names of the file's top-level classes.
 * @returns a function that qualifies a name or attribute node, or returns null for any other expression.
 */
function qualifierOf(
  names: ReadonlyMap<string, string>,
  module: string,
  local: ReadonlySet<string>,
): Qualify {
  const imported = qualifierFor(names, module);
  return (node: Node): string | null => {
    if (node.type !== "identifier") {
      return imported(node);
    }
    const name = identifierName(node);
    return names.get(name) ?? (local.has(name) ? `${module}.${name}` : name);
  };
}

/**
 * Checks one file against INW014. The caller decides whether the rule is on
 * for the file's module; this decides whether it is a port module, and
 * parses it only when its text has a class.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param src - the file, with normalised text.
 * @param inputs - the rule's options and the project's layers.
 * @returns the findings in source order, before suppressions and severities apply.
 */
export function checkPortsAbstract(parser: Parser, src: SourceFile, inputs: Inputs): Diagnostic[] {
  const { options, layers } = inputs;
  const inScope = scopeOf(stringList(options?.["modules"]));
  if (!(inScope(src.module) && CLASS.test(src.text))) {
    return [];
  }
  const bases = stringList(options?.["allow-bases"]) ?? DEFAULT_ALLOW_BASES;
  const extra = stringList(options?.["extend-allow-bases"]) ?? [];
  const decorators = stringList(options?.["allow-decorators"]) ?? DEFAULT_ALLOW_DECORATORS;
  const tree = parsePython(parser, src.text);
  try {
    const root = tree.rootNode;
    const context: ClassContext = {
      qualify: qualifierOf(importedNames(tree, src), src.module, classNames(root)),
      inScope,
      allowBase: nameMatcher([...bases, ...extra]),
      allowDecorator: nameMatcher(decorators),
    };
    const target = adapterTarget(layers);
    return portClasses(root, src.module, context).flatMap((cls) => {
      if (cls.kind === "exempt") {
        return [];
      }
      if (cls.kind === "concrete") {
        return [reportClass(cls, src, target)];
      }
      const methods = concreteMethods(cls.node);
      if (cls.kind === "derived") {
        return methods.length > 0 ? [reportImplementation(cls, methods, src, target)] : [];
      }
      return methods.map((method) => reportMethod(cls, method, src, target));
    });
  } finally {
    tree.delete(); // WASM memory is not garbage collected
  }
}
