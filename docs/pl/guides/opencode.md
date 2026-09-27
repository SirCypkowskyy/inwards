---
source: docs/chapters/guides/opencode.md
source_hash: edf5137fb2a244cf62b4cae58779061f969ff8a4bb574c9c81ec565cccf0e7cb
---

# OpenCode { #opencode }

!!! info "Zweryfikowano 2026-09-27"
    Ręcznie na Linuksie z OpenCode 1.18.31: `init` i jego wyjście; sesja `opencode run`, w której agent zapisał import na zewnątrz, dostał INW001 w wyniku narzędzia i go poprawił (test end-to-end w `src/cli/test/integration/opencode-e2e.test.ts`); oraz sesja na `opencode serve`, w której bramka Stop odesłała agenta do pracy, a on poprawił naruszenie. Interaktywnego TUI, macOS i Windows nie sprawdzono ręcznie.

Z zainstalowanym pluginem Inwards sprawdza każdy plik Pythona, który agent edytuje w OpenCode, odrzuca edycje samych reguł i odsyła agenta do pracy, gdy zmiany z sesji łamią warstwę. Plugin uruchamia ten sam hook co [Claude Code](claude-code.md), więc reguły, strażnik konfiguracji i bramka Stop działają tak samo; różnice wynikają z tego, co potrafi API pluginów OpenCode, i są wymienione [niżej](#what-holds-on-opencode). [ADR-033](../05-ADR.md#adr-033-opencode-through-a-plugin-that-runs-the-claude-code-hook) wyjaśnia projekt.

## Konfiguracja { #set-it-up }

1. [Zainstaluj Inwards](install.md) i dodaj `[tool.inwards]` do `pyproject.toml`.
2. W projekcie uruchom:

    <!-- e2e -->

    ```sh
    inwards init --agent opencode --dry-run   # shows what will change
    inwards init --agent opencode
    ```

    To zapisuje plugin `.opencode/plugins/inwards.js`. Zawiera on ścieżkę do pliku binarnego na tej maszynie, więc `init` dodaje go do `.gitignore`, razem z `.inwards/`. Przypina też `required-version` i domyślną listę `ignore` w `[tool.inwards]`. Ponowne uruchomienie niczego nie zmienia. Jeśli plik o tej nazwie istnieje, a `init` go nie zapisał, `init` zatrzymuje się i zostawia go w spokoju.

3. Uruchom OpenCode ponownie w projekcie. OpenCode ładuje pluginy przy starcie.

## Sprawdź, czy działa { #check-it-works }

- Poproś agenta: *„Add `import shop.infrastructure.db` at the top of shop/domain/order.py.”* Edycja przechodzi, a wynik narzędzia, który czyta agent, kończy się raportem INW001. Agent usuwa import albo wprowadza port.
- Poproś agenta: *„Move shop.infrastructure into the domain layer in pyproject.toml.”* Edycja zostaje odrzucona z komunikatem, żeby agent zapytał ciebie.

## Co obowiązuje w OpenCode { #what-holds-on-opencode }

| Gwarancja Claude Code | W OpenCode |
|---|---|
| Sprawdzenie po każdej edycji | Obowiązuje dla narzędzi `edit`, `write` i `apply_patch`. Znaleziska są dopisywane do wyniku narzędzia, który agent czyta przed następnym krokiem. |
| Strażnik konfiguracji odrzuca edycje `[tool.inwards]`, baseline'u i plików Inwards | Obowiązuje dla `edit`, `write` i `bash`: przechodzą przez tego samego strażnika. Strażnik nie przeczyta łatki, więc plugin odmawia każdego `apply_patch`, który dotyka `pyproject.toml`, `.opencode/`, `opencode.json(c)`, `.inwards/` albo `inwards-baseline.json`. Agent nadal może zmienić `pyproject.toml` przez `edit`, który strażnik sprawdza; `edit` i `write` pozostałych plików też są odrzucane, tak jak robi to `permissions.deny` w Claude Code. |
| Bramka Stop odmawia zakończenia tury, dopóki zmiany z sesji łamią warstwę | OpenCode nie może odmówić zakończenia tury. Gdy sesja przechodzi w bezczynność, plugin uruchamia bramkę; jeśli ta blokuje, plugin wysyła jej powody do sesji jako nową wiadomość, która zaczyna kolejną turę. Wiadomość zaczyna się od „Inwards Stop gate (sent by the Inwards plugin, not the user)”, żeby agent nie wziął jej za twoje słowa. `escalate-after` działa tak jak w Claude Code. |
| Bramka Stop w uruchomieniu nieinteraktywnym | `opencode run` kończy działanie, gdy sesja przechodzi w bezczynność, więc drugiej tury nie ma. Sprawdzenie po edycji nadal dociera do agenta w trakcie uruchomienia; po nim uruchom `inwards check`, jak w [CI](ci.md). Sesja prowadzona przez `opencode serve` dostaje drugą turę. |
| Subagenty | Sesja subagenta jest przypisana do sesji najwyższego poziomu, tak jak Claude Code daje subagentowi identyfikator sesji rodzica. Jego edycje są sprawdzane; bramka Stop działa, gdy w bezczynność przechodzi sesja najwyższego poziomu, i obejmuje wszystko, co zmieniły ta sesja i jej subagenty. |
| Brak hooka oblewa bramkę Stop | Bramka sprawdza, czy plik pluginu wciąż jest na miejscu. Jeśli go nie ma, bramka blokuje i prosi o `inwards init --agent opencode`. Gdy OpenCode wystartuje ponownie bez pluginu, nic nie działa, więc nic tego nie zgłosi, tak jak po usunięciu pliku ustawień Claude Code. |
| Wiadomości od użytkownika | Plugin nie może zablokować wiadomości, którą wysyłasz. Twoja wiadomość zaczyna nową turę, a licznik `escalate-after` liczy od nowa. |

## Rozwiązywanie problemów { #troubleshooting }

| Objaw | Przyczyna i rozwiązanie |
|---|---|
| Przy edycjach nic się nie dzieje | OpenCode działał, gdy `init` zapisał plugin. Uruchom go ponownie. Jeśli brakuje `.opencode/plugins/inwards.js`, uruchom ponownie `inwards init --agent opencode`. |
| „Inwards has no record of how this session started” | Plugin zainstalowano po rozpoczęciu sesji. Zacznij nową sesję. |
| „The Inwards OpenCode plugin … is missing or isn't the one `inwards init` wrote” | Coś usunęło albo podmieniło `.opencode/plugins/inwards.js`. Uruchom ponownie `inwards init --agent opencode`. |
| „This project requires Inwards X or newer” | `required-version` jest nowsze niż twój plik binarny. Zainstaluj nowsze wydanie. |
| Agent mówi, że `apply_patch` został odrzucony | Łatka dotknęła `pyproject.toml` albo jednego z plików Inwards. Agent może wprowadzić zmianę przez `edit`, który sprawdza strażnik konfiguracji; zmiana `[tool.inwards]` należy do ciebie. |
| Bramka Stop nie odesłała agenta po `opencode run` | Tak ma być: proces kończy działanie, gdy sesja przechodzi w bezczynność. Po uruchomieniu wykonaj `inwards check`. |
| Windows: plugin nie może uruchomić Inwards | Plugin uruchamia plik binarny pod bezwzględną ścieżką, bez powłoki. Jeśli przeniesiono plik binarny, uruchom `init` ponownie. |
