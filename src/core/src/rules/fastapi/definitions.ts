/**
 * @file The module-level classes and constants of one file, which the FAPI
 * rules follow besides functions: exception classes and their bases, status
 * code constants, and shared `responses=` dicts. It reads one tree and
 * resolves nothing; `model.ts` looks names up in what it returns.
 */
import type { Node } from "web-tree-sitter";
import { identifierName, namedChildren } from "../../python/nodes.ts";

/** A file's module-level classes and simple `NAME = value` assignments, by name. */
export interface ModuleDefinitions {
  /** Each class's `class_definition` node. */
  readonly classes: ReadonlyMap<string, Node>;
  /** Each constant's value expression; a name assigned twice keeps the last value. */
  readonly constants: ReadonlyMap<string, Node>;
}

/**
 * Lists a module's top-level classes, decorated or not, and its top-level
 * `NAME = value` assignments (annotated ones too).
 *
 * @param root - the module node.
 * @returns the classes and constants by name.
 */
export function moduleDefinitions(root: Node): ModuleDefinitions {
  const classes = new Map<string, Node>();
  const constants = new Map<string, Node>();
  for (const child of namedChildren(root)) {
    const definition =
      child.type === "decorated_definition" ? child.childForFieldName("definition") : child;
    const name =
      definition?.type === "class_definition" ? definition.childForFieldName("name") : null;
    if (definition && name) {
      classes.set(identifierName(name), definition);
    }
    const [assignment] = child.type === "expression_statement" ? namedChildren(child) : [];
    const left = assignment?.type === "assignment" ? assignment.childForFieldName("left") : null;
    const right = assignment?.childForFieldName("right");
    if (left?.type === "identifier" && right) {
      constants.set(identifierName(left), right);
    }
  }
  return { classes, constants };
}
