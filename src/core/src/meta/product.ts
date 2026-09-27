/**
 * @file Product metadata: the version and the base URL of the published docs.
 * release-please stamps `VERSION` between the marker comments and
 * `scripts/check-version.sh` compares it with the manifest, so keep the literal
 * and the markers exactly as they are.
 */
// x-release-please-start-version
export const VERSION = "0.2.0";
// x-release-please-end

/** Base URL of the published docs (GitHub Pages for now, see ADR-012). */
export const DOCS_BASE = "https://sircypkowskyy.github.io/inwards";
