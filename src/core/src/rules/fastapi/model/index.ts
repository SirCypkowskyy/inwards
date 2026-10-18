/**
 * @file The public face of the rules/fastapi/model/ slice. Everything outside the folder
 * imports this module, never a private `_x.ts` behind it.
 */
export { DEPENDS } from "./_extract.ts";
export type { GraphEdge, GraphNode, WiringGraph } from "./_graph.ts";
export { FastApiModel } from "./_model.ts";
export { covers } from "./_path-match.ts";
export { FastApiProject, type Lineage } from "./_project.ts";
export type {
  DependencyUse,
  EventHandlerUse,
  FastApiFile,
  FastApiObject,
  PathOperation,
  Wiring,
} from "./_records.ts";
export { fileRoutes, graphRoutes, type Route } from "./_route-list.ts";
export { type Argument, type CallSyntax, type Value, valueFrom } from "./_values.ts";
