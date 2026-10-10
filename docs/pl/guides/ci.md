---
source: docs/chapters/guides/ci.md
source_hash: f39ccbf32b0b59d8bd1d381c5cb725b31bf0d95b79a5b0a7343335ca1eae8a28
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

<!-- config: fragment -->

```toml title="pyproject.toml"
[tool.inwards]
generated = ["*_pb2", "*_pb2_grpc", "_version", "shop.api.gen"]
```

- Wzorzec to nazwa modułu z kropkami, a każdy segment może używać `*` i `?`. Pasuje do całych segmentów w dowolnym miejscu nazwy modułu, tak jak `ignore`: `*_pb2` obejmuje `shop.api.orders_pb2`, `_version` obejmuje `shop._version`, a `shop.api.gen` wszystko w `shop/api/gen/`. `*` nigdy nie przechodzi przez kropkę.
- Pusty segment, znak, którego nie może być w nazwie modułu (w tym zbiór w nawiasach, taki jak `[a-z]`), albo wzorzec złożony z samych symboli wieloznacznych (`*`, `*.*`) to błąd konfiguracji, a sprawdzenie kończy się kodem 2. Żeby wyłączyć INW010, użyj `ignore = ["INW010"]` w `[tool.inwards.rules]`.
- `generated = []` wyłącza listę domyślną. Wtedy uruchom generator (`python -m grpc_tools.protoc ...`) przed `inwards check`, bo inaczej INW010 zgłosi każdy import modułu, który ten generator zapisuje.
- Klucz czyta tylko INW010. Pozostałe reguły widzą moduł generowany, którego nie ma na dysku, jako brakujący: import takiego modułu skierowany na zewnątrz to nadal INW001, a INW006 wskazuje najbliższy istniejący pakiet. [Znane ograniczenia](../03-Architecture-C4.md#known-limitations) w rozdziale o architekturze wymieniają przypadki, w których przez to diagnostyka różni się między dwoma checkoutami.
- Config guard odrzuca edycję tego klucza przez agenta, tak jak każdego klucza w `[tool.inwards]`.

## Pamięć podręczna między uruchomieniami { #caching-between-runs }

`inwards check` i `inwards baseline` trzymają to, co odczytały z każdego pliku (jego importy i komentarze wyciszające), w `.inwards/cache` obok `pyproject.toml`. Wpis jest odnajdywany po hashu treści pliku, nazwy modułu i reguł ekstrakcji danej wersji Inwards, więc zmieniony plik jest po prostu czytany od nowa. Na repozytorium benchmarku z 2100 plikami ciepła pamięć podręczna przyspieszyła pełne sprawdzenie od 2,6 do 3 razy; uruchomienie, które ją wypełnia, było wolniejsze o ćwierć do dwóch trzecich, zależnie od systemu plików. Żeby zachować pamięć podręczną między uruchomieniami workflow, odtwórz ją przed krokiem **Check**:

```yaml
      - uses: actions/cache@v6
        with:
          path: .inwards/cache
          key: inwards-${{ runner.os }}-${{ github.sha }}
          restore-keys: inwards-${{ runner.os }}-
```

- **Pamięci podręcznej się ufa, nie sprawdza się jej.** Sprawdzenie z pamięcią podręczną wierzy w to, co wpis mówi o importach pliku. Każdy, kto może pisać do `.inwards/cache`, może sprawić, że przeoczy ono naruszenie, a pull request może zacommitować własne `.inwards/cache`. Tam, gdzie sprawdzenie jest bramką dla kodu, któremu nie ufasz, uruchamiaj `inwards check --no-cache` albo ustaw `INWARDS_NO_CACHE=1` dla zadania. Hooki Claude Code nigdy nie czytają pamięci podręcznej, więc pętli agenta to nie dotyczy ([ADR-031](../05-ADR.md#adr-031-a-content-keyed-extraction-cache-that-the-hooks-never-read)).
- **Pozostaje mała.** Uruchomienie przycina każdą z 256 części pamięci podręcznej przy pierwszym zapisie do niej i ponownie, gdy jego własne zapisy przekroczą w niej 512 KB: znikają wpisy starsze niż 30 dni, a potem najstarsze, aż część zmieści się w limicie. Dzięki temu przestrzeń nazw (jeden folder w `.inwards/cache`) ma najwyżej około 128 MB. Wersja Inwards ze zmienionymi regułami ekstrakcji daje każdemu plikowi nowy klucz w tej samej przestrzeni nazw, więc stare wpisy starzeją się albo są wypierane. Nowy format pamięci podręcznej albo nowe gramatyki zaczynają nową przestrzeń nazw; starego folderu nikt już nie czyta i zostaje, dopóki go nie usuniesz.
- **Nic do konfigurowania.** `.inwards/cache` możesz usunąć, kiedy chcesz. `inwards init` już dodaje `.inwards/` do `.gitignore`.

## Wątki { #threads }

`inwards check` i `inwards baseline` parsują duży projekt w kilku wątkach: od 1000 plików, po jednym wątku na 500 plików, do połowy rdzeni runnera ponad dwa i najwyżej 4. Reguły nadal działają w jednym wątku w kolejności plików, więc wynik jest taki sam przy dowolnej liczbie wątków. Na serwisie Django z 4324 plikami zimne sprawdzenie skróciło się z 1,48 s do 0,98 s przy czterech wątkach na 10-rdzeniowym Macu. Na Linuksie zysk jest mniejszy, a 4-rdzeniowy runner, taki jak hostowany `ubuntu-latest` GitHuba, zostaje przy jednym wątku, bo więcej wątków spowalniało tam sprawdzenie ([rozdział 6](../06-Constraints-and-Quality.md#worker-threads-for-a-full-run)). Każdy wątek trzyma własną kopię parsera, około 40 do 50 MB.

- `INWARDS_THREADS=1` trzyma sprawdzenie w jednym wątku, na runnerze z małą ilością pamięci albo przy pomiarze, który ma używać jednego rdzenia.
- `INWARDS_THREADS=N` pozwala na najwyżej N wątków, także ponad domyślny limit. W naszych pomiarach osiem nie było szybsze od czterech, bo czytanie plików i reguły się nie rozkładają.
- Hooki Claude Code sprawdzają po kilka plików naraz i nigdy nie uruchamiają wątków.

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
