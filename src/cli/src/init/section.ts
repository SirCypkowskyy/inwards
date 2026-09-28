/**
 * @file Marked sections in a Markdown file such as AGENTS.md: text between a
 * begin and an end marker that init and `inwards context --write` own and
 * replace in place, leaving everything outside the markers alone. The
 * splicing is pure; reading the current file goes through the platform's probe
 * and reader, and writing is left to the caller.
 */
import type { FileReader, PathProbe } from "../platform/contracts.ts";

/**
 * Adds a marked section at the end of a file's text, or replaces the one
 * already there.
 *
 * @param text - the file's current text ("" when it doesn't exist).
 * @param markers - the begin and end lines that delimit the section.
 * @param markers.begin - the line that opens it, e.g. `<!-- inwards:begin -->`.
 * @param markers.end - the line that closes it.
 * @param section - the whole section, markers included, without a trailing line break.
 * @returns the new text, or an error when the markers don't form exactly one pair.
 */
export function upsertSection(
  text: string,
  markers: { begin: string; end: string },
  section: string,
): { after: string } | { error: string } {
  const { begin, end } = markers;
  const begins = text.split(begin).length - 1;
  const ends = text.split(end).length - 1;
  if (begins === 0 && ends === 0) {
    return { after: `${text}${separator(text)}${section}\n` };
  }
  const start = text.indexOf(begin);
  const stop = text.indexOf(end, start);
  if (begins !== 1 || ends !== 1 || stop === -1) {
    return { error: `unmatched ${begin} / ${end} markers; fix them by hand` };
  }
  return { after: `${text.slice(0, start)}${section}${text.slice(stop + end.length)}` };
}

/**
 * Picks what goes between existing text and an appended section: one blank line.
 *
 * @param text - the file's current text.
 * @returns "", "\n" or "\n\n", so the result has exactly one blank line between them.
 */
function separator(text: string): string {
  if (text === "" || text.endsWith("\n\n")) {
    return "";
  }
  return text.endsWith("\n") ? "\n" : "\n\n";
}

/**
 * Reads a file init may edit, when it is there.
 *
 * @param io - probes and reads the file.
 * @param io.probe - tells whether it exists.
 * @param io.read - reads it.
 * @param path - the file.
 * @returns its text, or undefined when nothing is there.
 * @throws when it exists but can't be read.
 */
export function readIfThere(
  io: { probe: Pick<PathProbe, "exists">; read: Pick<FileReader, "text"> },
  path: string,
): string | undefined {
  return io.probe.exists(path) ? io.read.text(path) : undefined;
}
