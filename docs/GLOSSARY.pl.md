# Polish translation glossary

The fixed terminology for the Polish docs in `docs/pl/` (issue #149). Every
page uses these terms, and a review of a Polish change checks against this
file. It lives outside both sites' `docs_dir` so it isn't published: Zensical
has no way to exclude a file inside `docs_dir`.

English is the source of truth. When a term is missing, add it here in the
same PR that first needs it.

## How to translate

- **Natural technical Polish, not word for word.** Rebuild a sentence when the
  English order sounds stiff in Polish. Keep the meaning, numbers, versions,
  dates and every caveat exactly.
- **Address the reader as "ty"**, lowercase ("zainstaluj", "twój projekt"),
  as most Polish developer docs do.
- **Headings keep the English anchor**: `## Polski tytuł { #english-anchor }`,
  with the id Zensical gives the English heading. Cross-links and the
  language switcher (which keeps the `#anchor`) rely on it, and the strict
  build fails on a link to an anchor that doesn't exist.
- **Never translate**: code blocks, CLI output, config keys and values,
  diagnostic messages (INWxxx text, `fix` steps, hook messages), file and
  directory names, commands and flags, JSON field names, URLs, image paths,
  HTML ids and classes, Mermaid node ids. Text quoted from the CLI stays
  English, even inside a Polish sentence.
- **Translate**: prose, headings, table text, admonition titles, image alt
  text and captions, Mermaid labels that are prose (node and edge labels,
  subgraph titles), `aria-label`s, and hand-written SVG text on the pages.
- **Cross-links** inside `docs/pl/` point to Polish pages (same relative
  paths as in English). Images, CSS and scripts come from the English site:
  a Polish page references `../assets/...` one level further up than the
  English page does.
- **Abbreviations** (`*[ADR]: ...`) keep the English expansion and may add a
  Polish gloss.
- **Front matter** on every page: `source: docs/chapters/<page>` and
  `source_hash:`. After re-translating, run
  `uv run scripts/check-docs-translation.py --fix-hashes docs/pl/<page>`.

## Kept in English

These stay English in Polish text. A single English word is inflected the
Polish way when the sentence needs it (a hook, hooka, hooki; baseline,
baseline'u); multi-word names are left uninflected where possible.

| Term | Use in Polish | Note |
|---|---|---|
| hook, agent hook | hook, hook agenta (hooka, hooki, hookach) | the four Claude Code hooks: SessionStart, PreToolUse, PostToolUse, Stop |
| Stop gate | Stop gate | "Stop gate blokuje turę", not "bramka Stop" |
| config guard | config guard | the PreToolUse guard |
| baseline | baseline (baseline'u); `inwards-baseline.json` | "przyjąć naruszenia do baseline'u" |
| fingerprint | fingerprint (fingerprintu) | the 16-hex-digit hash |
| run log | run log (run logu) | `.inwards/runs.jsonl` |
| prescan | prescan (prescanu) | |
| design partner | design partner (design partnerzy, design partnerów) | |
| release PR | release PR | release-please's pull request |
| pull request, PR | pull request, PR | |
| commit, merge, squash | commit, merge, squash | verbs: "scalić" is fine for merge |
| workflow (GitHub Actions) | workflow | |
| wheel | wheel (wheela, wheele) | the Python package format |
| preset | preset | `--style` presets |
| Layer names | `domain`, `application`, `infrastructure`, `interface`, `bootstrap`, ... | when they name a configured layer; the generic concept is translated, see below |
| Rule codes | INW000, INW001, ... INW011 | |
| Rule names | `package-shape`, `missing-member` | |
| CLI commands and flags | `inwards check`, `--format json`, `--agent claude`, ... | |
| File and config names | `pyproject.toml`, `[tool.inwards]`, `AGENTS.md`, `escalate-after`, ... | |
| Product names | Claude Code, Aider, Codex, Cursor, Copilot, Ruff, ty, mypy, import-linter, tree-sitter, Bun, Zensical, ... | |
| Tool terms | LSP, MCP, SARIF, WASM, CI, C4, ADR, JSON | |

## Fixed Polish terms

| English | Polish |
|---|---|
| adapter | adapter |
| agent, coding agent, AI agent | agent, agent kodujący, agent AI |
| architecture linter | linter architektury |
| binary (the executable) | plik binarny |
| bounded context | kontekst ograniczony (bounded context) |
| budget (performance) | budżet |
| check (the act of running `inwards check`) | sprawdzenie |
| whole-project check | sprawdzenie całego projektu |
| clean (no violations) | czysty (projekt, plik) |
| code scanning | code scanning (GitHub) |
| composition root | korzeń kompozycji (composition root) |
| config, configuration | konfiguracja |
| config error | błąd konfiguracji |
| confirming parse | parsowanie potwierdzające |
| dead prefix | martwy prefiks |
| decision (ADR) | decyzja |
| dependency rule | reguła zależności |
| diagnostic | diagnostyka (pl. diagnostyki) |
| differential test | test różnicowy |
| domain layer, application layer, infrastructure layer | warstwa domeny, warstwa aplikacji, warstwa infrastruktury |
| dynamic import | import dynamiczny |
| edit | edycja |
| engine | silnik |
| entity | encja |
| error | błąd |
| escalation, escalate | eskalacja, eskalować |
| evasion, dodge | obejście, obchodzenie (sprawdzenia) |
| exit code | kod wyjścia |
| extension (VS Code) | rozszerzenie |
| first-party (code, module) | własny (kod, moduł projektu) |
| fix steps | kroki naprawy |
| guardrail | zabezpieczenie |
| hallucinated module | zmyślony moduł |
| hypothesis | hipoteza |
| import skeleton | szkielet importów |
| job (CI) | zadanie |
| language server | serwer języka |
| layer | warstwa |
| inner, outer layer; innermost, outermost | warstwa wewnętrzna, zewnętrzna; najbardziej wewnętrzna, najbardziej zewnętrzna |
| maintainer | opiekun projektu |
| member (of a package) | element (pakietu) |
| module index | indeks modułów |
| package shape | kształt pakietu |
| port | port |
| ports and adapters, hexagonal architecture | porty i adaptery, architektura heksagonalna |
| pre-release | wersja przedpremierowa (pre-release) |
| prescan refusal | odmowa prescanu |
| release | wydanie |
| rule | reguła |
| rule catalogue | katalog reguł |
| scaffold (`--scaffold`) | przykładowy pakiet (scaffold) |
| selector | selektor |
| session | sesja |
| session state | stan sesji |
| severity | poziom (błąd, ostrzeżenie) |
| slice, vertical slice | wycinek, pionowy wycinek (vertical slice) |
| turn (of the agent) | tura |
| use case | przypadek użycia |
| value object | obiekt wartości |
| verified (the "Verified" boxes) | zweryfikowano |
| violation | naruszenie |
| warning | ostrzeżenie |
| workspace (uv) | workspace (uv) |
