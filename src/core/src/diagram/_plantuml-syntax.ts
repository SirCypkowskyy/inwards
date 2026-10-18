/**
 * @file The pieces of a PlantUML component statement (#346): names written
 * `[text]`, `"text"` or bare, `as` aliases, `[description]`s,
 * `<<stereotypes>>`, and arrows with their heads, `[style]` and direction
 * word. `plantuml.ts` reads statements with them. Pure string reading over a
 * cursor; syntax per https://plantuml.com/component-diagram.
 */
import type { DiagramEdge, NodeLabel } from "./_model.ts";
import { type Cursor, skipSpace } from "./_syntax.ts";

/** A bare name: letters, digits and `_`. */
const NAME = /^[\p{L}\p{N}_]+/u;
/** `as` between a name and its alias. */
const AS = /^as(?=[\s"[])/u;
/** A `<<stereotype>>`, possibly several names separated by commas. */
const STEREOTYPE = /<<(?<names>[^>]*)>>/gu;
/**
 * An arrow: a head on the left, dashes or dots, a `[style]`, a direction word
 * followed by more dashes or dots, a head on the right. A one-letter head
 * (`o`) can't run into the name after it.
 */
const ARROW =
  /^(?<left><\|?|[*o#+^])?(?<line>[-.]+)(?<style>\[[^\]]*\])?(?<dir>(?:left|right|up|down|le|ri|do|l|r|u|d)(?=[-.]))?(?<tail>[-.]*)(?<right>\|>|>|[*#+^]|o(?![\p{L}\p{N}_]))?/u;
/** A `[style]` that draws the line dashed, dotted or not at all, so not as an import. */
const NOT_SOLID = /dashed|dotted|hidden/u;

/** A name read from a statement, with the columns of its text. */
export interface Ref {
  text: string;
  /** How it was written: `[x]`, `"x"` or a bare name. */
  form: "bracket" | "quote" | "bare";
  column: number;
  endColumn: number;
}

/**
 * Reads `[text]`, a bare name, or, where a declaration allows it, `"text"`.
 *
 * @param cursor - the statement, at the name; moved past it.
 * @param quotes - true when `"text"` counts (a declaration), false in an arrow.
 * @returns the name and its columns, or undefined when none starts here or it never closes.
 */
export function readRef(cursor: Cursor, quotes: boolean): Ref | undefined {
  const rest = cursor.text.slice(cursor.pos);
  const [open] = rest;
  if (open === "[" || (quotes && open === '"')) {
    const close = rest.indexOf(open === "[" ? "]" : '"', 1);
    if (close === -1) {
      return undefined;
    }
    const inner = rest.slice(1, close);
    const text = inner.trim();
    const column = cursor.column + cursor.pos + 1 + (inner.length - inner.trimStart().length);
    cursor.pos += close + 1;
    return {
      text,
      form: open === "[" ? "bracket" : "quote",
      column,
      endColumn: column + text.length,
    };
  }
  const name = NAME.exec(rest)?.[0];
  if (name === undefined) {
    return undefined;
  }
  const column = cursor.column + cursor.pos;
  cursor.pos += name.length;
  return { text: name, form: "bare", column, endColumn: column + name.length };
}

/**
 * Reads the name part of an element: the name, an `as` alias, and a
 * `[description]` after a bare name. With an alias, the alias is the id and
 * the other name is the label, a module prefix like a quoted Mermaid label;
 * a description is a caption.
 *
 * @param cursor - the statement, at the name; moved past what was read.
 * @returns the id and the label, or undefined when no name starts here.
 */
export function readName(cursor: Cursor): { id: Ref; label?: NodeLabel } | undefined {
  const first = readRef(cursor, true);
  if (first === undefined) {
    return undefined;
  }
  const save = cursor.pos;
  skipSpace(cursor);
  if (AS.test(cursor.text.slice(cursor.pos))) {
    cursor.pos += 2;
    skipSpace(cursor);
    const alias = readRef(cursor, true);
    if (alias !== undefined) {
      const [id, text] = alias.form === "bare" ? [alias, first] : [first, alias];
      return { id, label: { text: text.text, quoted: true } };
    }
  }
  if (first.form === "bare" && cursor.text[cursor.pos] === "[") {
    const description = readRef(cursor, false);
    if (description !== undefined) {
      return { id: first, label: { text: description.text, quoted: false } };
    }
  }
  cursor.pos = save;
  return { id: first };
}

/**
 * Reads an arrow between two names, and turns it into an edge: its
 * direction, the link as it reads left to right, and whether it means "may
 * import" (a solid line with one plain head). An arrow written right to left
 * (`b <-- a`) is turned around.
 *
 * @param cursor - the statement, after the first name; moved past the arrow.
 * @param from - the name on the left.
 * @returns the edge without its line, and the name on the right, or undefined when no arrow and name follow.
 */
export function readArrowTo(
  cursor: Cursor,
  from: string,
): { edge: Omit<DiagramEdge, "line">; to: Ref } | undefined {
  skipSpace(cursor);
  const arrow = ARROW.exec(cursor.text.slice(cursor.pos));
  if (arrow === null) {
    return undefined;
  }
  cursor.pos += arrow[0].length;
  skipSpace(cursor);
  const target = readRef(cursor, false);
  if (target === undefined) {
    return undefined;
  }
  const [link] = arrow;
  const { left, right, line = "", tail = "", style = "" } = arrow.groups ?? {};
  const solid = !(line.includes(".") || tail.includes(".") || NOT_SOLID.test(style));
  if (left === "<" && right === undefined) {
    return {
      edge: { from: target.text, to: from, link: `${link.slice(1)}>`, mayImport: solid },
      to: target,
    };
  }
  const mayImport = solid && right === ">" && left === undefined;
  return { edge: { from, to: target.text, link, mayImport }, to: target };
}

/**
 * Lists the stereotypes in the rest of a statement.
 *
 * @param rest - the statement after the name.
 * @returns each name, trimmed, such as `external` from `<< external >>`.
 */
export function stereotypes(rest: string): string[] {
  return [...rest.matchAll(STEREOTYPE)].flatMap((m) =>
    (m.groups?.["names"] ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== ""),
  );
}
