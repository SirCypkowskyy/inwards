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
 * I/O-free: the caller supplies the run's trees, the file, the options and
 * the layers.
 */
import type { LayerSpec } from "../../config/layers.ts";
import { stringList } from "../../config/rule-options.ts";
import type { RuleOptions } from "../../config/rule-settings.ts";
import type { Diagnostic, SourceFile } from "../../contracts/records.ts";
import { importedNames } from "../../python/parser.ts";
import { classNames, classQualifier, exemptMatchers, moduleScope } from "../shared/classes.ts";
import type { FileTrees } from "../shared/module-trees.ts";
import { type ClassContext, concreteMethods, portClasses } from "./classes.ts";
import { adapterTarget, reportClass, reportImplementation, reportMethod } from "./wording.ts";

/** A `class` statement anywhere in a file's text. */
const CLASS = /\bclass\b/u;

/** The module segment that marks a port module when `modules` isn't set. */
const PORTS_SEGMENT = "ports";

/** What INW014 needs from its options and the layers. */
interface Inputs {
  /** `[tool.inwards.rules.ports-abstract]`, if set. */
  readonly options: RuleOptions | undefined;
  readonly layers: readonly LayerSpec[];
}

/**
 * Checks one file against INW014. The caller decides whether the rule is on
 * for the file's module; this decides whether it is a port module, and
 * parses it only when its text has a class.
 *
 * @param trees - the run's trees, which parse the file once per run.
 * @param src - the file, with normalised text.
 * @param inputs - the rule's options and the project's layers.
 * @returns the findings in source order, before suppressions and severities apply.
 */
export function checkPortsAbstract(
  trees: FileTrees,
  src: SourceFile,
  inputs: Inputs,
): Diagnostic[] {
  const { options, layers } = inputs;
  const inScope = moduleScope(stringList(options?.["modules"]), PORTS_SEGMENT);
  if (!(inScope(src.module) && CLASS.test(src.text))) {
    return [];
  }
  const tree = trees.treeOf(src);
  const root = tree.rootNode;
  const context: ClassContext = {
    qualify: classQualifier(importedNames(tree, src), src.module, classNames(root)),
    inScope,
    ...exemptMatchers(options),
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
}
