---
source: docs/chapters/guides/agents-md.md
source_hash: 9d84e9e1a21420c8fc990e1f9b92bf628196ce16c187807ec2fa5ad86140149c
---

# AGENTS.md (Codex, Cursor i inni) { #agentsmd-codex-cursor-and-others }

!!! info "Zweryfikowano 2026-09-25"
    Ręcznie na Linuksie: `init`, sekcja, którą zapisuje, i `inwards check --format json`. Żadnego agenta nie uruchomiono. Na macOS (arm64) i Windows CI uruchamia `init` ze skompilowanym plikiem binarnym przed każdym wydaniem; ręczne sprawdzenie na tych systemach wciąż jest do zrobienia.

Wielu agentów kodujących czyta instrukcje projektu z pliku [`AGENTS.md`](https://agents.md) w katalogu głównym repozytorium, między innymi OpenAI Codex, Cursor i Jules. Inwards dodaje tam krótką sekcję, która każe agentowi uruchomić sprawdzenie przed zakończeniem pracy i mówi, jak czytać wynik.

## Konfiguracja { #set-it-up }

1. [Zainstaluj Inwards](install.md) tak, żeby `inwards` było w `PATH` u każdego, kto uruchamia agenta, i dodaj `[tool.inwards]` do `pyproject.toml`.
2. W projekcie uruchom:

    <!-- e2e -->

    ```sh
    inwards init --agent agents-md
    ```

    Polecenie przypina `required-version` i domyślną listę `ignore` w `[tool.inwards]`, dodaje `.inwards/` do `.gitignore` i dopisuje do `AGENTS.md` tę sekcję (tworząc plik, jeśli trzeba):

    ```markdown
    <!-- inwards:begin -->
    ## Architecture check (Inwards)

    The layers in `[tool.inwards]` (pyproject.toml) are enforced. Before you finish a task, run:

        inwards check --format json

    Exit code 1 means an import breaks a layer: follow the numbered `fix.steps` in the output.
    Don't edit `[tool.inwards]` to make the check pass; ask the user instead.
    <!-- inwards:end -->
    ```

    Jeśli projekt uruchamia Inwards przez uv (zależność deweloperska, bez aktywowanego virtualenva), dodaj `--launcher "uv run"`, a sekcja poda `uv run inwards check --format json`:

    ```sh
    uv run inwards init --agent agents-md --launcher "uv run"
    ```

    Sekcja podaje jedno polecenie dla projektu. Uruchomione w katalogu głównym workspace'u uv, sprawdza każdego członka, który ma własne `[tool.inwards]` ([Monorepo i workspace'y uv](configuration.md#monorepos)). Przy kilku tabelach w innym układzie dopisz ręcznie, poza znacznikami, po linii na konfigurację, z `--config <package>/pyproject.toml`.

3. Zacommituj `AGENTS.md`. Ponowne uruchomienie `init` zastępuje tylko tekst między znacznikami.

## Opis architektury (opcjonalny) { #the-architecture-brief-opt-in }

Sekcja powyżej każe agentowi sprawdzić pracę po fakcie. Opis architektury (brief) podaje mu architekturę, zanim napisze pierwszy import: naprawa naruszenia kosztuje ponowną próbę, uniknięcie go nic nie kosztuje. Domyślnie jest wyłączony, żeby zespół mógł porównać przebiegi z nim i bez niego; inaczej wskaźnik naruszeń z run logu mieszałby jedno z drugim.

`inwards context` wypisuje opis dla najbliższej tabeli `[tool.inwards]`:

<!-- e2e -->

```sh
inwards context
```

Wymienia warstwy od najbardziej wewnętrznej, z tym, co każda może importować, miejsce, w którym leżą porty, a jeśli są skonfigurowane, także reguły bibliotek (INW005), konteksty z ich publicznymi modułami i zależnościami (INW002, INW003) oraz reguły opt-in włączone w konfiguracji. Reguły wyłączone w `[tool.inwards.rules]` są pomijane. Warstwa, która ma pod sobą więcej niż trzy warstwy, podaje je numerami z listy (`may import layers 1-9`); brief, który tak robi, wymienia grupy warstw sąsiednich raz, w pierwszym zdaniu (`sibling groups: 2-4; 5-6`), a nie w każdej linii. Publiczne moduły kontekstu leżące w jego jedynym module dzielą ten prefiks (`` `app.posts.{router,service}` ``), podobnie jak moduły wpisu `deny` o wspólnym rodzicu (`` `app.*.{models,service}` ``). Gdy INW002 jest wyłączona, konteksty nie podają swoich zależności. Dla przykładowej konfiguracji repozytorium (`examples/clean-app`) ma 678 znaków, około 170 tokenów; test pilnuje, żeby przykład i każdy preset mieściły się poniżej 300 tokenów (przy czterech znakach na token), poza presetem fastapi, który z jedenastoma warstwami, wpisem `deny` i jedenastoma regułami opt-in ma się zmieścić poniżej 550 (ma około 540). Ze znacznikami, które dodaje `--write`, wygląda tak:

```markdown
<!-- inwards-brief:begin -->
## Architecture brief (Inwards)

`[tool.inwards]` in pyproject.toml enforces these layers, innermost first. Imports point inwards: never import a layer listed after your own.

1. domain (`shop.domain`): imports no other layer
2. application (`shop.application`): may import domain
3. infrastructure (`shop.infrastructure`): may import domain, application
4. interface (`shop.api`, `shop.cli`): may import every other layer

Ports: when an inner layer needs something from an outer one, declare a `typing.Protocol` in `shop.domain.ports` and implement it in the outer layer.

Libraries (INW005):
- domain: no web frameworks, database or network clients, `subprocess` or `socket`
<!-- inwards-brief:end -->
```

Porty to pakiet albo moduł `ports` leżący bezpośrednio w module warstwy na dysku (tutaj `shop/domain/ports.py`). Dla konfiguracji zapisanej przez `inwards init --style` opis podaje też nazwę presetu i jego moduł portów (`app.application.ports` dla clean i hexagonal), zanim `--scaffold` go utworzy; preset rozpoznaje po komentarzu, który init umieszcza w tabeli, więc usunięcie tego komentarza usuwa też nazwę.

Każda reguła opt-in włączona w konfiguracji (INW012 do INW016 i reguły FAPI, przez `extend-select`, `select` albo [regułę dla roli](configuration.md#template-rules)) dodaje jedną linię pod „Opt-in rules:”. Linia mówi, co robić przy pisaniu kodu, i podaje kluczowe ustawienie reguły: `delegate-to` dla INW012, moduły portów dla INW014 (jej `modules`, a bez nich każdy moduł `ports`), `role` i `allowed-in` dla INW015, schemat nazw dla INW016, wymagane metadane dla FAPI001, `codes` dla FAPI002 i `entrypoints` dla FAPI003. Reguła zawężona przez `modules` je wymienia (`INW013 in app.*.router`). INW015 bez `role` niczego nie sprawdza, więc wtedy nie dostaje linii. Po `inwards init --style fastapi` wyglądają tak:

```markdown
Opt-in rules:
- INW012: endpoints stay thin: call into `domain.service`; no queries or outgoing calls
- INW013: no blocking calls in `async def`: use async clients or a plain `def`
- INW016 in `app.*.models`: singular snake_case tables; datetime/date columns end in `_at`/`_date`
- FAPI001: path operations need a summary or docstring, a response model, `status_code` on POST/DELETE and `description` per `responses` entry
- FAPI002: declare every 4xx a path operation raises in `responses`
- FAPI003: include every `APIRouter` in an app; no include cycles
- FAPI005: declare `/items/me` before `/items/{id}`, so no route is shadowed
- FAPI006: startup and shutdown go in a lifespan, not `on_event`
- FAPI007: a dependency with `yield` re-raises what it catches
- FAPI008: each `operation_id` is unique within its app
- FAPI009: pass `Depends(get_db)`, not `Depends(get_db())`
```

Żeby trzymać go w `AGENTS.md`, między własnymi znacznikami obok sekcji sprawdzenia:

- `inwards context --write` dodaje sekcję albo zastępuje w miejscu tekst między `<!-- inwards-brief:begin -->` i `<!-- inwards-brief:end -->`. Uruchom je ponownie po zmianie `[tool.inwards]`; gdy nic się nie zmieniło, odpowiada „up to date”.
- `inwards init --agent agents-md --brief` zapisuje obie sekcje w jednym uruchomieniu. `--brief` działa z każdym `--agent`, z `--style` i samodzielnie (`inwards init --brief`).

Opis trafia zawsze do `AGENTS.md`, nigdy do `CLAUDE.md`: jeden plik obsługuje wszystkich agentów, a repozytorium, w którym `CLAUDE.md` to jedna linia `@AGENTS.md` (jak w tym), daje Claude Code ten sam tekst. Jeśli twój `CLAUDE.md` nie ma takiej linii, dodaj ją, bo inaczej Claude Code nie zobaczy opisu.

## Sprawdź, czy działa { #check-it-works }

- Uruchom sam `inwards check --format json`. Licznik `violations` równy 0 w podsumowaniu oznacza, że projekt jest czysty.
- Poproś agenta o zmianę w warstwie domeny. Na koniec powinien uruchomić `inwards check --format json` i podać wynik.

## Rozwiązywanie problemów { #troubleshooting }

| Objaw | Przyczyna i rozwiązanie |
|---|---|
| Agent nigdy nie uruchamia sprawdzenia | To instrukcja, a nie hook, więc agent może ją pominąć. Użyj agenta z hookami (takiego jak [Claude Code](claude-code.md)) albo uruchamiaj `inwards check` w CI. |
| `init` zatrzymuje się z komunikatem „unmatched markers” | `AGENTS.md` nie ma dokładnie jednego znacznika `inwards:begin` i jednego `inwards:end` (albo, dla opisu architektury, jednego `inwards-brief:begin` i jednego `inwards-brief:end`). Popraw je albo usuń ręcznie, a potem uruchom `init` ponownie. |
| `inwards: command not found` w powłoce agenta | Środowisko agenta nie widzi pliku binarnego. Dodaj go tam do `PATH` albo, gdy Inwards jest zależnością deweloperską uv, uruchom ponownie `init` z `--launcher "uv run"`. (Edycja polecenia między znacznikami działa do następnego `init`, który przywraca sekcję). |

Twardą blokadę daje `inwards check` w CI: kod wyjścia 1 oblewa zadanie. [Przewodnik po GitHub Actions](ci.md) zawiera workflow, który dodatkowo dodaje adnotacje do pull requestu i wysyła SARIF do code scanning.
