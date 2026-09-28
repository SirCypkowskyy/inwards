---
source: docs/chapters/guides/agents-md.md
source_hash: ccf2feeb7c3de658215fae83f7463a23fec506b61621b2550a39938f3103ad47
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

    Sekcja podaje jedno polecenie dla projektu. Przy kilku tabelach `[tool.inwards]` (na przykład w workspace uv) dopisz ręcznie, poza znacznikami, po linii na konfigurację, z `--config <member>/pyproject.toml`.

3. Zacommituj `AGENTS.md`. Ponowne uruchomienie `init` zastępuje tylko tekst między znacznikami.

## Sprawdź, czy działa { #check-it-works }

- Uruchom sam `inwards check --format json`. Licznik `violations` równy 0 w podsumowaniu oznacza, że projekt jest czysty.
- Poproś agenta o zmianę w warstwie domeny. Na koniec powinien uruchomić `inwards check --format json` i podać wynik.

## Rozwiązywanie problemów { #troubleshooting }

| Objaw | Przyczyna i rozwiązanie |
|---|---|
| Agent nigdy nie uruchamia sprawdzenia | To instrukcja, a nie hook, więc agent może ją pominąć. Użyj agenta z hookami (takiego jak [Claude Code](claude-code.md)) albo uruchamiaj `inwards check` w CI. |
| `init` zatrzymuje się z komunikatem „unmatched markers” | `AGENTS.md` nie ma dokładnie jednego znacznika `inwards:begin` i jednego `inwards:end`. Popraw je albo usuń ręcznie, a potem uruchom `init` ponownie. |
| `inwards: command not found` w powłoce agenta | Środowisko agenta nie widzi pliku binarnego. Dodaj go tam do `PATH` albo, gdy Inwards jest zależnością deweloperską uv, uruchom ponownie `init` z `--launcher "uv run"`. (Edycja polecenia między znacznikami działa do następnego `init`, który przywraca sekcję). |

Twardą blokadę daje `inwards check` w CI: kod wyjścia 1 oblewa zadanie. [Przewodnik po GitHub Actions](ci.md) zawiera workflow, który dodatkowo dodaje adnotacje do pull requestu i wysyła SARIF do code scanning.
