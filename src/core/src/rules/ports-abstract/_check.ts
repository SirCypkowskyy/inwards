/**
 * @file INW014 `ports-abstract` (#295, from #98): a port module holds only
 * the interfaces adapters implement. Every top-level class there is an ABC,
 * a `typing.Protocol` or a subclass of a class from a port module, and every
 * method body is only a docstring, `...`, `pass` or
 * `raise NotImplementedError`. A subclass of a port whose methods do work is
 * an implementation, reported once on the class. Exceptions, DTOs and dataclasses are exempt
 * through `allow-bases` and `allow-decorators`. Without `modules`, the rule
 * checks the modules with a `ports` segment (`shop.application.ports.users`);
 * with it, the modules it selects. `interface = "protocol"` also reports an
 * ABC there, and a port that extends a port without listing `Protocol`;
 * `allow-subclassing = false` reports, in any other module, a base that
 * names a class from a port module, parsing only a file whose import
 * skeleton imports one. A file with no `class` is never parsed.
 * I/O-free: the caller supplies the run's trees, the file, the options and
 * the layers.
 */
import { type LayerSpec, type RuleOptions, stringList } from "../../config/index.ts";
import type { Diagnostic, SourceFile } from "../../contracts/records.ts";
import { importedNames } from "../../python/parser.ts";
import { classNames, classQualifier, exemptMatchers, moduleScope } from "../shared/classes.ts";
import type { ModuleTrees } from "../shared/module-trees.ts";
import {
  type ClassContext,
  concreteMethods,
  type PortClass,
  portBases,
  portClasses,
} from "./_classes.ts";
import {
  type AdapterTarget,
  adapterTarget,
  reportAbc,
  reportClass,
  reportImplementation,
  reportMethod,
  reportNotProtocol,
  reportSubclass,
} from "./_wording.ts";

/** A `class` statement anywhere in a file's text. */
const CLASS = /\bclass\b/u;

/** The module segment that marks a port module when `modules` isn't set. */
const PORTS_SEGMENT = "ports";

/** What INW014 needs from the run's trees: a file's tree, and its imports without one. */
type Trees = Pick<ModuleTrees, "treeOf" | "skeletonOf">;

/** What INW014 needs from its options and the layers. */
interface Inputs {
  /** `[tool.inwards.rules.ports-abstract]`, if set. */
  readonly options: RuleOptions | undefined;
  readonly layers: readonly LayerSpec[];
}

/**
 * Tells whether a file outside the port modules may subclass a port: the
 * prescan's imports name a port module, or the prescan declines the file.
 *
 * @param trees - the run's trees.
 * @param src - the file.
 * @param inScope - the port-module test.
 * @returns false only when no import can bring in a port.
 */
function importsPort(trees: Trees, src: SourceFile, inScope: (module: string) => boolean): boolean {
  const imports = trees.skeletonOf(src);
  return imports === undefined || imports.some((ref) => inScope(ref.from ?? ref.target));
}

/**
 * Turns one class of a port module into its findings.
 *
 * @param cls - the class and its kind.
 * @param src - the checked file.
 * @param target - where implementations go, if known.
 * @param protocolOnly - whether `interface = "protocol"` is set.
 * @returns the class's findings, in source order.
 */
function classFindings(
  cls: PortClass,
  src: SourceFile,
  target: AdapterTarget | undefined,
  protocolOnly: boolean,
): Diagnostic[] {
  if (cls.kind === "exempt") {
    return [];
  }
  if (cls.kind === "concrete") {
    return [reportClass(cls, src, target)];
  }
  const methods = concreteMethods(cls.node);
  if (cls.kind === "derived") {
    if (methods.length > 0) {
      return [reportImplementation(cls, methods, src, target)];
    }
    return protocolOnly ? [reportNotProtocol(cls, src)] : [];
  }
  const abc = protocolOnly && cls.kind === "abc" ? [reportAbc(cls, src)] : [];
  return [...abc, ...methods.map((method) => reportMethod(cls, method, src, target))];
}

/**
 * Checks one file against INW014. The caller decides whether the rule is on
 * for the file's module; this decides whether it is a port module, or, with
 * `allow-subclassing = false`, a module that may subclass a port, and parses
 * it only when its text has a class.
 *
 * @param trees - the run's trees, which parse the file once per run.
 * @param src - the file, with normalised text.
 * @param inputs - the rule's options and the project's layers.
 * @returns the findings in source order, before suppressions and severities apply.
 */
export function checkPortsAbstract(trees: Trees, src: SourceFile, inputs: Inputs): Diagnostic[] {
  const { options, layers } = inputs;
  const inScope = moduleScope(stringList(options?.["modules"]), PORTS_SEGMENT);
  const port = inScope(src.module);
  const subclassing = !port && options?.["allow-subclassing"] === false;
  if (!((port || subclassing) && CLASS.test(src.text))) {
    return [];
  }
  if (subclassing && !importsPort(trees, src, inScope)) {
    return [];
  }
  const tree = trees.treeOf(src);
  const root = tree.rootNode;
  const context: ClassContext = {
    qualify: classQualifier(importedNames(tree, src), src.module, classNames(root)),
    inScope,
    ...exemptMatchers(options),
  };
  if (subclassing) {
    return portBases(root, src.module, context).map((base) => reportSubclass(base, src));
  }
  const target = adapterTarget(layers);
  const protocolOnly = options?.["interface"] === "protocol";
  return portClasses(root, src.module, context).flatMap((cls) =>
    classFindings(cls, src, target, protocolOnly),
  );
}
