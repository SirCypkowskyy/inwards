/**
 * TOML parsing for `inwards init`, behind a plain function: Bun's built-in
 * parser. Init only reads `[project].name` and `[build-system]` with it; the
 * rules themselves are parsed by the core engine.
 */

/**
 * Parses TOML, returning undefined instead of throwing.
 *
 * @param text - the TOML text.
 * @returns the document, or undefined when it doesn't parse.
 */
export function parseToml(text: string): unknown {
  try {
    return Bun.TOML.parse(text);
  } catch {
    return undefined;
  }
}
