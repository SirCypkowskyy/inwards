/**
 * @file Files that take every path through the engine, with a layered config:
 * clean, outward, missing, dynamic, suppressed, badly suppressed, outside the
 * layers, an unreadable encoding, relative imports, CRLF, a BOM, a quoted
 * import and a non-ASCII name, and an in-memory extraction cache that counts
 * its writes. The tests that must show a result never changes (the
 * extraction cache, #56; the worker pool, #61) use them.
 */
import {
  type CachedExtraction,
  type ExtractionCache,
  type ExtractionIdentity,
  type InwardsConfig,
  parseConfig,
  type SourceFile,
} from "../../src/index.ts";
import { file } from "./helpers.ts";

/** Three layers under `shop`, with `scripts` ignored. */
export const CONFIG: InwardsConfig = parseConfig(`
[tool.inwards]
ignore = ["scripts"]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "application", modules = ["shop.application"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]
`);

/** Files that take every path through the engine. */
export const FILES: SourceFile[] = [
  file("shop/domain/clean.py", "from shop.domain import order\n"),
  file("shop/domain/outward.py", "import shop.infrastructure.db\n"),
  file("shop/domain/missing.py", "import shop.domain.pricing\n"),
  file(
    "shop/domain/loader.py",
    'import importlib\nimportlib.import_module("shop.infrastructure.db")\n',
  ),
  file(
    "shop/domain/allowed.py",
    'import shop.infrastructure.db  # inwards: ignore[INW001] reason="legacy"\n',
  ),
  file("shop/domain/bad_comment.py", "import os  # inwards: ignore[INW001]\n"),
  file(
    "shop/persistence/repo.py",
    'import shop.domain.order  # inwards: ignore[INW006] reason="moving"\nx = 1\n',
  ),
  file("shop/domain/encoded.py", "# coding: utf-16\nimport shop.infrastructure.db\n"),
  file("shop/domain/relative.py", "from ..infrastructure import db\n"),
  file("shop/domain/pkg/__init__.py", "from . import db\nfrom ..infrastructure import db\n"),
  file("shop/domain/crlf.py", "import shop.infrastructure.db\r\nx = 1\r\n"),
  file("shop/domain/bom.py", "﻿import shop.infrastructure.db\n"),
  file("shop/domain/quoted.py", 'x = """\nimport shop.infrastructure.db\n"""\n'),
  file("shop/domain/unicode.py", "import shop.infrastructure.dbé\n"),
];

/** An in-memory cache that counts what it stores. */
export class CountingCache implements ExtractionCache {
  readonly entries: Map<string, CachedExtraction> = new Map();
  writes = 0;

  /**
   * Looks a file up by its whole identity.
   *
   * @param identity - the file and the extraction revision.
   * @returns the stored components, or undefined.
   */
  get(identity: ExtractionIdentity): CachedExtraction | undefined {
    return this.entries.get(JSON.stringify(identity));
  }

  /**
   * Stores a file's components and counts the write.
   *
   * @param identity - the file and the extraction revision.
   * @param value - every component known so far.
   */
  set(identity: ExtractionIdentity, value: CachedExtraction): void {
    this.writes += 1;
    this.entries.set(JSON.stringify(identity), value);
  }
}
