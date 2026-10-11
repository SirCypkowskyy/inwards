---
source: docs/chapters/guides/ci.md
source_hash: a0b68f7228ce4ac110f640c4696401dc5fd2b28b3a619a9c90f064ccd33e4907
---

# GitHub Actions { #github-actions }

!!! info "Zweryfikowano 2026-10-11"
    `inwards check --format github` jest przypięte snapshotem E2E, a jego escapowanie testami jednostkowymi zgodnymi z regułami, których używa `@actions/core`; nie uruchomiono go jeszcze w zadaniu GitHub Actions. Kroki sprawdzenia, adnotacji i wysyłki z workflow dla code scanning działają przy każdym pull requeście w tym repozytorium ([`sarif.yml`](https://github.com/SirCypkowskyy/inwards/blob/develop/.github/workflows/sarif.yml), na `examples/broken-app`), z Inwards zbudowanym ze źródeł. `uv tool install` z kroku instalacji uruchomiono ręcznie z wersją 0.5.0 z PyPI, poza GitHub Actions. Hook pre-commit uruchomiono przez `uvx pre-commit run --all-files` (pre-commit 4.6.2) z `inwards==0.5.0` na projekcie testowym.

Hooki agentów wyłapują naruszenie, gdy agent pracuje; CI wyłapuje te, które się przez nie prześlizgną, na przykład ręczną edycję albo pracę agenta bez hooków. Poniższy workflow oblewa pull request, gdy import łamie warstwę, i umieszcza naruszenie przy linii, która je spowodowała.

## Workflow { #the-workflow }

!!! warning "Wymaga wydania po 0.5.0"
    `--format github` jest nowe: Inwards 0.5.0 kończy się kodem 2 i komunikatem `Unknown --format github`. Dopóki następne wydanie nie trafi na PyPI, użyj [workflow dla code scanning](#code-scanning), który działa z 0.5.0 i dodaje adnotacje do pull requesta także bez code scanning.

Zapisz go jako `.github/workflows/inwards.yml`:

```yaml title=".github/workflows/inwards.yml"
name: Inwards

on: pull_request

permissions:
  contents: read

jobs:
  inwards:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: astral-sh/setup-uv@v10.2.0
      - name: Install Inwards
        run: |
          uv tool install 'inwards>0.5.0' # then pin the release you tested: inwards==X.Y.Z
          uv tool dir --bin >> "$GITHUB_PATH"
      - name: Check
        run: inwards check --format github
```

- **Install Inwards** bierze wheel z [PyPI](https://pypi.org/project/inwards/). Przypnij wersję, żeby nowe wydanie, które może dodać regułę, nigdy nie oblało pull requesta, który niczego nie zmienił; podbijaj ją w osobnym pull requeście. Jeśli projekt ma już Inwards jako zależność deweloperską uv, `uv sync` i `uv run inwards check --format github` użyją wersji z `uv.lock`. Bez uv pobierz zamiast tego plik binarny tak, jak opisuje [Instalacja](install.md#from-a-release).
- **Check** wypisuje jedno [polecenie workflow](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands) na każdy wynik, `::error` dla naruszenia i `::warning` dla ostrzeżenia, a potem zwykłą linię podsumowania. Runner zamienia każde polecenie w adnotację: naruszenie pojawia się przy swojej linii w zakładce „Files changed” i w podsumowaniu uruchomienia, z krokami naprawy i linkiem do dokumentacji reguły jako treścią. Nie potrzeba do tego ani code scanning, ani `jq`. Kod wyjścia jest taki sam jak w każdym innym formacie: 0 bez naruszeń albo tylko z ostrzeżeniami, 1 z naruszeniami, 2 przy błędzie użycia albo konfiguracji, więc krok sam oblewa zadanie. Sprawdzenie czyta `inwards-baseline.json`, jeśli go zacommitowano, więc w istniejącym kodzie błędem kończą się tylko nowe naruszenia.
- GitHub pokazuje najwyżej 10 adnotacji błędów na krok i 50 na zadanie. Pozostałe wyniki wciąż są w logu kroku. `--max-diagnostics N` ogranicza też liczbę poleceń, błędy najpierw.

Linia wygląda tak:

```text
::error file=shop/domain/order.py,line=1,endLine=1,col=8,endColumn=30,title=INW001::Layer "domain" imports "shop.infrastructure.db" from outer layer "infrastructure". ...%0AFix: ...
```

Treść i wartości właściwości są escapowane tak, jak robi to zestaw narzędzi GitHuba (`escapeData` i `escapeProperty` w [`@actions/core`](https://github.com/actions/toolkit/blob/main/packages/core/src/command.ts)): `%`, powrót karetki i znak nowej linii wszędzie stają się `%25`, `%0D` i `%0A`, a w `file` i `title` dodatkowo `:` staje się `%3A`, a `,` staje się `%2C`. Ścieżka z przecinkiem albo dwukropkiem nadal trafia na swoją linię. Dla wyniku obejmującego kilka linii polecenie podaje `line` i `endLine` bez kolumn, bo runner odrzuca kolumny, gdy obie linie się różnią.

### Monorepo { #monorepos }

GitHub dopasowuje `file` z adnotacji do ścieżek liczonych od korzenia repozytorium. Gdy sprawdzenie działa w folderze pakietu, ustaw w kroku `working-directory`; Inwards czyta `GITHUB_WORKSPACE`, czyli korzeń checkoutu na runnerze, i zapisuje każdą ścieżkę względem niego:

```yaml
      - name: Check the API package
        working-directory: packages/api
        run: inwards check --format github
```

Uruchomione z `packages/api` naruszenie w `shop/domain/order.py` dostaje adnotację jako `packages/api/shop/domain/order.py`. W korzeniu workspace'u uv zwykłe `inwards check --format github` sprawdza każdy pakiet członkowski względem jego własnej konfiguracji, a ścieżki są już liczone od korzenia. Dwa przypadki nadal nie trafiają na linię: `actions/checkout` z `path:`, który umieszcza repozytorium w podfolderze `GITHUB_WORKSPACE`, więc każda ścieżka zaczyna się od tego folderu; oraz uruchomienie spoza `GITHUB_WORKSPACE`, gdzie ścieżki zostają względne wobec katalogu roboczego. Adnotacja pojawia się wtedy tylko w podsumowaniu uruchomienia.

## Code scanning { #code-scanning }

[GitHub code scanning](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/uploading-a-sarif-file-to-github) daje każdemu alertowi historię, przycisk odrzucenia i link do pomocy reguły. Czyta SARIF, więc ten workflow zapisuje `--format sarif` i dodaje adnotacje do pull requesta z tego pliku przez `jq`, co działa także z Inwards 0.5.0:

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
      - uses: astral-sh/setup-uv@v10.2.0
      - name: Install Inwards
        run: |
          uv tool install inwards==0.5.0 # pin the release; bump it on purpose
          uv tool dir --bin >> "$GITHUB_PATH"
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

- **Check** zapisuje SARIF 2.1.0 i zapamiętuje kod wyjścia, zamiast od razu oblewać zadanie, więc kolejne kroki nadal się wykonują. Kod wyjścia 2 (brak konfiguracji, błędna konfiguracja) oblewa zadanie od razu.
- **Annotate the pull request** robi to samo co `--format github`, ale z SARIF-u. Ścieżki pochodzą z SARIF-u, gdzie są zakodowane jako URI i względne wobec katalogu roboczego, więc plik, którego nazwa zawiera spację albo znak spoza ASCII, dostaje adnotację w podsumowaniu uruchomienia, a nie przy swojej linii. Z wydaniem po 0.5.0 zastąp ten krok przez `inwards check --format github || true`, żeby dostać dokładne ścieżki.
- **Upload to code scanning** wysyła ten sam plik do code scanning. Code scanning pokazuje nowe alerty w pull requeście, porównując go z gałęzią bazową, stąd wyzwalacz `push`.
- **Fail on violations** oblewa zadanie na końcu, gdy wyniki są już opublikowane.

Gdy code scanning zacznie działać, zostaw tylko jeden z dwóch kroków z adnotacjami, bo inaczej każde naruszenie pojawi się dwa razy.

## pre-commit { #pre-commit }

Żeby sprawdzać kod przed każdym commitem przez [pre-commit](https://pre-commit.com/), dodaj lokalny hook do `.pre-commit-config.yaml`. pre-commit instaluje przypięty wheel z PyPI we własnym środowisku, więc projekt nie potrzebuje innej konfiguracji:

```yaml title=".pre-commit-config.yaml"
repos:
  - repo: local
    hooks:
      - id: inwards
        name: inwards
        entry: inwards check --format concise
        language: python
        additional_dependencies: ["inwards==0.5.0"]
        pass_filenames: false
        files: (\.py|pyproject\.toml|inwards-baseline\.json)$
```

- `pass_filenames: false` sprawdza cały projekt, więc działają też reguły całego projektu (martwe prefiksy warstw, cykle importów, dowiązania symboliczne w warstwach), a commit, który zmienia tylko `pyproject.toml`, jest sprawdzany względem nowej konfiguracji. Zimne sprawdzenie całego repozytorium benchmarku (496 000 linii) trwa 0,4 s na jednym rdzeniu ([rozdział 6](../06-Constraints-and-Quality.md)). Żeby sprawdzać tylko pliki w staging area, usuń tę linię; reguły całego projektu poczekają wtedy na CI.
- `files` uruchamia hook, gdy zmienia się plik Pythona, `pyproject.toml` albo baseline, a w pozostałych przypadkach go pomija.
- `--format concise` wypisuje jedną linię na wynik. Naruszenie oblewa hook kodem 1, co zatrzymuje commit; ostrzeżenie nie.
- Podbijaj `inwards==0.5.0` świadomie, tak jak w CI. Lokalny hook nie ma `rev`, więc `pre-commit autoupdate` go nie zmienia.
- Gdy Inwards jest już zależnością deweloperską uv, `entry: uv run inwards check --format concise` z `language: system` użyje zablokowanej wersji, bez `additional_dependencies`.

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

`inwards check` i `inwards baseline` parsują duży projekt w kilku wątkach: od 1000 plików, po jednym wątku na 500 plików, do połowy rdzeni runnera ponad dwa i najwyżej 4. Reguły nadal działają w jednym wątku w kolejności plików, więc wynik jest taki sam przy dowolnej liczbie wątków. Na serwisie Django z 4324 plikami zimne sprawdzenie skróciło się z 1,48 s w jednym wątku do 0,87 s przy czterech wątkach na 10-rdzeniowym laptopie arm64 z macOS ([#281](https://github.com/SirCypkowskyy/inwards/issues/281) skróciło czytanie przed parsowaniem). Na Linuksie zysk jest mniejszy, a 4-rdzeniowy runner, taki jak hostowany `ubuntu-latest` GitHuba, zostaje przy jednym wątku, bo więcej wątków spowalniało tam sprawdzenie ([rozdział 6](../06-Constraints-and-Quality.md#worker-threads-for-a-full-run)). Każdy wątek trzyma własną kopię parsera, około 40 do 50 MB.

- `INWARDS_THREADS=1` trzyma sprawdzenie w jednym wątku, na runnerze z małą ilością pamięci albo przy pomiarze, który ma używać jednego rdzenia.
- `INWARDS_THREADS=N` pozwala na najwyżej N wątków, także ponad domyślny limit. W naszych pomiarach osiem nie było szybsze od czterech, bo reguły się nie rozkładają.
- Hooki Claude Code sprawdzają po kilka plików naraz i nigdy nie uruchamiają wątków.

## Dostępność code scanning { #code-scanning-availability }

Code scanning jest darmowe w publicznych repozytoriach. W prywatnym repozytorium wymaga GitHub Code Security (części GitHub Advanced Security), które mogą kupić tylko organizacje na planie GitHub Team albo Enterprise. Bez tego krok wysyłki kończy się błędem „Code scanning is not enabled for this repository”. Wtedy albo użyj [workflow](#the-workflow) bez code scanning, albo dodaj do kroku wysyłki `continue-on-error: true`.
