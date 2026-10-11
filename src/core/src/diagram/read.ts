/**
 * @file Reads every marked diagram of a file, Mermaid and PlantUML alike
 * (ADR-045, #346), into the one model the diagram rules and
 * `inwards import-diagram` use. It only picks the reader for each block;
 * finding the blocks is `blocks.ts` and `plantuml-blocks.ts`, and reading
 * them `mermaid.ts` and `plantuml.ts`. No I/O.
 */
import type { DiagramSource } from "../contracts/records.ts";
import { markedBlocks } from "./blocks.ts";
import { readFlowchart } from "./mermaid.ts";
import type { Diagram } from "./model.ts";
import { readPlantUml } from "./plantuml.ts";
import { markedPlantUml } from "./plantuml-blocks.ts";

/**
 * Reads the marked diagrams of one file.
 *
 * @param source - the file's path and text.
 * @returns its Mermaid and PlantUML diagrams, in the order of their markers.
 */
export function readDiagrams(source: DiagramSource): Diagram[] {
  return [
    ...markedBlocks(source).map((block) => readFlowchart(block, source.path)),
    ...markedPlantUml(source).map((block) => readPlantUml(block, source.path)),
  ].sort((a, b) => a.markerLine - b.markerLine);
}
