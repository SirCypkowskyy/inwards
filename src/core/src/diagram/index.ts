/**
 * @file The public face of the diagram/ slice. Everything outside the folder
 * imports this module, never a private `_x.ts` behind it.
 */
export { draftFromSource } from "./_draft.ts";
export type {
  Diagram,
  DiagramEdge,
  DiagramKind,
  DiagramNotation,
  NodeMention,
  SubgraphMention,
} from "./_model.ts";
export {
  type Declared,
  diagramFile,
  EXTERNAL,
  idsWithClass,
  mentionSpan,
  quotedLabel,
  resolveName,
  topLevel,
} from "./_names.ts";
export { notationOf } from "./_notation.ts";
export { readDiagrams } from "./_read.ts";
export { type DiagramExport, writeDiagram } from "./_write.ts";
