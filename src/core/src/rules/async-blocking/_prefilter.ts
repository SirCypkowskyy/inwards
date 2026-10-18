/**
 * @file The text prefilter INW013 uses in a run over many files (#369): it
 * tells, without parsing a checked file, that the file can't hold a finding.
 * A finding needs a name that resolves to a blocking type or call, written in
 * the file whose context resolves it: in the checked file for its own calls
 * and the receivers it passes to a helper, or in the helper's module for the
 * helper's own receivers. So a file whose text names no blocking type can
 * only reach a finding through a helper whose module does, called by the
 * helper's name or by an alias a re-export gave it. The prefilter reads every
 * listed first-party module's text once, parses only the modules that name a
 * blocking type, and lists those helpers' names and aliases; a checked file
 * that names neither a blocking type nor one of those is skipped. It owns no
 * tree (the run's `ModuleTrees` does) and decides nothing about a file that
 * passes: `check.ts` parses and checks it as before.
 *
 * Every test here may let through a file that holds nothing, never the
 * reverse: a qualified name's last segment is always spelled out in the text
 * that resolves it (an import, an attribute, an annotation), and its first
 * segment either is too or is the file's own top-level package (a relative
 * import, or a name the file defines). Identifiers compare after NFKC, as
 * Python reads them, and token edges are ASCII word characters, which every
 * Python identifier continues with.
 */
import type { ImportRef, SourceFile } from "../../contracts/records.ts";
import type { ParsedModules } from "../shared/first-party.ts";
import type { ModuleTrees } from "../shared/module-trees.ts";
import { blockingHelpers } from "./_hop.ts";
import type { Walk } from "./_walk.ts";

/** A wildcard anywhere in a pattern: its names can't be listed. */
const WILDCARD = /[*?]/u;

/** The last ASCII code point: a character above it may need NFKC before names compare. */
const ASCII_END = 0x7f;

/** Not preceded by an ASCII word character: the start of a token. */
const TOKEN_START = "(?<![A-Za-z0-9_])";

/** An ASCII word character, which continues any Python identifier it touches. */
const WORD_CHAR = /[A-Za-z0-9_]/u;

/**
 * What may stand between two tokens of one import entry: whitespace (line
 * breaks inside parentheses), a backslash line continuation, or a comment.
 */
const GAP: string = /(?:\s|\\\r?\n|#[^\n]*)+/u.source;

/** One identifier, captured. */
const IDENTIFIER = "([\\p{ID_Start}_][\\p{ID_Continue}]*)";

/** A blocking qualified name, and the two segments the text test looks for. */
interface Segments {
  readonly name: string;
  readonly first: string;
  readonly last: string;
}

/**
 * Splits the qualified names INW013 looks for into the segments the text
 * test needs.
 *
 * @param names - the built-in names and the configured patterns.
 * @returns one entry per name, or undefined when a pattern has a wildcard,
 *   which leaves its names open and the prefilter off.
 */
export function blockingSegments(names: readonly string[]): readonly Segments[] | undefined {
  if (names.some((name) => WILDCARD.test(name))) {
    return undefined;
  }
  return names.map((name) => {
    const parts = name.split(".");
    return { name, first: parts[0] ?? name, last: parts.at(-1) ?? name };
  });
}

/**
 * Lists what a file's imports may bind a name to, as `importedNames` would:
 * `from X import a` binds `X.a`; a plain `import a.b` binds `a`, and with an
 * alias `a.b`, which the skeleton doesn't tell apart, so `a` stands for both.
 *
 * @param imports - the file's imports.
 * @returns the dotted targets a qualified name in the file may start with.
 */
function boundTargets(imports: readonly ImportRef[]): string[] {
  return imports.flatMap(({ target, from }) => {
    if (target === "") {
      return [];
    }
    return [from === undefined ? (target.split(".")[0] ?? target) : target];
  });
}

/**
 * Tells whether a file can spell a qualified name: one of its imports binds
 * a prefix of it, or it is a name of the file's own module (which is what a
 * name the file doesn't import qualifies to).
 *
 * @param name - a blocking qualified name.
 * @param module - the file's dotted module name.
 * @param targets - what the file's imports bind (`boundTargets`).
 * @returns false when no name in the file can qualify to it.
 */
function spells(name: string, module: string, targets: readonly string[]): boolean {
  return (
    name.startsWith(`${module}.`) ||
    targets.some((target) => name === target || name.startsWith(`${target}.`))
  );
}

/**
 * Tells whether a text is plain ASCII, which NFKC leaves as it is.
 *
 * @param text - a file's text.
 * @returns false when any character is outside ASCII.
 */
function asciiOnly(text: string): boolean {
  for (let at = 0; at < text.length; at += 1) {
    if (text.charCodeAt(at) > ASCII_END) {
      return false;
    }
  }
  return true;
}

/**
 * Tells whether a word is a whole token somewhere in a text: no ASCII word
 * character touches it on either side. `indexOf` instead of a regular
 * expression with lookarounds, which costs several times as much over a
 * whole project's text.
 *
 * @param text - the text, NFKC-normalised when it holds anything outside ASCII.
 * @param word - an identifier.
 * @returns true when some occurrence stands alone.
 */
function hasToken(text: string, word: string): boolean {
  for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
    const before = text.charAt(at - 1);
    const after = text.charAt(at + word.length);
    if (!(WORD_CHAR.test(before) || WORD_CHAR.test(after))) {
      return true;
    }
  }
  return false;
}

/** A file's text as names compare in it, and whether it may name a blocking type. */
interface Reading {
  /** The text, NFKC-normalised when it holds anything outside ASCII. */
  readonly text: string;
  readonly blocking: boolean;
}

/** Reads a file for a blocking name (see `namesTest`). */
type NamesTest = (src: SourceFile) => Reading;

/**
 * Makes the test of a file for a blocking name: by its text, for some name,
 * the last segment is a token of the text and the first segment is in the
 * text or is the file's own top-level package; then, for a file that passes,
 * by its imports: one of them binds a prefix of such a name, or the name is
 * in the file's own module. The text compares after NFKC when it holds
 * anything outside ASCII, as Python reads identifiers.
 *
 * @param segments - what `blockingSegments` made of the blocking names.
 * @param skeleton - reads a file's imports from its skeleton.
 * @returns the test: the text names compare in, and false for `blocking`
 *   only when no name in the file can resolve to a blocking one.
 */
function namesTest(
  segments: readonly Segments[],
  skeleton: (src: SourceFile) => readonly ImportRef[] | undefined,
): NamesTest {
  return (src: SourceFile): Reading => {
    const text = asciiOnly(src.text) ? src.text : src.text.normalize("NFKC");
    const named = spelledIn(text, src.module, segments);
    if (named.length === 0) {
      return { text, blocking: false };
    }
    const imports = skeleton(src);
    if (imports === undefined) {
      return { text, blocking: true }; // the prescan declined the file: assume it may
    }
    const targets = boundTargets(imports);
    return { text, blocking: named.some(({ name }) => spells(name, src.module, targets)) };
  };
}

/**
 * Lists the blocking names whose last segment is a token of a text and whose
 * first segment is in it or is the module's top-level package. Each distinct
 * segment is looked for once, by `indexOf`: over a whole project, several
 * times faster than one regular expression that alternates them.
 *
 * @param text - the file's text, NFKC-normalised when it holds anything outside ASCII.
 * @param module - the file's dotted module name.
 * @param segments - what `blockingSegments` made of the blocking names.
 * @returns the names the text may spell.
 */
function spelledIn(text: string, module: string, segments: readonly Segments[]): Segments[] {
  const top = module.split(".")[0] ?? module;
  const firsts = new Map<string, boolean>();
  const tokens = new Map<string, boolean>();
  return segments.filter(({ first, last }) => {
    let token = tokens.get(last);
    if (token === undefined) {
      token = hasToken(text, last);
      tokens.set(last, token);
    }
    let present = firsts.get(first);
    if (token && present === undefined) {
      present = first === top || text.includes(first);
      firsts.set(first, present);
    }
    return token && present === true;
  });
}

/**
 * Finds the names an import may give a helper elsewhere, `helper as alias`,
 * until no new one turns up, so a call through a renaming re-export still
 * counts. Any `name as alias` in any text counts, which may add names that
 * aren't re-exports at all.
 *
 * @param texts - every listed module's text, NFKC-normalised when it holds anything outside ASCII.
 * @param names - the helpers' own names.
 * @returns the names and every alias found for them.
 */
function withAliases(texts: readonly string[], names: Iterable<string>): Set<string> {
  const found = new Set(names);
  let frontier = [...found];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const alias of aliasesOf(texts, frontier)) {
      if (!found.has(alias)) {
        found.add(alias);
        next.push(alias);
      }
    }
    frontier = next;
  }
  return found;
}

/**
 * Lists the aliases `name as alias` gives any of some names in any text.
 *
 * @param texts - the texts, NFKC-normalised when they hold anything outside ASCII.
 * @param names - the names to look for before `as`.
 * @returns the aliases, repeats included.
 */
function aliasesOf(texts: readonly string[], names: readonly string[]): string[] {
  const entry = new RegExp(`${TOKEN_START}(?:${names.join("|")})${GAP}as${GAP}${IDENTIFIER}`, "gu");
  const aliases: string[] = [];
  for (const text of texts) {
    // `includes` first: the expression's lookbehind costs more over a whole project.
    if (mentionsAny(text, names)) {
      for (const [, alias] of text.matchAll(entry)) {
        if (alias !== undefined) {
          aliases.push(alias);
        }
      }
    }
  }
  return aliases;
}

/**
 * Tells whether a text holds any of some words anywhere.
 *
 * @param text - a module's text.
 * @param words - identifiers to look for, as substrings.
 * @returns true when one of them is a substring of the text.
 */
function mentionsAny(text: string, words: readonly string[]): boolean {
  return words.some((word) => text.includes(word));
}

/**
 * The prefilter for one run: the blocking names' segments, and the names a
 * call must spell to reach a helper that blocks without a receiver passed in.
 * Build it with `BlockingReach.of`.
 */
export class BlockingReach {
  private readonly names: NamesTest;
  /** Each listed module's text, as `ModuleTrees` read it, and how it reads. */
  private readonly naming: ReadonlyMap<string, { text: string; reading: Reading }>;
  /**
   * The names of the helpers that block with no receiver passed in, and
   * every alias a re-export may give them: a call from another module whose
   * qualified name ends in none of these, and passes no receiver, reaches no
   * blocking helper.
   */
  readonly helpers: ReadonlySet<string>;

  /**
   * Stores what `of` found.
   *
   * @param names - tests a file for a blocking name.
   * @param naming - each listed module's text and how it reads.
   * @param helpers - the helpers' names and aliases.
   */
  private constructor(
    names: NamesTest,
    naming: ReadonlyMap<string, { text: string; reading: Reading }>,
    helpers: ReadonlySet<string>,
  ) {
    this.names = names;
    this.naming = naming;
    this.helpers = helpers;
  }

  /**
   * Reads every listed first-party module's text, parses those that may name
   * a blocking type (through the run's views, which keep them for the hops),
   * and collects their blocking helpers' names and aliases.
   *
   * @param trees - the run's first-party modules, which list and read them.
   * @param views - INW013's view of the modules, which parses them once per run.
   * @param segments - what `blockingSegments` made of the blocking names.
   * @returns the prefilter, or undefined when the project can't list its modules.
   */
  static of(
    trees: ModuleTrees,
    views: ParsedModules<Walk>,
    segments: readonly Segments[],
  ): BlockingReach | undefined {
    const listed = trees.listed();
    if (listed === undefined) {
      return undefined;
    }
    const names = namesTest(segments, (file: SourceFile): readonly ImportRef[] | undefined =>
      trees.skeletonOf(file),
    );
    const naming = new Map<string, { text: string; reading: Reading }>();
    const helpers = new Set<string>();
    for (const module of listed) {
      const src = trees.sourceOf(module);
      if (src === undefined) {
        continue;
      }
      const reading = names(src);
      naming.set(module, { text: src.text, reading });
      const view = reading.blocking ? views.viewOf(module) : undefined;
      for (const name of view ? blockingHelpers(view) : []) {
        helpers.add(name);
      }
    }
    const texts = [...naming.values()].map(({ reading }) => reading.text);
    const reach = helpers.size === 0 ? helpers : withAliases(texts, helpers);
    return new BlockingReach(names, naming, reach);
  }

  /**
   * Tells whether a checked file may hold a finding: it names a blocking type
   * or call, or a helper that blocks (or an alias of one).
   *
   * @param src - the checked file, with normalised text.
   * @returns false only when parsing the file can't find anything.
   */
  mayFind(src: SourceFile): boolean {
    // The checked file is usually a listed module read the same: its answer is known.
    const listed = this.naming.get(src.module);
    const { text, blocking } = listed?.text === src.text ? listed.reading : this.names(src);
    return blocking || [...this.helpers].some((name) => hasToken(text, name));
  }
}
