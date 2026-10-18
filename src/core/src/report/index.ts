/**
 * @file The public face of the report/ slice. Everything outside the folder
 * imports this module, never a private `_x.ts` behind it.
 */
export { type Format, type RenderOptions, type Report, render } from "./_render.ts";
