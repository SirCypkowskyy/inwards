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
| shape guard | shape guard | the PreToolUse check of a new file against INW007 |
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
| heredoc | heredoc (heredoca, heredoki) | a shell `<<'EOF'` block |
| wildcard (`*`, `**` in a module name) | wildcard (wildcardu, wildcardy) | import-linter's module patterns |
| preset | preset | `--style` presets |
| Layer names | `domain`, `application`, `infrastructure`, `interface`, `bootstrap`, ... | when they name a configured layer; the generic concept is translated, see below |
| Rule codes | INW000, INW001, ... INW011, FAPI001, ... | |
| Rule names | `package-shape`, `missing-member` | |
| front matter, OKF | front matter, OKF | the rule pages' metadata block and its format; its keys (`autofix`, `suppressible`...) stay as written |
| CLI commands and flags | `inwards check`, `--format json`, `--agent claude`, ... | |
| File and config names | `pyproject.toml`, `[tool.inwards]`, `AGENTS.md`, `escalate-after`, ... | |
| Product names | Claude Code, Aider, Codex, Cursor, Copilot, Ruff, ty, mypy, import-linter, tree-sitter, Bun, Zensical, ... | |
| Tool terms | LSP, MCP, SARIF, WASM, CI, C4, ADR, JSON | |
| scaffold (the example code, also the repo's early code) | scaffold (scaffoldu) | the `--scaffold` flag's output is "przykładowy pakiet" |
| fixture | fixture (fixture'a, fixture'y) | test and eval fixtures |
| ruleset (GitHub) | ruleset (rulesetu) | |
| runner, checkout | runner, checkout | CI terms |
| loader (module loader) | loader (loadera) | |
| launcher (`--launcher`, e.g. `uv run`) | launcher (launchera) | what starts Inwards in the project |
| worktree (git) | worktree (worktree'a, worktree'y) | |

## Fixed Polish terms

| English | Polish |
|---|---|
| adapter | adapter |
| allowlist, deny list (`allow-libraries`, `deny-libraries`, `extend-deny-libraries`) | lista dozwolonych, lista zakazów |
| agent, coding agent, AI agent | agent, agent kodujący, agent AI |
| agent loop | pętla agenta |
| architecture linter | linter architektury |
| architecture brief (`inwards context`, `init --brief`) | opis architektury (brief) |
| binary (the executable) | plik binarny |
| bounded context | kontekst ograniczony (bounded context) |
| budget (performance) | budżet |
| bytecode | bajtkod |
| check (the act of running `inwards check`) | sprawdzenie |
| whole-project check | sprawdzenie całego projektu |
| one-file check (what the hook runs) | sprawdzenie jednego pliku |
| full check (every file) | pełne sprawdzenie |
| quickstart (home page) | szybki start |
| clean (no violations) | czysty (projekt, plik) |
| code scanning | code scanning (GitHub) |
| composition root | korzeń kompozycji (composition root) |
| cold / warm run | zimne / ciepłe uruchomienie |
| corpus | korpus |
| compiled extension (`.so`, `.pyd`) | skompilowany moduł rozszerzenia (not "rozszerzenie", which is the VS Code extension) |
| config, configuration | konfiguracja |
| contract (import-linter) | kontrakt |
| container package (a package that holds layers) | pakiet-kontener |
| config error | błąd konfiguracji |
| confirming parse | parsowanie potwierdzające |
| dead prefix | martwy prefiks |
| dormant (baseline entry) | uśpiony (wpis) |
| decision (ADR) | decyzja |
| dependency rule | reguła zależności |
| diagnostic | diagnostyka (pl. diagnostyki) |
| differential test | test różnicowy |
| domain layer, application layer, infrastructure layer | warstwa domeny, warstwa aplikacji, warstwa infrastruktury |
| dynamic import | import dynamiczny |
| evidence (a matching module below a package, INW006) | dowód |
| edit distance | odległość edycyjna |
| computed (target, source) | wyliczany (cel, kod) |
| unverifiable (INW011 target), unreadable | niesprawdzalny, nieczytelny |
| edit | edycja |
| engine | silnik |
| entity | encja |
| error | błąd |
| escalation, escalate | eskalacja, eskalować |
| evasion, dodge | obejście, obchodzenie (sprawdzenia) |
| exit code | kod wyjścia |
| extension (VS Code) | rozszerzenie |
| fail (a check, gate, job, PR) | oblewać, nie przechodzić, kończyć się błędem |
| fix composer | kompozytor poprawek |
| fix safety (rule page section) | bezpieczeństwo poprawki |
| flagged / fixed (rule page example) | zgłoszony / poprawiony (przykład) |
| first-party (code, module) | własny (kod, moduł projektu) |
| gate (short for Stop gate) | bramka |
| generated module (`generated`: `*_pb2`, `_version`) | moduł generowany (przy budowaniu) |
| fix steps | kroki naprawy |
| guardrail | zabezpieczenie |
| hallucinated module | zmyślony moduł |
| hypothesis | hipoteza |
| importers (of a module) | moduły importujące (dany moduł) |
| import skeleton | szkielet importów |
| job (CI) | zadanie |
| language server | serwer języka |
| libraries per layer (INW005 guide) | biblioteki w warstwach |
| legacy codebase, repo, violation | starszy kod, starsze repozytorium, stare naruszenie |
| literal (target, dynamic import) | dosłowny (cel, import dynamiczny) |
| layer | warstwa |
| library; third-party library; standard library | biblioteka; biblioteka zewnętrzna; biblioteka standardowa |
| inner, outer layer; innermost, outermost | warstwa wewnętrzna, zewnętrzna; najbardziej wewnętrzna, najbardziej zewnętrzna |
| maintainer | opiekun projektu |
| sibling (module, package; import-linter's layers) | moduł sąsiedni, sąsiedni pakiet |
| sibling layers (a nested array in `layers`, `a \| b` in a template's roles) | warstwy sąsiednie |
| template (`[tool.inwards.templates]`); role (a template's `roles`) | szablon; rola |
| rank (of a layer among siblings) | miejsce (w kolejności warstw) |
| cache (uv's, bunx's) | pamięć podręczna (uv, bunx) |
| dev dependency | zależność deweloperska |
| member (of a package) | element (pakietu) |
| miss (prescan) | przeoczenie |
| opt-in rule (default off) | reguła opt-in (domyślnie wyłączona) |
| options table (`[tool.inwards.rules.<rule-name>]`) | tabela opcji |
| owner (the repo's) | właściciel |
| payload (hook input) | dane wejściowe (hooka) |
| per-edit hook | hook edycji |
| phase in (rules) | wprowadzać stopniowo (reguły) |
| picker (`init` on a terminal) | kreator |
| namespace package | pakiet przestrzeni nazw |
| portion (of a namespace package, PEP 420) | część (pakietu przestrzeni nazw) |
| virtualenv (`.venv`), site-packages | środowisko wirtualne (`.venv`), site-packages |
| module index | indeks modułów |
| package shape | kształt pakietu |
| path operation (FastAPI) | operacja ścieżki |
| include a router (`include_router`) | dołączać router, dołączenie |
| unmounted router (FAPI003) | niepodpięty router |
| shadowed route (FAPI005) | przesłonięta trasa |
| port | port |
| ports and adapters, hexagonal architecture | porty i adaptery, architektura heksagonalna |
| pre-release | wersja przedpremierowa (pre-release) |
| probe (the file system) | sondować, sondowanie |
| promotion (PR `develop` → `main`) | promocja |
| prescan refusal | odmowa prescanu |
| relative import | import względny |
| release | wydanie |
| redact (`--redact`) | pseudonimizować (not "anonimizować": keyed hashes still tell files apart) |
| release candidate | kandydat do wydania |
| release draft | szkic (wydania) |
| rule | reguła |
| rule catalogue | katalog reguł |
| rule page (`docs/chapters/rules/INWxxx.md`) | strona reguły |
| scaffold (`--scaffold`) | przykładowy pakiet (scaffold) |
| selector | selektor |
| matched prefix (of a layer selector) | dopasowany prefiks |
| truth table | tabela prawdy |
| session | sesja |
| session state | stan sesji |
| session baseline (the start snapshot, not the file) | punkt odniesienia, migawka startowa |
| severity | poziom (błąd, ostrzeżenie) |
| shared kernel (the `shared` layer of `vertical-slices`) | wspólne jądro |
| slice, vertical slice | wycinek, pionowy wycinek (vertical slice) |
| snapshot | migawka |
| spike | eksperyment |
| start-up (process) | start (startu) |
| string (Python) | napis |
| suppression, inline suppression (`# inwards: ignore[...]`) | wyciszenie, wyciszenie w linii |
| reason (of a suppression) | powód |
| path operation (FastAPI) | operacja ścieżki |
| exception handler (FastAPI) | handler wyjątków |
| helper (function) | funkcja pomocnicza |
| inclusion (`include_router`) | dołączenie |
| finding | diagnostyka (as for diagnostic) |
| stub (`.pyi`) | zaślepka (plik `.pyi`) |
| symlink | dowiązanie symboliczne |
| top-level package | pakiet najwyższego poziomu |
| turn (of the agent) | tura |
| upload | wysyłka |
| use case | przypadek użycia |
| value object | obiekt wartości |
| verified (the "Verified" boxes) | zweryfikowano |
| violation | naruszenie |
| wall time | czas rzeczywisty |
| warning | ostrzeżenie |
| workspace (uv) | workspace (uv) |
| workspace package (a uv workspace member, INW005) | pakiet workspace'u |
| workspace (editor, VS Code) | obszar roboczy |
