/**
 * @file The rule pages, embedded: the English Markdown of every page in
 * `docs/chapters/rules/`, which `explain_rule` (`inwards mcp`) serves, so the
 * answer is the published page and works offline. `with { type: "text" }`
 * makes `bun build --compile` put the text in the binary; from source the
 * same imports read the files. Only `compose.ts` loads this module, lazily,
 * so no other command pays for the text. It doesn't parse the pages; that is
 * `mcp/rule-page.ts`'s job.
 */
import fapi001 from "../../../../docs/chapters/rules/FAPI001.md" with { type: "text" };
import fapi002 from "../../../../docs/chapters/rules/FAPI002.md" with { type: "text" };
import fapi003 from "../../../../docs/chapters/rules/FAPI003.md" with { type: "text" };
import fapi005 from "../../../../docs/chapters/rules/FAPI005.md" with { type: "text" };
import fapi006 from "../../../../docs/chapters/rules/FAPI006.md" with { type: "text" };
import fapi007 from "../../../../docs/chapters/rules/FAPI007.md" with { type: "text" };
import fapi008 from "../../../../docs/chapters/rules/FAPI008.md" with { type: "text" };
import fapi009 from "../../../../docs/chapters/rules/FAPI009.md" with { type: "text" };
import inw000 from "../../../../docs/chapters/rules/INW000.md" with { type: "text" };
import inw001 from "../../../../docs/chapters/rules/INW001.md" with { type: "text" };
import inw002 from "../../../../docs/chapters/rules/INW002.md" with { type: "text" };
import inw003 from "../../../../docs/chapters/rules/INW003.md" with { type: "text" };
import inw004 from "../../../../docs/chapters/rules/INW004.md" with { type: "text" };
import inw005 from "../../../../docs/chapters/rules/INW005.md" with { type: "text" };
import inw006 from "../../../../docs/chapters/rules/INW006.md" with { type: "text" };
import inw007 from "../../../../docs/chapters/rules/INW007.md" with { type: "text" };
import inw008 from "../../../../docs/chapters/rules/INW008.md" with { type: "text" };
import inw009 from "../../../../docs/chapters/rules/INW009.md" with { type: "text" };
import inw010 from "../../../../docs/chapters/rules/INW010.md" with { type: "text" };
import inw011 from "../../../../docs/chapters/rules/INW011.md" with { type: "text" };
import inw012 from "../../../../docs/chapters/rules/INW012.md" with { type: "text" };
import inw013 from "../../../../docs/chapters/rules/INW013.md" with { type: "text" };
import inw015 from "../../../../docs/chapters/rules/INW015.md" with { type: "text" };

/** Every rule page's Markdown, by rule code; a test checks it lists every registered rule. */
export const RULE_PAGES: ReadonlyMap<string, string> = new Map(
  Object.entries({
    FAPI001: fapi001,
    FAPI002: fapi002,
    FAPI003: fapi003,
    FAPI005: fapi005,
    FAPI006: fapi006,
    FAPI007: fapi007,
    FAPI008: fapi008,
    FAPI009: fapi009,
    INW000: inw000,
    INW001: inw001,
    INW002: inw002,
    INW003: inw003,
    INW004: inw004,
    INW005: inw005,
    INW006: inw006,
    INW007: inw007,
    INW008: inw008,
    INW009: inw009,
    INW010: inw010,
    INW011: inw011,
    INW012: inw012,
    INW013: inw013,
    INW015: inw015,
  }),
);
