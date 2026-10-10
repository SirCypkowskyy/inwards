---
source: docs/chapters/guides/copilot.md
source_hash: 7bf556abd3ad8bf0d36bac4be51a46c704bf4822cc50892633443ce7266b17f6
---

# GitHub Copilot { #github-copilot }

!!! info "Zweryfikowano 2026-10-10"
    Na macOS (arm64), ze skompilowanym plikiem binarnym na `examples/broken-app`: `inwards init --agent agents-md` oraz `inwards mcp` uruchomione tak, jak uruchamia go poniższy wpis w `.mcp.json`, który odpowiedział na `tools/list` i `check_files`. Workflow z krokami przygotowania parsuje się jako YAML. Nie uruchamiano żadnej sesji Copilota, ani w VS Code, ani na GitHubie, a workflow nie działał na GitHubie. Ustawienia Copilota, nazwy plików i ograniczenia na tej stronie pochodzą z dokumentacji VS Code i GitHuba z tego dnia; to, co sekcja Hooki mówi o plikach hooków Copilot CLI, pochodzi z opisu hooków GitHuba czytanego 2026-10-11.

Copilot nie ma hooka, do którego Inwards mógłby się podłączyć tak jak do [hooków Claude Code](claude-code.md). Zamiast tego spotyka Inwards w czterech miejscach:

| Gdzie | Co dostaje Copilot | VS Code | Agent w chmurze |
|---|---|---|---|
| `AGENTS.md` | polecenie, żeby przed zakończeniem uruchomić `inwards check` | tak | tak |
| Rozszerzenie VS Code | każde naruszenie w panelu **Problems**, na bieżąco w trakcie pisania | tak | nie |
| `inwards mcp` | narzędzia, przez które pyta, gdzie należy kod, i sprawdza kod przed zapisaniem | tak | tak, konfigurowane per repozytorium |
| CI | nieprzechodzące sprawdzenie na pull requeście | tak | tak |

Polecenie albo narzędzie działa tylko wtedy, gdy agent z niego skorzysta, więc w obu przypadkach bramką pozostaje CI.

## Copilot w VS Code { #vs-code }

1. [Zainstaluj Inwards](install.md) i dodaj `[tool.inwards]` do `pyproject.toml`.
2. Zainstaluj [rozszerzenie VS Code](install.md#vs-code). Uruchamia ono `inwards server` i umieszcza każde naruszenie w panelu **Problems**.
3. Dodaj polecenie do `AGENTS.md` i zrób commit:

    <!-- e2e -->

    ```sh
    inwards init --agent agents-md
    ```

    Copilot w VS Code czyta `AGENTS.md` z katalogu głównego obszaru roboczego (ustawienie `chat.useAgentsMdFile`, domyślnie włączone), zarówno w harnessie Copilota, jak i w sesjach Local. [Poradnik AGENTS.md](agents-md.md) pokazuje sekcję, którą dodaje ta komenda; gdy Inwards jest zależnością deweloperską w uv, dodaj `--launcher "uv run"`, a sekcja będzie mówić `uv run inwards check`.

4. Zarejestruj serwer MCP w `.mcp.json` w katalogu głównym projektu:

    ```json title=".mcp.json"
    {
      "mcpServers": {
        "inwards": { "type": "stdio", "command": "inwards", "args": ["mcp"] }
      }
    }
    ```

    VS Code uruchamia serwer w folderze obszaru roboczego, więc jego narzędzia widzą projekt. To format przenośny: VS Code czyta go dla każdego rodzaju sesji, a Claude Code i Copilot CLI czytają ten sam plik. Z uv użyj `"command": "uv", "args": ["run", "inwards", "mcp"]`. W zaufanym obszarze roboczym serwer startuje bez pytania; w trybie ograniczonym nie startuje. [Poradnik MCP](mcp.md) opisuje trzy narzędzia.

5. Każ agentowi czytać panel **Problems**. Narzędzie VS Code `#read/problems` daje mu znajdujące się tam diagnostyki, także te z Inwards, ale to agent decyduje, kiedy je wywołać. Wymień je w poleceniu (*"fix #read/problems"*) albo dodaj linijkę do `.github/copilot-instructions.md`:

    ```markdown title=".github/copilot-instructions.md"
    After editing Python files, read #read/problems and fix every Inwards diagnostic (codes INW and FAPI) before you finish.
    ```

Sprawdź, czy działa:

- Uruchom **MCP: List Servers** z palety poleceń. `inwards` jest na liście jako działający, a **Configure Tools** w polu czatu wymienia `check_files`, `explain_rule` i `where_should_this_go`.
- Poproś agenta: *"Add `import shop.infrastructure.db` at the top of shop/domain/order.py."* Rozszerzenie oznacza import diagnostyką INW001, a agent, któremu kazano czytać panel Problems albo uruchamiać sprawdzenie, usuwa go albo wprowadza port.

### Hooki { #hooks }

VS Code ma hooki agentów w wersji preview, ale Inwards jeszcze ich nie obsługuje. Jego hook (`inwards hook claude-code`) czyta dane wejściowe i nazwy narzędzi Claude Code. Harness Local w VS Code potrafi czytać hooki z plików ustawień Claude Code (`chat.useClaudeHooks`, domyślnie wyłączone), ale ignoruje ich matchery i inaczej nazywa narzędzia, a harness Copilota używa własnego formatu hooków. Nie podpinaj żadnego z nich pod `inwards hook claude-code`: config guard i Stop gate widziałyby wywołania narzędzi, których nie rozpoznają. Copilot CLI też czyta `.claude/settings.json` i `.claude/settings.local.json`, więc w projekcie podłączonym przez `inwards init --agent claude-code` już uruchamia ten hook, a ani config guard, ani Stop gate tam nie działają: Copilot traktuje kod wyjścia 2 hooka jako ostrzeżenie dla użytkownika, nie blokadę. [ADR-044](../05-ADR.md#adr-044-copilot-through-an-inwards-hook-copilot-entry-point-and-a-committed-hooks-file) (proponowany) opisuje, co oferuje każda powierzchnia Copilota, i planowany `inwards hook copilot`.

## Agent Copilota w chmurze { #cloud-agent }

Agent w chmurze (cloud agent, wcześniej nazywany coding agent) pracuje nad issue w środowisku GitHub Actions i otwiera pull request. Czyta z repozytorium `AGENTS.md`, `.github/copilot-instructions.md` i `.github/instructions/*.instructions.md`.

1. Dodaj sekcję do `AGENTS.md`, jak w kroku 3 wyżej.
2. Zainstaluj Inwards w środowisku agenta przez `.github/workflows/copilot-setup-steps.yml`. Copilot uruchamia tylko zadanie o nazwie `copilot-setup-steps` i dopiero wtedy, gdy plik jest na domyślnej gałęzi. Ten workflow zakłada, że Inwards jest zależnością deweloperską w uv, więc `AGENTS.md` powinien mówić `uv run inwards check` (`inwards init --agent agents-md --launcher "uv run"`):

    ```yaml title=".github/workflows/copilot-setup-steps.yml"
    name: Copilot setup steps

    on:
      workflow_dispatch:
      push:
        paths: [.github/workflows/copilot-setup-steps.yml]
      pull_request:
        paths: [.github/workflows/copilot-setup-steps.yml]

    jobs:
      copilot-setup-steps:
        runs-on: ubuntu-latest
        permissions:
          contents: read
        steps:
          - uses: actions/checkout@v7
          - uses: astral-sh/setup-uv@v10
          - name: Install the project, Inwards included
            run: uv sync --locked
          - run: uv run inwards --version
    ```

    Wyzwalacze `push` i `pull_request` uruchamiają zadanie jako zwykły workflow, gdy plik się zmienia, więc zepsuty krok widać już w pull requeście, który go dodaje. Jeśli krok zawiedzie w trakcie sesji agenta, Copilot pomija pozostałe i startuje mimo to, bez Inwards. Bez uv pobierz plik binarny z wydania jak w [poradniku GitHub Actions](ci.md#the-workflow) i zainstaluj go w katalogu z domyślnego `PATH`, na przykład w `/usr/local/bin` (przez `sudo install`).

3. Opcjonalnie daj agentowi narzędzia MCP. W **Settings** repozytorium otwórz **Copilot**, potem **MCP servers**, i zapisz:

    ```json
    {
      "mcpServers": {
        "inwards": {
          "type": "local",
          "command": "uv",
          "args": ["run", "inwards", "mcp"],
          "tools": ["check_files", "explain_rule", "where_should_this_go"]
        }
      }
    }
    ```

    `tools` jest wymagane i wymienia to, co agent może wywołać bez pytania; wszystkie trzy narzędzia tylko czytają. Serwer używa Inwards zainstalowanego przez kroki przygotowania. Log następnej sesji pokazuje narzędzia w kroku **Start MCP Servers**. GitHub nie dokumentuje, w jakim katalogu agent uruchamia serwer; jeśli `check_files` nie znajduje plików projektu, poproś agenta o ścieżki bezwzględne.

4. Dodaj [workflow GitHub Actions](ci.md), żeby naruszenie oblewało pull request. Domyślnie workflow nie uruchamiają się na pull requeście, do którego pushuje Copilot, dopóki ktoś z prawem zapisu nie kliknie **Approve and run workflows**; administrator repozytorium może wyłączyć to zatwierdzanie w ustawieniach agenta w chmurze. Gdy sprawdzenie nie przejdzie, wspomnij `@copilot` w komentarzu do pull requesta i poproś o naprawienie naruszeń Inwards; log zadania i adnotacje podają regułę i kroki naprawy.

Agent w chmurze uruchamia też hooki z `.github/hooks/*.json`, we własnym formacie Copilota. Tak jak w VS Code, Inwards nie ma jeszcze dla nich adaptera; [ADR-044](../05-ADR.md#adr-044-copilot-through-an-inwards-hook-copilot-entry-point-and-a-committed-hooks-file) go proponuje.

## Ograniczenia { #limits }

- **Brak Stop gate.** Nic nie zatrzymuje tury Copilota, gdy naruszenie jest otwarte. Agent uruchamia sprawdzenie, bo prosi o to `AGENTS.md`, a jeśli tego nie zrobi, CI obleje pull request.
- **Brak config guarda.** Copilot może edytować `[tool.inwards]`, żeby diagnostyka zniknęła. Sekcja w `AGENTS.md` mu tego zabrania; wpis w `CODEOWNERS` dla `pyproject.toml` sprawia, że taką zmianę przegląda człowiek.
- **Panel Problems jest czytany na żądanie.** Rozszerzenie pokazuje naruszenie od razu, ale agent widzi je dopiero, gdy wywoła `#read/problems` albo uruchomi sprawdzenie.

## Rozwiązywanie problemów { #troubleshooting }

| Objaw | Przyczyna i rozwiązanie |
|---|---|
| Agent nigdy nie uruchamia sprawdzenia | `AGENTS.md` to polecenie. Sprawdź, czy plik leży w katalogu głównym i czy `chat.useAgentsMdFile` jest włączone, wymień sprawdzenie w poleceniu, a resztę zostaw CI. |
| `inwards` nie ma na liście **MCP: List Servers** | Obszar roboczy nie jest zaufany albo `.mcp.json` nie leży w katalogu głównym folderu obszaru roboczego. Uruchom **MCP: List Servers**, wybierz `inwards` i otwórz jego wyjście, żeby zobaczyć błąd. |
| Agent w chmurze zgłasza `inwards: command not found` | Kroki przygotowania go nie zainstalowały albo `AGENTS.md` podaje `inwards` tam, gdzie projekt używa `uv run inwards`. Uruchom workflow przygotowania z karty **Actions** i sprawdź jego log. |
| Na pull requeście Copilota nie działa żadne sprawdzenie | Workflow czekają na **Approve and run workflows** w sekcji scalania pull requesta. |
