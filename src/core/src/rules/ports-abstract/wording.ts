/**
 * @file Words INW014's findings and fix steps: one for a concrete class in
 * a port module and one for a subclass of a port that implements it, both on
 * the class's name, and one for a method of an ABC or Protocol whose body
 * does work, on the method's name. Both fixes name where the implementation goes: the
 * adapter layer of the project's layers when one is recognisable by name,
 * else an adapter module in general. Plain text from the records
 * `classes.ts` builds; it decides nothing about what is reported.
 */
import type { Node } from "web-tree-sitter";
import type { LayerSpec } from "../../config/layers.ts";
import type { Diagnostic, SourceFile, Span } from "../../contracts/records.ts";
import { diagnostic, RULES } from "../../meta/registry.ts";
import type { ConcreteMethod, PortClass } from "./classes.ts";

/**
 * Layer names that say "adapters", most specific first: the outbound
 * (driven) side is where a port's implementation goes.
 */
const ADAPTER_LAYERS: readonly RegExp[] = [
  /outbound|driven|secondary/iu,
  /infra|persistence/iu,
  /adapter/iu,
];

/** The longest statement a message quotes before it is cut. */
const MAX_QUOTE = 60;

/** What a cut quote ends with. */
const CUT = "...";

/** Where an implementation should move: an adapter layer's first module entry. */
export interface AdapterTarget {
  readonly layer: string;
  readonly module: string;
}

/**
 * Picks the layer a port's implementation belongs in, by its name.
 *
 * @param layers - the project's layers.
 * @returns the first layer that matches the most specific name pattern, or undefined when no layer looks like adapters.
 */
export function adapterTarget(layers: readonly LayerSpec[]): AdapterTarget | undefined {
  for (const pattern of ADAPTER_LAYERS) {
    const layer = layers.find((l) => pattern.test(l.name) && l.modules.length > 0);
    const [module] = layer?.modules ?? [];
    if (layer && module !== undefined) {
      return { layer: layer.name, module };
    }
  }
  return undefined;
}

/**
 * Names where the implementation goes, for a sentence.
 *
 * @param target - the adapter layer, if one was found.
 * @returns e.g. `` `shop.adapters` (layer `adapters`) ``.
 */
function destination(target: AdapterTarget | undefined): string {
  return target === undefined
    ? "an adapter module outside the ports package"
    : `\`${target.module}\` (layer \`${target.layer}\`)`;
}

/**
 * Spans a name node.
 *
 * @param node - an `identifier`.
 * @returns the 1-based span.
 */
function spanOf(node: Node): Span {
  return {
    line: node.startPosition.row + 1,
    column: node.startPosition.column + 1,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column + 1,
  };
}

/**
 * Quotes a statement's first line, cut to `MAX_QUOTE` characters.
 *
 * @param statement - a statement node.
 * @returns its text for a message.
 */
function quote(statement: Node): string {
  const [first = ""] = statement.text.split("\n");
  return first.length > MAX_QUOTE ? `${first.slice(0, MAX_QUOTE - CUT.length)}${CUT}` : first;
}

/**
 * Turns a class that is neither an ABC nor a Protocol into a finding.
 *
 * @param cls - the concrete class, with its node and name.
 * @param src - the checked file.
 * @param target - where implementations go, if known.
 * @returns the finding, on the class's name.
 */
export function reportClass(
  cls: PortClass,
  src: SourceFile,
  target: AdapterTarget | undefined,
): Diagnostic {
  const name = cls.node.childForFieldName("name") ?? cls.node;
  return diagnostic(RULES.INW014, src, {
    span: spanOf(name),
    message: `\`${cls.name}\` in port module \`${src.module}\` is neither an ABC nor a Protocol, and extends no class from a port module. A port module holds only the interfaces adapters implement.`,
    fix: {
      summary: `Move \`${cls.name}\` to ${destination(target)}, and leave an ABC or Protocol here.`,
      steps: [
        `If \`${cls.name}\` implements a port, move it to ${destination(target)} and have it subclass the port's ABC, or match its Protocol.`,
        `If \`${cls.name}\` is the port itself, declare it as \`class ${cls.name}(Protocol):\` (from \`typing\`) or \`class ${cls.name}(ABC):\` with \`@abstractmethod\` methods (from \`abc\`), and give each method the body \`...\`.`,
        `If it is an exception, a DTO or a value object, give it the base or decorator that says so (\`Exception\`, \`pydantic.BaseModel\`, \`@dataclass\`), or ask the user to add its base to \`extend-allow-bases\` in [tool.inwards.rules.ports-abstract]. Don't edit [tool.inwards] yourself.`,
      ],
    },
  });
}

/** The last step of a method's fix: where shared code goes instead of the port. */
const SHARED_STEP =
  "Code every adapter shares belongs in a helper in the adapter layer or a domain service, not in the port.";

/**
 * Writes the fix steps for a method of an interface whose body does work.
 *
 * @param cls - the ABC or Protocol.
 * @param method - the method's name.
 * @param where - where implementations go, for a sentence.
 * @returns three steps: empty the body, implement it in an adapter, keep shared code out of the port.
 */
function methodSteps(cls: PortClass, method: string, where: string): string[] {
  const qualified = `${cls.name}.${method}`;
  if (cls.kind === "protocol") {
    return [
      `Replace the body of \`${qualified}\` with \`...\`, keeping its docstring.`,
      `Put the code in a class in ${where} that has the methods of the Protocol \`${cls.name}\` (it doesn't need to subclass it), and implement \`${method}\` there.`,
      SHARED_STEP,
    ];
  }
  return [
    `Replace the body of \`${qualified}\` with \`...\`, keeping its docstring, and mark it \`@abstractmethod\`.`,
    `Put the code in a class in ${where} that subclasses \`${cls.name}\`, and implement \`${method}\` there.`,
    SHARED_STEP,
  ];
}

/**
 * Turns a method of an ABC or Protocol whose body does work into a finding.
 *
 * @param cls - the port class the method is in.
 * @param method - the method and its first working statement.
 * @param src - the checked file.
 * @param target - where implementations go, if known.
 * @returns the finding, on the method's name.
 */
export function reportMethod(
  cls: PortClass,
  method: ConcreteMethod,
  src: SourceFile,
  target: AdapterTarget | undefined,
): Diagnostic {
  const qualified = `${cls.name}.${method.name}`;
  const name = method.fn.childForFieldName("name") ?? method.fn;
  const line = method.statement.startPosition.row + 1;
  return diagnostic(RULES.INW014, src, {
    span: spanOf(name),
    message: `\`${qualified}\` in port module \`${src.module}\` has a body that does work: line ${line} runs \`${quote(method.statement)}\`. A port declares what adapters implement; its methods hold only a docstring, \`...\`, \`pass\` or \`raise NotImplementedError\`.`,
    fix: {
      summary: `Move the body of \`${qualified}\` to an implementation in ${destination(target)}, and leave \`...\` here.`,
      steps: methodSteps(cls, method.name, destination(target)),
    },
  });
}

/**
 * Turns a subclass of a port whose methods do work into one finding: it
 * implements the port, so it is an adapter.
 *
 * @param cls - the derived class.
 * @param methods - its methods that do work, at least one.
 * @param src - the checked file.
 * @param target - where implementations go, if known.
 * @returns the finding, on the class's name.
 */
export function reportImplementation(
  cls: PortClass,
  methods: readonly ConcreteMethod[],
  src: SourceFile,
  target: AdapterTarget | undefined,
): Diagnostic {
  const name = cls.node.childForFieldName("name") ?? cls.node;
  const base = cls.base ?? "a port";
  const listed = methods.map((m) => `\`${m.name}\` (line ${m.fn.startPosition.row + 1})`);
  const last = listed.pop() ?? "";
  const which = listed.length === 0 ? last : `${listed.join(", ")} and ${last}`;
  const verb = methods.length === 1 ? "does" : "do";
  return diagnostic(RULES.INW014, src, {
    span: spanOf(name),
    message: `\`${cls.name}\` in port module \`${src.module}\` extends the port \`${base}\` and implements it: ${which} ${verb} work. An implementation is an adapter; a port module holds only the interfaces adapters implement.`,
    fix: {
      summary: `Move \`${cls.name}\` to ${destination(target)}.`,
      steps: [
        `Move \`${cls.name}\` to ${destination(target)}, importing \`${base}\` from \`${src.module}\` there.`,
        `If \`${cls.name}\` is a test double, such as an in-memory fake, move it next to the tests instead.`,
        `If \`${cls.name}\` is meant to be a narrower port, list \`ABC\` or \`Protocol\` among its bases and give its methods the body \`...\`.`,
      ],
    },
  });
}
