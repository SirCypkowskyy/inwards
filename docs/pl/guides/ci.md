---
source: docs/chapters/guides/ci.md
source_hash: f7decdb2b758e3cbbd441866c6578f9ea48927a8e5613db63d963d41e0a14856
---

# GitHub Actions { #github-actions }

!!! info "Zweryfikowano 2026-09-26"
    Kroki sprawdzenia i adnotacji działają przy każdym pull requeście w tym repozytorium ([`sarif.yml`](https://github.com/SirCypkowskyy/inwards/blob/develop/.github/workflows/sarif.yml), na `examples/broken-app`), z Inwards zbudowanym ze źródeł. Wysyłki do code scanning nie da się wypróbować, dopóki repozytorium jest prywatne (patrz niżej), podobnie jak kroku instalacji przez `curl`.

Hooki agentów wyłapują naruszenie, gdy agent pracuje; CI wyłapuje te, które się przez nie prześlizgną, na przykład ręczną edycję albo pracę agenta bez hooków. Poniższy workflow oblewa pull request, gdy import łamie warstwę, i umieszcza naruszenie przy linii, która je spowodowała.

## Workflow { #the-workflow }

Zapisz go jako `.github/workflows/inwards.yml`:

```yaml title=".github/workflows/inwards.yml"
name: Inwards

on:
  pull_request:
  push:
    branches: [main] # code scanning compares a PR with its base branch's last analysis

permissions:
  contents: read

jobs:
  inwards:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      actions: read # upload-sarif, private repositories only
      security-events: write # upload-sarif
    steps:
      - uses: actions/checkout@v7
      - name: Install Inwards
        env:
          VERSION: v0.1.0-rc.1
          FILE: inwards-linux-x64
        run: |
          curl -fsSLO "https://github.com/SirCypkowskyy/inwards/releases/download/$VERSION/$FILE"
          curl -fsSLO "https://github.com/SirCypkowskyy/inwards/releases/download/$VERSION/SHA256SUMS"
          sha256sum --check --ignore-missing SHA256SUMS
          install -D -m 755 "$FILE" "$RUNNER_TEMP/bin/inwards"
          echo "$RUNNER_TEMP/bin" >> "$GITHUB_PATH"
      - name: Check
        id: check
        run: |
          status=0
          inwards check --format sarif > inwards.sarif || status=$?
          echo "status=$status" >> "$GITHUB_OUTPUT"
          test "$status" -le 1 # 2 is a usage or config error: fail now
      - name: Annotate the pull request
        run: |
          jq -r '.runs[].results[] | .locations[0].physicalLocation as $l
            | "::\(if .level == "error" then "error" else "warning" end) file=\($l.artifactLocation.uri),line=\($l.region.startLine),col=\($l.region.startColumn),title=\(.ruleId)::\(.message.text | gsub("%"; "%25") | gsub("\r"; "%0D") | gsub("\n"; "%0A"))"' inwards.sarif
      - name: Upload to code scanning
        uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: inwards.sarif
          category: inwards
      - name: Fail on violations
        if: steps.check.outputs.status == '1'
        run: exit 1
```

- **Check** zapisuje SARIF 2.1.0 i zapamiętuje kod wyjścia, zamiast od razu oblewać zadanie, więc kolejne kroki nadal się wykonują. Kod wyjścia 2 (brak konfiguracji, błędna konfiguracja) oblewa zadanie od razu. Sprawdzenie czyta `inwards-baseline.json`, jeśli go zacommitowano, więc w istniejącym kodzie błędem kończą się tylko nowe naruszenia; `inwards baseline` wymaga wydania nowszego niż v0.1.0-rc.1.
- **Annotate the pull request** zamienia każdy wynik w [polecenie workflow](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands). Naruszenie pojawia się przy swojej linii w zakładce „Files changed” i w podsumowaniu uruchomienia, z krokami naprawy jako treścią. Nie potrzebuje do tego code scanning. GitHub pokazuje najwyżej 10 adnotacji błędów na krok i 50 na zadanie. Ścieżki pochodzą z SARIF-u, gdzie są zakodowane jako URI, więc plik, którego nazwa zawiera spację albo znak spoza ASCII, dostaje adnotację w podsumowaniu uruchomienia, a nie przy swojej linii.
- **Upload to code scanning** wysyła ten sam plik do [GitHub code scanning](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/uploading-a-sarif-file-to-github). Alerty mają historię, przycisk odrzucenia i link do pomocy reguły. Code scanning pokazuje nowe alerty w pull requeście, porównując go z gałęzią bazową, stąd wyzwalacz `push`.
- **Fail on violations** oblewa zadanie na końcu, gdy wyniki są już opublikowane.

Gdy code scanning zacznie działać, zostaw tylko jeden z dwóch kroków z adnotacjami, bo inaczej każde naruszenie pojawi się dwa razy.

## Moduły generowane { #generated-modules }

Zadanie CI sprawdza świeży checkout, w którym jest tylko to, co zacommitowano. Moduły zapisywane przez krok budowania, takie jak `orders_pb2.py` i `orders_pb2_grpc.py` z protoc albo `_version.py` zapisywany przez setuptools-scm i hatch-vcs, są w checkoucie programisty, ale nie tam. INW010 zgłasza import własnego modułu, którego nie ma na dysku, więc moduły objęte przez `generated` w `[tool.inwards]` traktuje jako istniejące, niezależnie od tego, czy plik jest. Bez tego klucza lista to `["*_pb2", "*_pb2_grpc", "_version"]`, więc moduły z protoc i moduły wersji nie wymagają konfiguracji. Dla innego generatora wypisz wszystkie potrzebne wzorce, bo klucz zastępuje listę domyślną:

```toml title="pyproject.toml"
[tool.inwards]
generated = ["*_pb2", "*_pb2_grpc", "_version", "shop.api.gen"]
```

- Wzorzec to nazwa modułu z kropkami, a każdy segment może używać `*`, `?` i `[seq]`. Pasuje do całych segmentów w dowolnym miejscu nazwy modułu, tak jak `ignore`: `*_pb2` obejmuje `shop.api.orders_pb2`, `_version` obejmuje `shop._version`, a `shop.api.gen` wszystko w `shop/api/gen/`. `*` nigdy nie przechodzi przez kropkę.
- Pusty segment, znak, którego nie może być w nazwie modułu, albo wzorzec złożony z samych symboli wieloznacznych (`*`, `*.*`) to błąd konfiguracji, a sprawdzenie kończy się kodem 2. Żeby wyłączyć INW010, użyj `ignore = ["INW010"]` w `[tool.inwards.rules]`.
- `generated = []` wyłącza listę domyślną. Wtedy uruchom generator (`python -m grpc_tools.protoc ...`) przed `inwards check`, bo inaczej INW010 zgłosi każdy import modułu, który ten generator zapisuje.
- Klucz czyta tylko INW010. Pozostałe reguły widzą moduł generowany, którego nie ma na dysku, jako brakujący: import takiego modułu skierowany na zewnątrz to nadal INW001, a INW006 wskazuje najbliższy istniejący pakiet. [Znane ograniczenia](../03-Architecture-C4.md#known-limitations) w rozdziale o architekturze wymieniają przypadki, w których przez to diagnostyka różni się między dwoma checkoutami.
- Config guard odrzuca edycję tego klucza przez agenta, tak jak każdego klucza w `[tool.inwards]`.

## Dostępność code scanning { #code-scanning-availability }

Code scanning jest darmowe w publicznych repozytoriach. W prywatnym repozytorium wymaga GitHub Code Security (części GitHub Advanced Security), które mogą kupić tylko organizacje na planie GitHub Team albo Enterprise. Bez tego krok wysyłki kończy się błędem „Code scanning is not enabled for this repository”. Wtedy albo usuń krok wysyłki i polegaj na kroku z adnotacjami, albo dodaj do niego `continue-on-error: true`, jak robi to repozytorium Inwards, dopóki jest prywatne (`continue-on-error: ${{ github.event.repository.private }}`).

## Dopóki repozytorium Inwards jest prywatne { #while-inwards-is-private }

Adresy wydań zwracają 404, dopóki repozytorium nie jest publiczne (patrz [Instalacja](install.md#from-a-release)). Do tego czasu pobieraj plik binarny przez GitHub CLI z tokenem, który może czytać `SirCypkowskyy/inwards`, zapisanym jako sekret repozytorium:

```yaml
      - name: Install Inwards
        env:
          GH_TOKEN: ${{ secrets.INWARDS_READ_TOKEN }}
        run: |
          gh release download v0.1.0-rc.1 --repo SirCypkowskyy/inwards --pattern inwards-linux-x64 --pattern SHA256SUMS
          sha256sum --check --ignore-missing SHA256SUMS
          install -D -m 755 inwards-linux-x64 "$RUNNER_TEMP/bin/inwards"
          echo "$RUNNER_TEMP/bin" >> "$GITHUB_PATH"
```

Jeśli projekt ma już Inwards jako zależność deweloperską uv, zamiast kroku instalacji wystarczy `uv run inwards check`.
