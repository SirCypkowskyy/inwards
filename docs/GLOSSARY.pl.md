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
  A diagram marked `%% inwards: layers` or `%% inwards: contexts` is a code
  block that INW017 reads: its ids and quoted labels (module prefixes) stay
  as written.
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
| Rule codes | INW000, INW001, ... INW017, FAPI001, ... | |
| Rule names | `package-shape`, `missing-member` | |
| Naming styles | lower_case_snake, snake case, camel case | INW016's table and column schemes |
| front matter, OKF | front matter, OKF | the rule pages' metadata block and its format; its keys (`autofix`, `suppressible`...) stay as written |
| CLI commands and flags | `inwards check`, `--format json`, `--agent claude`, ... | |
| File and config names | `pyproject.toml`, `[tool.inwards]`, `AGENTS.md`, `escalate-after`, ... | |
| Product names | Claude Code, Aider, Codex, Cursor, Copilot, Ruff, ty, mypy, import-linter, tree-sitter, Bun, Zensical, ... | |
| Tool terms | LSP, MCP, SARIF, WASM, CI, C4, ADR, JSON | |
| MCP tool names and their arguments | `check_files`, `explain_rule`, `where_should_this_go`, `contents`, `paths` | |
| scaffold (the example code, also the repo's early code) | scaffold (scaffoldu) | the `--scaffold` flag's output is "przykładowy pakiet" |
| fixture | fixture (fixture'a, fixture'y) | test and eval fixtures |
| ruleset (GitHub) | ruleset (rulesetu) | |
| runner, checkout | runner, checkout | CI terms |
| loader (module loader) | loader (loadera) | |
| launcher (`--launcher`, e.g. `uv run`) | launcher (launchera) | what starts Inwards in the project |
| worktree (git) | worktree (worktree'a, worktree'y) | |
| VSIX, Visual Studio Marketplace, Open VSX | VSIX (VSIX-a, pliki VSIX), Marketplace, Open VSX | the extension package and the two registries |
| personal access token (PAT) | token PAT (tokenu PAT) | `VSCE_PAT`, `OVSX_PAT` |
| daemon (`inwards daemon`), hook daemon | daemon (daemona, daemony), daemon hooków | the per-project process the PostToolUse hook talks to (ADR-039) |
| worker, worker pool | worker (workera, workery), pula workerów | |
| catch-all (an `Exception` handler) | catch-all | "handler catch-all dla `Exception`" |
| health check | health-check | "aplikacja health-check" |
| harness (agent harness: Copilot, Local in VS Code), matcher (hook) | harness (harnessu), matcher (matchera) | |
| Problems panel (VS Code) | panel Problems | |
| runtimepath, quickfix (Neovim) | runtimepath, quickfix | "w swoim runtimepath", "w oknie quickfix" |

## Fixed Polish terms

| English | Polish |
|---|---|
| adapter | adapter |
| allowlist, deny list (`allow-libraries`, `deny-libraries`, `extend-deny-libraries`) | lista dozwolonych, lista zakazów |
| agent, coding agent, AI agent | agent, agent kodujący, agent AI |
| agent loop | pętla agenta |
| annotation (GitHub Actions) | adnotacja |
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
| thread, worker thread (ADR-040) | wątek, wątek roboczy (worker); the main thread: wątek główny |
| extraction job | zadanie ekstrakcji |
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
| incremental parse (tree-sitter, from the last tree) | przyrostowe parsowanie |
| import skeleton | szkielet importów |
| job (CI) | zadanie |
| kernel (the `kernel` layer of the `fastapi` preset) | jądro (kernel) |
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
| a template's rules (`[tool.inwards.templates.<name>.rules]`); the top-level table (`[tool.inwards.rules]` and its options tables) | reguły szablonu, reguły dla roli; tabela najwyższego poziomu |
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
| lifespan (FastAPI, FAPI006) | lifespan (menedżer kontekstu cyklu życia aplikacji) |
| event handler (`on_event`, FAPI006) | handler zdarzeń |
| yield dependency (FAPI007) | zależność z `yield` |
| swallow an exception (FAPI007) | połykać wyjątek |
| operation id (`operation_id`, FAPI008) | identyfikator operacji (`operation_id`) |
| HTTP endpoint, thin endpoint (INW012) | endpoint HTTP, cienki endpoint |
| guard (`if <cond>: raise HTTPException(...)`, INW012) | warunek ochronny (guard) |
| signal, threshold (INW012) | sygnał, próg |
| route registration (`add_api_route`, `add_url_rule`, `Route`, `path`, INW012), registered handler | rejestracja trasy, zarejestrowany handler |
| class-based view, view class, view base class (INW012) | widok oparty na klasie, klasa widoku, klasa bazowa widoku |
| event loop (asyncio) | pętla zdarzeń |
| blocking call, blocking I/O (INW013) | wywołanie blokujące, blokujące I/O |
| blocking receiver (INW013) | blokujący odbiorca (nazwa, której metody blokują) |
| threadpool, worker thread | pula wątków, wątek roboczy |
| async client, sync client | klient asynchroniczny, klient synchroniczny |
| re-export (`from .views import f` in `__init__.py`) | reeksport |
| one hop (INW013, following a call into a sync helper) | jeden krok (w głąb funkcji pomocniczej) |
| table name, column name (INW016) | nazwa tabeli, nazwa kolumny |
| naming convention (`MetaData(naming_convention=...)`, INW016) | konwencja nazw |
| constraint (unique, check, foreign key, primary key) | ograniczenie (unikalności, check, klucza obcego, klucza głównego) |
| singular, plural | liczba pojedyncza, liczba mnoga |
| mass noun | rzeczownik niepoliczalny |
| migration (Alembic) | migracja |
| architecture diagram, marked diagram (INW017) | diagram architektury, oznaczony diagram |
| marker comment (`%% inwards: layers`) | komentarz-znacznik, znacznik |
| node, edge, link (Mermaid) | węzeł, krawędź |
| subgraph (Mermaid) | subgraph (subgraphu, subgraphy) |
| label, caption (of a node) | etykieta, podpis |
| docs drift (a diagram that no longer matches the config) | rozjazd dokumentacji |
| repository (the pattern) | repozytorium |
| port | port |
| ports and adapters, hexagonal architecture | porty i adaptery, architektura heksagonalna |
| port module (INW014) | moduł portu |
| abstract base class, ABC (`abc.ABC`) | abstrakcyjna klasa bazowa, ABC |
| Protocol (`typing.Protocol`) | Protocol (protokół strukturalny) |
| abstract method, method body (INW014) | metoda abstrakcyjna, ciało metody |
| implementation (of a port) | implementacja (portu) |
| DTO, value object | DTO, obiekt wartości |
| test double (in-memory repository) | dubel testowy (repozytorium w pamięci) |
| inbound adapter, outbound adapter | adapter wejściowy, adapter wyjściowy |
| guarded role (INW015's `role`), build an adapter | chroniona rola, budować adapter |
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
| rule list, rule browser (the filterable list on `rules/`) | lista reguł |
| category, sub-category (a rule page's `tags`) | kategoria, podkategoria |
| autofix (the rule list's filter and column; the key stays `autofix`) | poprawka automatyczna |
| rule status: stable, in review, in development, backlog | stabilna, w przeglądzie, w rozwoju, w planach |
| rules per page, page (pagination) | reguł na stronie, strona |
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
| resident process | stały proces |
| one-shot run (a hook or check in its own process) | jednorazowe uruchomienie, jednorazowo |
| socket, Unix domain socket | gniazdo, gniazdo uniksowe |
| named pipe (Windows) | nazwany potok |
| endpoint (a socket path or pipe name) | adres |
| framing (of a protocol) | ramkowanie |
| stale (a daemon, a build) | nieaktualny |
| start-up (process) | start (startu) |
| string (Python) | napis |
| suppression, inline suppression (`# inwards: ignore[...]`) | wyciszenie, wyciszenie w linii |
| reason (of a suppression) | powód |
| path operation (FastAPI) | operacja ścieżki |
| exception handler (FastAPI) | handler wyjątków |
| helper (function) | funkcja pomocnicza |
| inclusion (`include_router`) | dołączenie |
| splat (`**kwargs` in a call), splatted dict | rozpakowanie, rozpakowany słownik |
| app factory | fabryka aplikacji |
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
| workflow command (GitHub Actions, `::error`) | polecenie workflow |
| workspace (uv) | workspace (uv) |
| workspace package (a uv workspace member, INW005) | pakiet workspace'u |
| workspace (editor, VS Code) | obszar roboczy |
| workspace folder (editor) | folder obszaru roboczego |
| untrusted workspace, Restricted Mode (VS Code) | niezaufany obszar roboczy, tryb ograniczony |
| restricted setting (`restrictedConfigurations`) | ustawienie ograniczone |
| setting (VS Code, `inwards.path`) | ustawienie |
| registry (Marketplace, Open VSX) | rejestr |
| environment (GitHub Actions deployments) | środowisko (GitHub Actions) |
| platform package (one VSIX per platform) | pakiet dla platformy |
| thin client | cienki klient |
| file watcher (editor) | obserwator plików |
| cloud agent (Copilot, formerly coding agent) | agent w chmurze (cloud agent) |
| setup steps (`copilot-setup-steps.yml`) | kroki przygotowania |
| project root (the directory an editor starts a language server in), root marker | katalog główny projektu, znacznik katalogu głównego |
| dev extension (Zed) | rozszerzenie deweloperskie (dev extension) |
| headless (an editor run without its UI) | bez interfejsu (headless) |
| whole pass (language server: `inwards check` over the workspace) | przebieg całego projektu, przebieg |
| MCP server (`inwards mcp`), MCP client | serwer MCP, klient MCP |
| tool (MCP) | narzędzie |
| structured content (an MCP tool result's `structuredContent`) | treść strukturalna |
| probe module (`where_should_this_go`) | moduł próbny |
| protocol era, revision (MCP) | era protokołu, rewizja |
| texts laid over the disk (`project/overlay.ts`) | teksty nałożone na dysk |
