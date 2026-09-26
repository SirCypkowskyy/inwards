---
source: docs/chapters/guides/aider.md
source_hash: 75ff3bef545e9915dbeac39b2ecbf86c2a3dabe401a18cd2d013a8676116b1cc
---

# Aider

!!! info "Zweryfikowano 2026-09-25"
    Ręcznie na Linuksie: `init` oraz `lint-cmd` uruchomione tak, jak uruchamia je Aider (z katalogu głównego repozytorium git, raz na każdy edytowany plik). Samego Aidera nie uruchomiono. Na macOS (arm64) i Windows CI uruchamia `init` i `check` ze skompilowanym plikiem binarnym przed każdym wydaniem; ręczne sprawdzenie na tych systemach wciąż jest do zrobienia.

Aider po każdej edycji uruchamia polecenie lintujące i prosi model, żeby naprawił to, co ono zgłosi. Inwards podłącza się jako to polecenie dla plików Pythona.

## Konfiguracja { #set-it-up }

1. [Zainstaluj Inwards](install.md) i dodaj `[tool.inwards]` do `pyproject.toml`.
2. W projekcie uruchom:

    <!-- e2e -->

    ```sh
    inwards init --agent aider
    ```

    Polecenie przypina `required-version` i domyślną listę `ignore` w `[tool.inwards]`, dodaje `.inwards/` do `.gitignore` i wypisuje linię do dodania w konfiguracji Aidera. Linia zawiera bezwzględną ścieżkę do twojego pliku binarnego:

    ```yaml title=".aider.conf.yml"
    lint-cmd: "python: '/home/you/.local/bin/inwards' check --format text"
    ```

3. Dodaj tę linię do `.aider.conf.yml` w projekcie (albo w katalogu domowym, dla wszystkich projektów). Zostaw włączone `auto-lint` Aidera; jest włączone domyślnie.

Aider uruchamia polecenie z katalogu głównego repozytorium git, raz na każdy edytowany plik, z dopisaną ścieżką tego pliku, więc Inwards sprawdza tylko to, co się zmieniło. Format `text` niesie te same ponumerowane kroki naprawy, które agent dostaje w JSON-ie. Polecenie lintujące `python:` zastępuje wbudowany linter Pythona w Aiderze, więc Aider przestaje zgłaszać błędy składni; zostaw krok kompilacji w testach albo w CI.

## Sprawdź, czy działa { #check-it-works }

- Uruchom sam `inwards check`. Powinien wypisać `All clear` albo naruszenia, które już są w projekcie.
- Poproś Aidera: *„Dodaj `import shop.infrastructure.db` do shop/domain/order.py.”* Po edycji Aider pokazuje raport INW001 i proponuje poprawkę.

## Rozwiązywanie problemów { #troubleshooting }

| Objaw | Przyczyna i rozwiązanie |
|---|---|
| Po edycjach brak wyjścia lintera | Sprawdź, czy `auto-lint` nie jest wyłączone i czy linia `lint-cmd` zaczyna się od `python:`, żeby dotyczyła plików Pythona. |
| `No pyproject.toml with [tool.inwards] found` | Aider uruchamia polecenie z katalogu głównego repozytorium git. Jeśli `pyproject.toml` leży w podkatalogu, dodaj do polecenia `--config <path>/pyproject.toml`. |
| Naruszenia w plikach, których Aider nie dotykał | Aider przekazuje tylko edytowane pliki. Naruszenie gdzie indziej pochodzi z pełnego uruchomienia `inwards check`, nie z Aidera. |
| Chcesz, żeby uruchomienia były zapisywane | Dodaj do polecenia `--log` (`... check --format text --log`). Zobacz [Run log](../08-Run-Log.md). |

Aider nie ma odpowiednika hooka Stop ani config guarda z Claude Code. Żeby model nie zmieniał `[tool.inwards]`, nie dodawaj `pyproject.toml` do czatu (albo dodaj go przez `/read-only`) i użyj CODEOWNERS, żeby zmieniona konfiguracja wymagała przeglądu przed scaleniem.
