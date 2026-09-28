---
source: docs/chapters/guides/claude-code.md
source_hash: 8308b8a5ae38e6702795461c092555c9b8a20f80ae74d58ed937465efc84be98
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

    Jeśli Inwards jest zależnością deweloperską uv, zapisz launcher zamiast ścieżki:

    ```sh
    uv run inwards init --agent claude --launcher "uv run"
    ```

    Każdy hook uruchamia wtedy w powłoce `cd "$CLAUDE_PROJECT_DIR" && uv run inwards hook claude-code`, z katalogu głównego projektu, więc korzysta z własnego środowiska projektu w każdym worktree i na każdej maszynie. `--launcher` przyjmuje narzędzie uruchamiające (`uv`, `uvx`, `poetry`, `pdm`, `hatch`, `pipx`, `rye`, `pixi`, `bunx`, `npx` albo `python`) z podkomendą i opcjami, i to tylko jako zwykłe słowa (litery, cyfry i `_ . : @ = + / -`), bo trafia do polecenia powłoki bez cudzysłowów. Bramka Stop uznaje za hooki Inwards tylko takie polecenia, więc `echo inwards hook claude-code` nie może ich zastąpić.

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
| „The Inwards Stop hook is missing …” na starcie sesji | Hook Stop zniknął z ustawień, a pozostałe hooki Inwards zostały. Taki ślad zostawia agent, który edytuje `settings.local.json` przez Bash. Claude Code od razu przeładowuje hooki, więc do końca tamtej sesji Stop gate się nie uruchamiał. Uruchom ponownie `inwards init --agent claude` i przejrzyj, co tamta sesja zmieniła. |
| „A SessionStart for this session arrived after it had started” albo „start record … is missing from” / „was rewritten in .inwards/state” | Zapis sesji w `.inwards/state` został usunięty albo przepisany, albo ktoś ręcznie przekazał SessionStart do `inwards hook`, jak może to zrobić Bash agenta, żeby wyzerować punkt odniesienia Stop gate. Inwards sprawdził zmiany względem kopii zapisu startu, którą trzyma w `$XDG_STATE_HOME/inwards/sessions/` (domyślnie `~/.local/state/inwards/sessions/`). Przejrzyj zmiany z sesji; następna sesja zaczyna się czysto. |
| „Inwards couldn't keep a copy of this session's start outside the project” na starcie sesji | Katalogu stanu (`$XDG_STATE_HOME`, a bez niego `~/.local/state`) nie da się zapisać, na przykład gdy katalog domowy jest tylko do odczytu. Sesja działa normalnie, ale Stop gate ufa wtedy `.inwards/state` tylko dopóki `[tool.inwards]` jest tym zatwierdzonym. Wskaż w `XDG_STATE_HOME` katalog z prawem zapisu. |
| „Inwards has no copy of this session's start record outside the project” | Sesję zaczęła starsza wersja Inwards albo kopię usunięto lub nie dało się jej zapisać, a `[tool.inwards]` na starcie sesji nie było tym zatwierdzonym. Jeśli zmieniłeś je sam, zatwierdź zmianę i zacznij nową sesję (sprawdzenie porównuje z commitem, od którego sesja się zaczęła); jeśli kopii nie dało się zapisać, zadbaj też o `XDG_STATE_HOME` z prawem zapisu. |
| „... this git (older than 2.44) can't read the committed [tool.inwards] here ...” | Jak wyżej, ale git starszy niż 2.44 mógłby w częściowym klonie coś pobrać przy odczycie zatwierdzonej konfiguracji (albo Inwards nie mógł odczytać konfiguracji gita, żeby to wykluczyć), więc Inwards jej nie czyta. Zaktualizuj gita do 2.44 lub nowszego albo wskaż w `XDG_STATE_HOME` katalog z prawem zapisu, żeby sesje zachowywały kopię. |
| „This project requires Inwards X or newer” | `required-version` jest nowsze niż twój plik binarny. Zainstaluj nowsze wydanie. |
| `config error: Unknown key tool.inwards.…` | Literówka w `[tool.inwards]`. Komunikat podaje klucz i wypisuje znane klucze. |
| Claude mówi, że edycja `pyproject.toml` została odrzucona | Edycja dotknęła `[tool.inwards]`. To config guard. Jeśli naprawdę chcesz zmienić warstwy, zrób to sam. |
| Claude mówi, że nowy plik `.py` „was not created” | `[[tool.inwards.shape]]` albo `[[tool.inwards.names]]` pakietu nie dopuszcza tej nazwy, więc shape guard odrzucił `Write` ([INW007](../rules/INW007.md)). Powód mówi, gdzie powinien trafić kod. Jeśli pakiet potrzebuje tego elementu, zmień kształt sam. |
| Komunikat „an inline suppression that wasn't in the file when the session started” | Hooki pomijają wyciszenie dodane w trakcie sesji albo takie, które jest w pliku niezacommitowanym na starcie sesji, zbyt dużym, żeby hooki zachowały jego kopię (ponad 512 KiB albo ponad limit 4 MiB takich plików), i zedytowanym później ([ADR-028](../05-ADR.md#adr-028-inline-suppressions-need-a-reason-and-an-agent-cant-add-one-by-default)). Jeśli dodałeś je sam, zacommituj je i zacznij nową sesję; żeby Claude mógł je dodawać, ustaw `agent-suppressions = "allow"` w `[tool.inwards]`. |
| Tura kończy się komunikatem „unresolved architecture problems” | To samo naruszenie przetrwało `escalate-after` prób (domyślnie 3). Claude powinien zapytać cię, co dalej. Lista trafia też do następnej sesji. |
| `init` ostrzega, że ścieżka „is in uv's cache” (albo bunx's) | Uruchomiono go przez `uvx` albo `bunx`, więc ścieżka, którą by zapisał, znika po `uv cache clean` albo przy następnej wersji. Dodaj Inwards do projektu i uruchom `uv run inwards init --agent claude --launcher "uv run"` albo zainstaluj plik binarny z wydania i uruchom nim `init`. |
| Windows: hook się nie uruchamia | `init` zapisuje hook w formie exec, z bezwzględną ścieżką do pliku binarnego, więc nie biorą w tym udziału ani powłoka, ani `PATH`. Jeśli przeniesiono plik binarny, uruchom ponownie `init`. Z `--launcher` hook działa w powłoce Claude Code, na Windows w Git Bash. |

Żeby udostępnić tę konfigurację zespołowi przez commitowany plik `.claude/settings.json`, zobacz przykład w formie powłokowej w [rozdziale 4](../04-AI-Integration.md). Wymaga on `inwards` w `PATH` każdego programisty.
