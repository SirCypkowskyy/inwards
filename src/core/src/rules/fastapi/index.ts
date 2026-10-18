/**
 * @file The public face of the rules/fastapi/ slice. Everything outside the folder
 * imports this module, never a private `_x.ts` behind it.
 */
export { checkEndpoints, endpointRulesOn } from "./_check.ts";
export { checkDependsCalled } from "./_depends-called.ts";
export { checkFileOperationIds, checkGraphOperationIds } from "./_duplicate-operation-id.ts";
export { checkLifespan } from "./_lifespan-events.ts";
export { checkFileShadowing, checkGraphShadowing } from "./_route-shadowing.ts";
export { checkFileWiring, checkGraphWiring } from "./_router-wiring.ts";
export { checkYieldSwallows } from "./_yield-dependency-swallows.ts";
export { type FastApiFile, FastApiModel, FastApiProject } from "./model/index.ts";
