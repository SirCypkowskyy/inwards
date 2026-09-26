---
source: docs/chapters/guides/claude-code.md
source_hash: 290ebc980e52d92af366303ad3f11eb1416452c1af5f020df9572fd4291b886a
---

# Claude Code { #claude-code }

!!! info "Zweryfikowano 2026-09-25"
    Ręcznie na Linuksie: `init` i jego wyjście oraz nieinteraktywna sesja (headless) `claude -p` w Claude Code 2.1.282, w której edycja konfiguracji została odrzucona, naruszenie zgłoszone, a Stop gate eskalował do użytkownika. Interaktywnego kroku `/hooks` nie uruchomiono. Na macOS (arm64) i Windows CI uruchamia `init` i hook ze skompilowanym plikiem binarnym przed każdym wydaniem; ręczne sprawdzenie na tych systemach wciąż jest do zrobienia.

Z zainstalowanymi hookami Inwards sprawdza każdy plik Pythona, który zapisuje Claude. Nie pozwala zakończyć tury, dopóki zmiany z sesji łamią warstwę, i odrzuca edycje samych reguł. [Rozdział 4](../04-AI-Integration.md) wyjaśnia, jak to zaprojektowano.

## Konfiguracja { #set-it-up }

1. [Zainstaluj Inwards](install.md) i dodaj `[tool.inwards]` do `pyproject.toml`.
2. W projekcie uruchom:

    <!-- e2e -->

    ```sh
    inwards init --agent claude --dry-run   # shows what will change
    inwards init --agent claude
    ```

    To zapisuje cztery hooki (SessionStart, PreToolUse, PostToolUse, Stop) i dwie reguły `permissions.deny` w `.claude/settings.local.json`. Ten plik zawiera ścieżkę do pliku binarnego na tej maszynie, więc `init` dodaje go do `.gitignore`, razem z `.inwards/`. Przypina też `required-version` i domyślną listę `ignore` w `[tool.inwards]`. Ponowne uruchomienie niczego nie zmienia.

3. Rozpocznij nową sesję Claude Code w projekcie (albo uruchom `/clear`). Hooki zainstalowane w trakcie sesji też działają, ale Stop gate potrzebuje zapisu początku sesji.

## Sprawdź, czy działa { #check-it-works }

- W Claude Code uruchom `/hooks`. `inwards` jest na liście pod SessionStart, PreToolUse, PostToolUse i Stop.
- Poproś Claude'a: *„Dodaj `import shop.infrastructure.db` na początku shop/domain/order.py.”* Edycja przechodzi, po czym Claude dostaje raport INW001 i usuwa import albo wprowadza port.
- Poproś Claude'a: *„Przenieś shop.infrastructure do warstwy domain w pyproject.toml.”* Edycja zostaje odrzucona z komunikatem, który każe Claude'owi zapytać ciebie.

## Rozwiązywanie problemów { #troubleshooting }

| Objaw | Przyczyna i rozwiązanie |
|---|---|
| Przy edycjach nic się nie dzieje | Uruchom `/hooks`. Jeśli brakuje `inwards`, uruchom ponownie `inwards init --agent claude`. Jeśli hooki są wyłączone, poszukaj `disableAllHooks` w plikach ustawień (wygrywa wartość z pliku o najwyższym priorytecie) albo flagi `--settings`, która to ustawia. |
| „Inwards has no record of how this session started” | Hooki zainstalowano po rozpoczęciu sesji. Rozpocznij nową sesję albo uruchom `/clear`. |
| „The Inwards … hook is missing from every Claude Code settings file” | Edycja ustawień usunęła hook albo konfigurację zrobiono, zanim ta wersja dodała nowy hook (config guard w PreToolUse). Uruchom ponownie `inwards init --agent claude`. |
| „This project requires Inwards X or newer” | `required-version` jest nowsze niż twój plik binarny. Zainstaluj nowsze wydanie. |
| `config error: Unknown key tool.inwards.…` | Literówka w `[tool.inwards]`. Komunikat podaje klucz i wypisuje znane klucze. |
| Claude mówi, że edycja `pyproject.toml` została odrzucona | Edycja dotknęła `[tool.inwards]`. To config guard. Jeśli naprawdę chcesz zmienić warstwy, zrób to sam. |
| Komunikat „an inline suppression that wasn't in the file when the session started” | Hooki pomijają wyciszenie dodane w trakcie sesji albo takie, które jest w pliku niezacommitowanym na starcie sesji ([ADR-028](../05-ADR.md#adr-028-inline-suppressions-need-a-reason-and-an-agent-cant-add-one-by-default)). Jeśli dodałeś je sam, zacommituj je i zacznij nową sesję; żeby Claude mógł je dodawać, ustaw `agent-suppressions = "allow"` w `[tool.inwards]`. |
| Tura kończy się komunikatem „unresolved architecture problems” | To samo naruszenie przetrwało `escalate-after` prób (domyślnie 3). Claude powinien zapytać cię, co dalej. Lista trafia też do następnej sesji. |
| Windows: hook się nie uruchamia | `init` zapisuje hook w formie exec, z bezwzględną ścieżką do pliku binarnego, więc nie biorą w tym udziału ani powłoka, ani `PATH`. Jeśli przeniesiono plik binarny, uruchom ponownie `init`. |

Żeby udostępnić tę konfigurację zespołowi przez commitowany plik `.claude/settings.json`, zobacz przykład w formie powłokowej w [rozdziale 4](../04-AI-Integration.md). Wymaga on `inwards` w `PATH` każdego programisty.
