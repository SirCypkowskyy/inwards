/**
 * @file INW012 `thin-endpoint` (#182): an HTTP endpoint that holds the
 * feature itself (many statements, branches, loops over data, database or
 * HTTP calls of its own, no call into the layer that should do the work)
 * gets one finding listing every signal that tripped with its numbers, and
 * fix steps that name where the work goes from `delegate-to` and the layers.
 * The same-module helpers an endpoint runs count as part of it, and the
 * finding names them (#271). A decorated or same-file registered endpoint is
 * reported on its `def` line; a handler another first-party module defines
 * is reported on the registration that names it. A file that mentions no
 * framework and no configured decorator is never parsed. I/O-free: the
 * caller supplies the parser, the file, the config and the project index,
 * which reads a handler's module only when a registration names it.
 */
import type { Node, Parser } from "web-tree-sitter";
import type { LayerSpec } from "../../config/layers.ts";
import type { RuleOptions } from "../../config/rule-settings.ts";
import type { Diagnostic, SourceFile, Span } from "../../contracts/records.ts";
import type { ProjectIndex } from "../../lookup/project-index.ts";
import { diagnostic, RULES } from "../../meta/registry.ts";
import { parsePython } from "../../python/parser.ts";
import { joined } from "../shared/words.ts";
import { mayHoldEndpoints } from "./endpoints.ts";
import { RemoteModules } from "./remote.ts";
import { type ThinSettings, thinSettings } from "./settings.ts";
import { trip } from "./signals.ts";
import { type FileView, fileView } from "./view.ts";
import { fixFor, helperText, targetText } from "./wording.ts";

/** What INW012 needs besides the file. */
export interface ThinInputs {
  /** `[tool.inwards.rules.thin-endpoint]`, if set. */
  readonly options: RuleOptions | undefined;
  /** The configured layers, innermost first, for `delegate-to` and the fix steps. */
  readonly layers: readonly LayerSpec[];
  /** The project's module index, which a registration of another module's handler reads. */
  readonly project: ProjectIndex;
}

/** Where a finding for a handler in another module goes, and how it was registered. */
interface Registered {
  /** The handler argument of the registration, in the checked file. */
  readonly at: Node;
  /** What registers it, e.g. `add_api_route`. */
  readonly how: string;
}

/** What reporting one endpoint needs besides the endpoint. */
interface ReportContext {
  /** The checked file, which every finding belongs to. */
  readonly src: SourceFile;
  readonly settings: ThinSettings;
  readonly layers: readonly LayerSpec[];
  /** Where the work goes, as `targetText` names it. */
  readonly where: string;
}

/**
 * Turns a node's position into a finding's span.
 *
 * @param start - the node the span starts at.
 * @param end - the node it ends at.
 * @returns the 1-based span.
 */
function spanOf(start: Node, end: Node): Span {
  return {
    line: start.startPosition.row + 1,
    column: start.startPosition.column + 1,
    endLine: end.endPosition.row + 1,
    endColumn: end.endPosition.column + 1,
  };
}

/**
 * Reports one endpoint when it trips a signal: on its `def` line, or on the
 * registration in the checked file when its body lives in another module.
 *
 * @param endpoint - the endpoint's function, its name and the file it lives in.
 * @param endpoint.fn - its `function_definition` node.
 * @param endpoint.name - its name.
 * @param endpoint.view - the file that defines it.
 * @param context - the checked file, settings, layers and target text.
 * @param registered - the registration that names it from the checked file, for a handler in another module.
 * @returns one finding, or none when nothing tripped.
 */
function report(
  { fn, name, view }: { fn: Node; name: string; view: FileView },
  context: ReportContext,
  registered?: Registered,
): Diagnostic[] {
  const bodies = view.bodies(fn, name);
  const tripped = trip(bodies, {
    settings: context.settings,
    layers: context.layers,
    qualify: view.qualify,
    module: view.src.module,
  });
  if (tripped.parts.length === 0) {
    return [];
  }
  const spans = bodies.map((body, index) => ({
    helper: index === 0 ? undefined : body.name,
    line: body.fn.startPosition.row + 1,
    lines: body.metrics.lines,
  }));
  const path = registered === undefined ? undefined : view.src.path;
  const subject =
    registered === undefined
      ? `\`${name}\``
      : `\`${name}\` (${view.src.path}, line ${fn.startPosition.row + 1}), which \`${registered.how}\` registers here,`;
  return [
    diagnostic(RULES.INW012, context.src, {
      span: registered
        ? spanOf(registered.at, registered.at)
        : spanOf(fn, fn.childForFieldName("name") ?? fn),
      message: `${subject} is an HTTP endpoint with ${joined(tripped.parts)}${helperText(spans, path)}. Endpoints parse the request, call one use case, and shape the response.`,
      fix: fixFor(name, tripped, context.where, { spans, path }),
    }),
  ];
}

/**
 * Checks one file's endpoints against INW012. The caller decides whether the
 * rule is on for the file; this parses only a file that may hold an endpoint,
 * and reads another module only when a registration in it names a handler there.
 *
 * @param parser - parser with the Python grammar loaded.
 * @param src - the file, with normalised text.
 * @param inputs - the rule's options, the layers and the project index.
 * @returns one finding per endpoint that trips a signal, before suppressions and severities apply.
 */
export function checkThinEndpoints(
  parser: Parser,
  src: SourceFile,
  inputs: ThinInputs,
): Diagnostic[] {
  const settings = thinSettings(inputs.options);
  if (!mayHoldEndpoints(src.text, settings.decorators)) {
    return [];
  }
  const tree = parsePython(parser, src.text);
  const remote = new RemoteModules(parser, inputs.project, settings.decorators);
  try {
    const view = fileView(tree, src, settings.decorators);
    const context = {
      src,
      settings,
      layers: inputs.layers,
      where: targetText(settings.delegateTo ?? [], inputs.layers),
    };
    const own = view.found.endpoints.flatMap(({ fn, name }) => report({ fn, name, view }, context));
    const registered = view.found.registrations.flatMap(({ handler, target, how }) => {
      const found = remote.resolve(target);
      return found ? report(found, context, { at: handler, how }) : [];
    });
    return [...own, ...registered].sort((a, b) => a.line - b.line || a.column - b.column);
  } finally {
    remote.dispose();
    tree.delete(); // WASM memory is not garbage collected
  }
}
