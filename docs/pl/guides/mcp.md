---
source: docs/chapters/guides/mcp.md
source_hash: 8b692e63633b0e56a9b67206a0e677f7bb1f6f3644f40634786e2a10e4aac152
---

# Serwer MCP { #mcp-server }

!!! info "Zweryfikowano 2026-10-10"
    Na macOS (arm64), ze skompilowanym plikiem binarnym na `examples/broken-app`: Claude Code 2.1.296 (`--mcp-config`) i Codex CLI 0.162.0 (`-c mcp_servers.inwards...`) uruchomiły `inwards mcp` i wywołały `check_files`, `explain_rule` oraz `where_should_this_go`. Na Linuksie CI przy każdym PR steruje skompilowanym plikiem binarnym przez stdio klientem z SDK MCP, w obu erach protokołu. Na Windows nie sprawdzano tego ręcznie.

`inwards mcp` to serwer [Model Context Protocol](https://modelcontextprotocol.io/) przez stdio. Agent z klientem MCP może zapytać Inwards, gdzie należy nowy kod, i sprawdzić kod, zanim go zapisze, zamiast dowiadywać się o problemie od hooka po fakcie. Uzupełnia hooki ([Claude Code](claude-code.md), [OpenCode](opencode.md)) i [opis architektury](agents-md.md#the-architecture-brief-opt-in), ale ich nie zastępuje, bo agent wywołuje narzędzie tylko wtedy, gdy sam tak zdecyduje.

Ma trzy narzędzia:

| Narzędzie | Co dostaje agent |
|---|---|
| `check_files` | `inwards check` na plikach, katalogach, całym projekcie albo kodzie Pythona, którego jeszcze nie zapisano, jako raport `inwards/diagnostics@1` |
| `explain_rule` | stronę dokumentacji reguły: co zgłasza, dlaczego, przykład i jak to naprawić |
| `where_should_this_go` | warstwę i moduł, do których należy nowy kod, oraz to, które z jego importów odrzuciłaby każda warstwa |

## Konfiguracja { #set-it-up }

1. [Zainstaluj Inwards](install.md) i dodaj `[tool.inwards]` do `pyproject.toml`.
2. Zarejestruj serwer w swoim kliencie MCP. Klient uruchamia `inwards mcp` w katalogu projektu i zatrzymuje go, gdy kończy się sesja.

=== "Claude Code"

    Dla siebie, w tym projekcie:

    ```sh
    claude mcp add inwards -- inwards mcp
    ```

    Dla każdego, kto otworzy projekt, w commitowanym `.mcp.json`; z uv każdy projekt dostaje własną wersję Inwards:

    ```sh
    claude mcp add --scope project inwards -- uv run inwards mcp
    ```

    Claude Code za pierwszym razem prosi każdego użytkownika o zatwierdzenie serwerów projektu. Potem `claude mcp list` pokazuje `inwards` jako połączony, a `/mcp` w sesji wymienia jego trzy narzędzia.

=== "Codex CLI"

    ```sh
    codex mcp add inwards -- inwards mcp
    ```

    Albo ręcznie, w `~/.codex/config.toml`:

    ```toml title="~/.codex/config.toml"
    [mcp_servers.inwards]
    command = "inwards"
    args = ["mcp"]
    ```

    Codex uruchamia serwer w katalogu sesji, więc narzędzia widzą projekt, w którym uruchamiasz `codex`.

=== "Inni klienci"

    Większość klientów (Cursor, VS Code, Windsurf, Zed) przyjmuje wpis JSON z poleceniem i jego argumentami; plik i klucz najwyższego poziomu znajdziesz w dokumentacji klienta:

    ```json title=".cursor/mcp.json"
    {
      "mcpServers": {
        "inwards": { "command": "inwards", "args": ["mcp"] }
      }
    }
    ```

    Narzędzia rozwiązują ścieżki względne względem katalogu, w którym klient uruchamia serwer. Jeśli twój klient uruchamia go gdzie indziej, podawaj ścieżki bezwzględne albo katalog projektu jako `path` w `where_should_this_go`.

Przy połączeniu serwer mówi klientowi, kiedy używać każdego narzędzia: `where_should_this_go` przed napisaniem nowego modułu, `check_files` przed zapisaniem kodu Pythona, `explain_rule` przy kodzie reguły w diagnostyce, i nigdy nie edytować `[tool.inwards]`, żeby diagnostyka zniknęła.

## `check_files` { #check_files }

Uruchamia `inwards check` z katalogu projektu i zwraca [raport `inwards/diagnostics@1`](../04-AI-Integration.md#formats), ten sam JSON co `inwards check --format json`.

| Argument | Typ | Znaczenie |
|---|---|---|
| `paths` | lista napisów | Pliki lub katalogi, względem katalogu projektu albo bezwzględne |
| `contents` | obiekt: ścieżka → tekst | Kod Pythona do sprawdzenia zamiast tego, co jest na dysku, według ścieżki `.py` lub `.pyi`. Plik nie musi jeszcze istnieć |
| `maxDiagnostics` | dodatnia liczba całkowita | Najwyżej tyle diagnostyk, najpierw błędy; podsumowanie nadal liczy wszystkie |

Bez `paths` i `contents` sprawdza cały projekt, łącznie z regułami dla całego projektu, takimi jak cykle importów (INW004). Z nimi sprawdza te pliki tak, jak robi to `inwards check PATHS`. Każda ścieżka trafia do najbliższego `[tool.inwards]` nad nią, a członkowie workspace'u uv używają własnych konfiguracji.

`contents` to sposób, w jaki agent sprawdza kod, zanim go zapisze. Plik, którego jeszcze nie ma, nawet w pakiecie, którego jeszcze nie ma, jest sprawdzany tak, jakby był zapisany: dostaje nazwę modułu i trafia do indeksu modułów, więc inne pliki w tym samym wywołaniu mogą go importować. Nic nie jest zapisywane na dysk. Poproszone o sprawdzenie nowego `shop/domain/pricing.py`:

```json
{ "contents": { "shop/domain/pricing.py": "import sqlalchemy\n" } }
```

narzędzie odpowiada diagnostyką, którą hook zgłosiłby po edycji (skrócone):

```json
{
  "schema": "inwards/diagnostics@1",
  "summary": { "filesChecked": 1, "violations": 1, "warnings": 0, "durationMs": 2.3 },
  "diagnostics": [
    {
      "code": "INW005",
      "file": "shop/domain/pricing.py",
      "line": 1,
      "message": "Layer \"domain\" imports \"sqlalchemy\" from library \"sqlalchemy\", which \"domain\" may not use.",
      "fix": { "summary": "Use \"sqlalchemy\" in an outer layer, behind a port owned by \"domain\".", "steps": ["..."] },
      "docs": "https://sircypkowskyy.github.io/inwards/rules/INW005/"
    }
  ]
}
```

Baseline działa jak w `inwards check`. Zepsuta konfiguracja albo ścieżka w `contents`, która nie jest plikiem Pythona, wraca jako błąd narzędzia z powodem.

## `explain_rule` { #explain_rule }

| Argument | Typ | Znaczenie |
|---|---|---|
| `rule` | napis, wymagany | Kod reguły (`INW001`, `fapi003`) albo jej nazwa (`layer-dependency`), wielkość liter bez znaczenia |
| `full` | wartość logiczna | Zwraca też sekcje Configuration, Fix safety, Known limitations i, jeśli strona ją ma, How it works |

Zwraca [stronę dokumentacji](../rules/index.md) reguły jako Markdown: kod, nazwę, poziom, informację, czy reguła jest domyślnie włączona, oraz sekcje What it does, Why is this bad, Example i How to fix. Strony są wbudowane w plik binarny, więc odpowiedź to strona wersji, której używasz, i działa bez sieci. Linki prowadzą do opublikowanej strony. Treść strukturalna zawiera te same pola: `code`, `name`, `summary`, `description`, `severity`, `default`, `status`, `suppressible`, `autofix`, `docs` i `sections`. Strony są po angielsku.

Bez klienta MCP `inwards rule INW001` (albo `inwards rule layer-dependency`) wypisuje ten sam tekst, `--full` dodaje pozostałe sekcje, a `--json` wypisuje treść strukturalną. Nieznana reguła kończy się kodem wyjścia 2 i podpowiada najbliższą. `inwards rules` wypisuje wszystkie reguły z informacją, czy projekt je włącza ([konfiguracja](configuration.md#rules)).

## `where_should_this_go` { #where_should_this_go }

| Argument | Typ | Znaczenie |
|---|---|---|
| `description` | napis | Co robi kod, w kilku słowach: „SQL repository for orders” |
| `imports` | lista napisów | Co kod będzie importował: moduły (`shop.domain.order`), klasy w nich (`shop.domain.order.Order`) i biblioteki (`sqlalchemy`) |
| `module` | napis | Moduł z kropkami, w którym planujesz umieścić kod, do oceny |
| `path` | napis | Katalog lub plik w projekcie, który wybiera jego `pyproject.toml`; domyślnie katalog projektu |

Narzędzie nie czyta warstw drugim sposobem. Tworzy moduł próbny, który zawiera tylko podane importy, i sprawdza go własnym sprawdzeniem Inwards, w pamięci: raz w miejscu `module`, jeśli go podano, i raz w nowym module w każdej warstwie (pierwszy prefiks modułów warstwy plus nazwa wzięta z `module` albo z opisu). Dzięki temu głos mają kolejność warstw, warstwy równoległe, konteksty, reguły bibliotek w warstwach i indeks modułów: import jest odrzucany z INW001, INW002, INW003, INW005 albo INW010, tak jak odrzucony byłby w prawdziwym pliku w tym miejscu. Nazwa, której ostatnia część zaczyna się wielką literą (`Order`), jest importowana jako nazwa ze swojego modułu; każda inna jako moduł, więc moduł, którego nie ma, zostaje zgłoszony.

Sugestia to, w tej kolejności:

1. wskazany `module`, gdy przechodzą w nim wszystkie jego importy;
2. z `imports`: spośród warstw, w których przechodzą wszystkie, ta, na którą wskazuje opis, a w przeciwnym razie najbardziej wewnętrzna;
3. bez `imports`: warstwa, na którą wskazuje opis.

Opis wskazuje warstwę, gdy ją nazywa albo nazywa ostatnią część jej prefiksu modułów („an infrastructure adapter”), albo przez krótką listę angielskich słów o roli kodu: encja, obiekt wartości, port czy protokół to kod wewnętrzny, przypadek użycia czy serwis leżą pośrodku, a adapter SQL, HTTP, CLI albo frameworka, trasa czy repozytorium to kod zewnętrzny. Słowa są podpowiedzią na wypadek, gdy importy pozwalają na kilka warstw; o tym, co wolno importować i gdzie, decyduje sprawdzenie.

Z trzema warstwami z [przykładu na stronach reguł](../rules/INW001.md#example) to wywołanie:

```json
{ "description": "SQL repository for orders", "imports": ["sqlalchemy", "shop.domain.order.Order"] }
```

odpowiada:

```text
Suggested: `shop.infrastructure.sql_repository_orders` (shop/infrastructure/sql_repository_orders.py), in layer "infrastructure", based on the description.

Layers that refuse some import:
- domain: `sqlalchemy` (INW005)

Layers, innermost first:
- domain (shop.domain): may import domain
- application (shop.application): may import domain, application
- infrastructure (shop.infrastructure): may import domain, application, infrastructure
```

Treść strukturalna ma `config`, `layers` (każda z `name`, `modules` i `mayImport`), `contexts` (`name`, `modules`, `public`, `dependsOn`), `module`, gdy go wskazano (jego `layer`, `context`, `file` i odrzucone importy), `candidates` (po jednym na warstwę, każdy z `layer`, `module`, `file` i `blocked`, czyli odrzuconymi importami z kodem reguły i komunikatem) oraz `suggestion` (`layer`, `module`, `file` i `basis`: `module`, `imports` albo `description`).

## Jak działa { #how-it-runs }

- **Jeden proces na sesję klienta**, uruchamiany przez klienta i kończony, gdy klient zamknie stdin. Korzysta z rozgrzanego silnika CLI razem z `inwards server` i `inwards daemon`, ale nie rozmawia z żadnym z nich ([ADR-039](../05-ADR.md#adr-039-a-hook-daemon-per-project-separate-from-the-language-server), [ADR-042](../05-ADR.md#adr-042-inwards-mcp-answers-with-inwards-checks-own-check-on-texts-laid-over-the-disk)).
- **Każde wywołanie czyta konfigurację, baseline i listing plików od nowa**, więc edycja `[tool.inwards]` liczy się od następnego wywołania. Między wywołaniami trzyma w pamięci tylko to, co wyekstrahował z tekstu każdego pliku.
- **Tylko do odczytu.** Żadne narzędzie nie zapisuje pliku, a wywołania nie trafiają do [run logu](../08-Run-Log.md). Wywołania idą jedno po drugim.
- **Stdout niesie tylko MCP.** Obsługiwani są zarówno klienci zaczynający od `initialize` (rewizje z 2025 roku), jak i klienci zaczynający od rewizji 2026-07-28.

## Ograniczenia { #limits }

- Agent wywołuje narzędzie wtedy, gdy sam tak zdecyduje. Hooki i Stop gate nadal łapią to, o co nie zapytał, a CI łapie resztę.
- `where_should_this_go` proponuje jeden nowy moduł na warstwę, pod pierwszym dosłownym prefiksem warstwy. Warstwa zadeklarowana tylko selektorami (`shop.*.domain`) nie dostaje kandydata; podaj `module`, żeby ocenić moduł w jednym wycinku.
- Słów o roli kodu jest niewiele i są po angielsku. Opis innymi słowami nie daje podpowiedzi, a sugestia wraca do najbardziej wewnętrznej warstwy, w której przechodzą importy.
- `contents` przyjmuje tylko pliki Pythona. Niezapisany `pyproject.toml` ani baseline nie są sprawdzane; liczą się te na dysku.
