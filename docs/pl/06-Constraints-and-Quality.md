---
source: docs/chapters/06-Constraints-and-Quality.md
source_hash: 54ba48cbeca1179bf3f7792f788da12eca8ae044d63cf3daf1bc56d7ed9493f3
---

# :material-speedometer: Ograniczenia i jakość { #constraints-and-quality }

Ten rozdział opisuje reguły, w których projekt musi się zmieścić, cele jakościowe, według których jest oceniany, to, co do tej pory zmierzyliśmy, i znane nam ryzyka.

## Ograniczenia { #constraints }

| # | Ograniczenie | Dlaczego | Gdzie uwiera |
|---|---|---|---|
| C1 | Silnik w TypeScripcie | Współdzielony przez CLI, serwer języka i rozszerzenie ([ADR-001](05-ADR.md#adr-001-typescript-for-the-engine)) | Surowa szybkość parsowania, rozmiar pliku binarnego |
| C2 | Python parsowany tree-sitterem w wersji WASM | Przenośny między Bunem, Node i każdą platformą docelową ([ADR-002](05-ADR.md#adr-002-web-tree-sitter-wasm-not-native-bindings)) | Około 12 ms startu WASM na proces |
| C3 | Dystrybucja jako jednoplikowy program wykonywalny Buna | Bez wymagań co do środowiska; instaluje się jako zależność deweloperska ([ADR-003](05-ADR.md#adr-003-ship-a-bun-single-file-executable)) | Od 66 do 90 MB na plik binarny w zależności od platformy (85 MB dla Linuksa x64), prawie w całości środowisko Buna |
| C4 | Nigdy nie importuj ani nie wykonuj kodu użytkownika | Deterministyczne, bezpieczne w niezaufanych repozytoriach, bez potrzeby venv | Sprawdzić da się tylko importy dynamiczne z dosłownym celem (INW011); wyliczany cel jest w warstwach wewnętrznych zgłaszany jako niesprawdzalny, a nie rozwiązywany |
| C5 | Brak dostępu do sieci w czasie sprawdzenia | Działa offline, w piaskownicach i w zamkniętym CI | Pakiety reguł muszą być dostarczane wewnątrz pliku binarnego albo repozytorium |
| C6 | Konfiguracja w `pyproject.toml` pod `[tool.inwards]` | Konwencja Pythona ([ADR-005](05-ADR.md#adr-005-configuration-lives-in-pyprojecttoml)) | Ochrona konfiguracji wymaga hooków albo CODEOWNERS |
| C7 | Kontrakt wyjścia `inwards/diagnostics@1` jest tylko rozszerzany | Zależą od niego agenci i skrypty ([ADR-007](05-ADR.md#adr-007-a-versioned-output-contract-with-fix-steps-as-data)) | Zmiany nazw wymagają nowej głównej wersji schematu |
| C8 | Linux, macOS i Windows na x64 i arm64 | Tam działają agenci i CI | Obsługa ścieżek, CRLF, macierz weryfikacji wydań |

## Cele jakościowe { #quality-goals }

Uszeregowane. Gdy dwa cele są w konflikcie, wygrywa wyższy.

| Pozycja | Cel | Scenariusz | Miara |
|---|---|---|---|
| 1 | :material-shield-check: **Żadnych fałszywie negatywnych wyników** | Agent chowa zabroniony import w funkcji, pod `TYPE_CHECKING`, przez ścieżkę względną albo import pakietu | Każda forma jest zgłaszana, w tym `shop . infrastructure` ze spacjami, ukośnik wsteczny w nazwie, identyfikatory NFKC i aliasy warstwy przez dowiązania symboliczne. Importy dynamiczne ze stałymi celami (`importlib.import_module`, `__import__`, `exec`) są zgłaszane jako INW011, a wyliczane cele w warstwach wewnętrznych jako niesprawdzalne INW011. Loadery są śledzone przez aliasy, przypisania, atrybuty, `functools.partial` i nazwy związane wewnątrz `exec`, a stałe cele są zwijane; znane luki wymienia rozdział 3. Testy jednostkowe i test różnicowy prescanu (0 przeoczeń na 92 448 wygenerowanych plikach i 1921 plikach biblioteki standardowej, łącznie z importami dynamicznymi, a co noc na 6543 plikach z pięciu serwisów open source) |
| 2 | :material-lightning-bolt: **Opóźnienie w pętli agenta** | Hook sprawdza jeden edytowany plik | p95 < 100 ms czasu rzeczywistego, łącznie ze startem procesu |
| 3 | :material-robot-outline: **Wyniki, na podstawie których agent może działać** | Agent dostaje INW001 | Naprawia naruszenie w ramach jednej ponownej próby w ≥ 80 % przypadków (mierzone z design partnerami, zobacz [rozdział 2](02-Business-Context.md#the-hypothesis)) |
| 4 | :material-repeat: **Deterministyczność** | To samo repozytorium, ta sama konfiguracja, dwa uruchomienia | Identyczne diagnostyki w identycznej kolejności. Zmieniają się tylko pola czasu w podsumowaniu (`durationMs`) |
| 5 | :material-timer-sand: **Przepustowość dla całego repozytorium** | CI sprawdza na zimno repozytorium z 500 tys. linii | 0,33 s dla syntetycznego repozytorium z 496 000 linii i 0,87 s dla 848 000 linii saleora przy czterech wątkach ([#61](https://github.com/SirCypkowskyy/inwards/issues/61), [#281](https://github.com/SirCypkowskyy/inwards/issues/281)). Cel < 300 ms z wątkami i pamięcią podręczną |
| 6 | :material-package-variant: **Łatwość wdrożenia** | Nowy zespół, istniejący kod | Jedno polecenie podłącza agenta (`inwards init`). Stop gate sprawdza tylko to, co zmieniła sesja, a w zmienionym pliku tylko to, co jest nowe od początku sesji, więc stare naruszenia nie blokują; resztę obejmie baseline (UC6, [#33](https://github.com/SirCypkowskyy/inwards/issues/33)) |

Poprawność celowo stoi wyżej niż szybkość. Zabezpieczenie, które czasem milczy, uczy agenta, że zły ruch jest w porządku, a to gorsze niż brak zabezpieczenia.

## Pomiary { #measurements }

Wszystkie liczby pochodzą ze scaffoldu w tym repozytorium. Nic tu nie jest prognozą. Zmierzono je w M0; wyrywkowe sprawdzenie niżej pokazuje, jak się od tego czasu zmieniły.

**Środowisko.** Laptop, Bun 1.4.2, `inwards-linux-x64` zbudowany przez `scripts/build-binaries.ts`. Wszystko działało w jednym wątku; wątki robocze doszły później ([#61](#worker-threads-for-a-full-run)). Laptop był w zwykłym użyciu desktopowym (średnie obciążenie około 2–3), więc to liczby realistyczne, a nie najlepszy możliwy przypadek.

**Syntetyczne repozytorium.** 2100 plików Pythona, 496 000 linii, 8,0 MB, cztery warstwy z ośmioma importami własnego kodu i czterdziestoma małymi funkcjami na moduł. `bench/generate.py` odtwarza je dokładnie (stałe ziarno losowości). Z `--legacy` dodaje zewnętrzną warstwę `legacy`, którą importuje każdy moduł, więc każdy z 2000 modułów ma jedno naruszenie: to starszy kod, dla którego model kosztów z [rozdziału 3](03-Architecture-C4.md) mierzy czas z pełnym baseline'em.

**Bramka regresji.** Każdy pull request uruchamia `.github/workflows/bench.yml`. Buduje gałąź bazową i PR, uruchamia oba buildy na syntetycznym repozytorium na przemian (40 uruchomień hooka na jednym pliku, 12 pełnych sprawdzeń) i kończy się błędem, gdy PR jest o ponad 20% wolniejszy w którejkolwiek metryce albo gdy którykolwiek build zawiedzie w uruchomieniu (syntetyczne repozytorium jest czyste, więc każde uruchomienie musi skończyć się kodem 0). Każda strona jest budowana z własnym `.bun-version`, więc mierzona jest też aktualizacja Buna. Zmiana to mediana stosunków w parach, więc obciążenie, które zmienia się w trakcie zadania, znosi się w obrębie pary. Pełne sprawdzenia działają z `INWARDS_NO_CACHE=1`, więc bramka mierzy samą pracę, a nie [pamięć podręczną ekstrakcji](05-ADR.md#adr-031-a-content-keyed-extraction-cache-that-the-hooks-never-read). Czwarta metryka objęta bramką mierzy hook PostToolUse na wygenerowanym module z 4478 liniami i dwoma starymi naruszeniami, w osobnym małym projekcie, zmienianym przed każdym uruchomieniem tak, jak robi to edycja agenta (`bench/large-file.ts`, [#122](https://github.com/SirCypkowskyy/inwards/issues/122)); podsumowanie podaje też, czy p95 PR dla niej mieści się w budżecie 100 ms. Druga tabela, tylko dla PR i bez bramki, mierzy pełne sprawdzenie bez pamięci podręcznej, z pustą (odsuniętą przed każdym uruchomieniem) i z ciepłą. Trzecia, też tylko dla PR i bez bramki, mierzy na przemian hook PostToolUse jednorazowo i przez [`inwards daemon`](#the-hook-daemon) i podaje p95 daemona względem celu 50 ms z [#60](https://github.com/SirCypkowskyy/inwards/issues/60). Wszystkie pozostałe uruchomienia ustawiają `INWARDS_DAEMON=0`, więc oba buildy działają jednorazowo. Bramka obejmuje tylko czas hooka i pełnego sprawdzenia, nie pamięć, start ani rozmiar pliku binarnego. Podsumowanie zadania pokazuje p50/p95 dla obu buildów (przy 12 pełnych uruchomieniach p95 to najwolniejsze z nich) i runner, na którym działało, a surowe próbki są zachowywane jako artefakt. Lokalnie build spowolniony o 30% nie przechodzi bramki, a dziesięć uruchomień identycznych buildów ani razu jej nie oblało (`bench/compare.ts`, `bench/test/compare.test.ts`).

**Korpus prawdziwych repozytoriów.** Biblioteka standardowa i kod syntetyczny nie wyglądają jak serwis we FastAPI albo Django, więc `.github/workflows/corpus.yml` uruchamia się co noc (i przy każdym PR, który zmienia korpus albo `prescan-diff.ts`) na pięciu repozytoriach open source przypiętych do commitów w `bench/corpus.json`. `bench/corpus.ts` pobiera każde z nich płytko, tylko przypięty commit, a w trzech przypadkach tylko katalog serwisu (`backend/`, `server/`, `saleor/`; tryb sparse cone przynosi też pliki z najwyższego poziomu repozytorium), łącznie około 40 MB. Uruchamia test różnicowy prescanu na każdym pliku `.py` w checkoucie i mierzy czas skompilowanego pliku binarnego: 5 pełnych sprawdzeń i 20 uruchomień `inwards check --no-cache <file>` na jednym pliku w każdym repozytorium, po jednym rozgrzewkowym przebiegu. Uruchomienia na jednym pliku nie czytają pamięci podręcznej, tak jak hooki; do [#122](https://github.com/SirCypkowskyy/inwards/issues/122) czytały tę, którą właśnie wypełniły pełne sprawdzenia, co ukrywało parsowanie. Żadne z tych repozytoriów nie ma tabeli `[tool.inwards]`, więc manifest nadaje każdemu nasz własny podział na warstwy (zapisany do `inwards-corpus.toml` w checkoucie i przekazywany przez `--config`). Liczby naruszeń wynikają z tego podziału i nic nie mówią o samych projektach. Zadanie kończy się błędem, gdy prescan pominie import, gdy liczba plików `.py` w checkoucie różni się od manifestu (zepsute pobieranie inaczej zmniejszyłoby korpus) albo gdy `inwards check` zakończy się kodem innym niż 0 lub 1. Repozytorium, którego nie da się pobrać po trzech próbach albo którego uruchomienie zawiedzie, jest odnotowywane w wynikach i oblewa zadanie; pozostałe repozytoria nadal się uruchamiają. Tabela trafia do podsumowania zadania, a surowe próbki do artefaktu `corpus-result`.

| Repozytorium | Licencja | Dlaczego jest w korpusie | Sprawdzane z warstwami |
|---|---|---|---|
| [fastapi/full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template) `cb740b6`, `backend/` | MIT | Oficjalny szablon FastAPI, układ, od którego zaczyna wiele małych serwisów | core, services, api |
| [ivan-borovets/fastapi-clean-example](https://github.com/ivan-borovets/fastapi-clean-example) `9271723` | MIT | Czysta architektura na FastAPI | core, outbound, inbound, main |
| [pgorecki/python-ddd](https://github.com/pgorecki/python-ddd) `429cd4b` | MIT | Modularny monolit DDD, trzy konteksty ograniczone | domain, application, infrastructure, interface |
| [polarsource/polar](https://github.com/polarsource/polar) `cfae1ba`, `server/` | Apache-2.0 | Duży serwis FastAPI na produkcji, około 70 pakietów funkcjonalnych | kit, models, features, entrypoints |
| [saleor/saleor](https://github.com/saleor/saleor) `5ff5648`, `saleor/` | BSD-3-Clause | Duży serwis w Django, większy niż syntetyczne repozytorium | core, apps, api |

Pierwsze uruchomienie, na laptopie opisanym w sekcji Środowisko (średnie obciążenie 3–4), `inwards` 0.1.0:

| Repozytorium | Pliki `.py` | Linie | Odmowy prescanu | Przeoczenia prescanu | Pełne sprawdzenie p50 / max | Jeden plik p50 / p95 | Naruszenia |
|---|--:|--:|--:|--:|--:|--:|--:|
| full-stack-fastapi-template | 40 | 2685 | 0 | 0 | 59 / 60 ms | 46 / 51 ms | 8 |
| fastapi-clean-example | 209 | 6764 | 0 | 0 | 80 / 87 ms | 46 / 49 ms | 2 |
| python-ddd | 139 | 5852 | 0 | 0 | 82 / 87 ms | 43 / 45 ms | 10 |
| polar | 1831 | 435 688 | 22 (1,2 %) | 0 | 1,16 / 1,37 s | 124 / 142 ms | 494 |
| saleor | 4324 | 847 875 | 13 (0,3 %) | 0 | 1,84 / 1,89 s | 59 / 62 ms | 758 |

Kolumna Naruszenia pochodzi z późniejszego uruchomienia (przegląd INW010 w [#45](https://github.com/SirCypkowskyy/inwards/issues/45)), już po dodaniu INW005 i INW010; liczba dla saleor obejmuje cztery zepsute importy znalezione przez INW010.

Dwie rzeczy, których syntetyczne repozytorium nie pokazało. `inwards check` na pliku `subscription/service.py` z polara (4482 linie, 175 KB, dwa naruszenia) trwa tu około 125 ms, a na runnerze GitHuba (AMD EPYC 7763, 2 rdzenie) 280 ms, powyżej budżetu 100 ms; mały plik z tego samego repozytorium trwa około 55 ms. Budżet dotyczy hooka Claude Code, który uruchamia to samo sprawdzenie jednego pliku (`runCheck` na edytowanym pliku) po odczytaniu danych wejściowych, więc hook może być tylko wolniejszy. Śledzone w [#122](https://github.com/SirCypkowskyy/inwards/issues/122). Ponowne lokalne uruchomienie po kompilacji do bajtkodu ([#118](https://github.com/SirCypkowskyy/inwards/pull/118)) skróciło każde sprawdzenie jednego pliku o 20 do 40 ms: plik z polara trwa teraz 83 / 90 ms (p50 / p95), plik z saleora 27 / 30 ms. Hook na pliku z polara, który sprawdza go dwa razy, przekraczał budżet, dopóki [#122](https://github.com/SirCypkowskyy/inwards/issues/122) nie zaczęło parsować drugiego sprawdzenia przyrostowo ([niżej](#a-large-file-checked-twice)). Do tego zimne pełne sprawdzenie 848 000 linii saleora trwa 1,8 s na jednym rdzeniu (2,5 s na runnerze GitHuba), podczas gdy syntetyczne repozytorium z 496 000 linii zajmuje 0,4 s.

### Wyniki { #results }

| Scenariusz | Wynik | Budżet | Stan |
|---|---|---|---|
| Zimne pełne uruchomienie, naiwne pełne parsowanie (pierwsze podejście) | 7,5 s | < 1 s | :material-close-circle: odrzucone, doprowadziło do ADR-004 |
| Zimne pełne uruchomienie, szkielet importów | 0,63–1,17 s (uruchomienia z dwóch sesji) | < 1 s | :material-alert: na granicy |
| Ciepłe pełne uruchomienie, pamięć podręczna ekstrakcji ([#56](https://github.com/SirCypkowskyy/inwards/issues/56)) | p50 0,46 s, wobec 1,25 s bez pamięci podręcznej w tym samym przebiegu (3,0 raza szybciej, maszyna pod obciążeniem) | nie dotyczy | |
| Zimne sprawdzenie całego projektu z szukaniem cykli importów ([#54](https://github.com/SirCypkowskyy/inwards/issues/54), `cycles = ["modules"]`), po 8 naprzemiennych uruchomień z `INWARDS_NO_CACHE=1`, średnie obciążenie około 1,1 | mediana 1,51 s wobec 1,35 s dla tego samego sprawdzenia bez niego; większość modułów leży w cyklicznych grupach, a każdy plik w nich jest potwierdzany (pełne parsowanie każdego trwałoby około 7 s) | < 1 s | :material-alert: ponad budżetem na tej maszynie, z szukaniem i bez niego; sprawdzenie punktowe poniżej, 0,40 do 0,44 s, było na nieobciążonej maszynie |
| Jeden plik, czas rzeczywisty ze startem procesu (30 uruchomień) | p50 48,6 ms, p95 80,4 ms | p95 < 100 ms | :material-check-circle: z niewielkim zapasem |
| Jeden plik, czas silnika zgłaszany przez CLI | 16 do 30 ms | nie dotyczy | |
| `inwards --version` (sam start procesu) | około 10 ms | nie dotyczy | |
| Indeks modułów + moduły importujące jeden moduł, na zimno, jeden rdzeń (2100 plików, świeży proces) | 0,1 s indeks + 0,65 do 0,74 s na moduły importujące (684 pliki wspominają `m0`: syntetyczne nazwy to najgorszy przypadek dla filtra tekstowego). Od #44 indeks niczego nie czyta z góry: jego zbudowanie trwa od 17 do 21 ms, wypisanie 2100 modułów od 25 do 32 ms, a moduły importujące czytają potrzebne im pliki, łącznie od 0,53 do 0,71 s (od 0,58 do 0,66 s dla zachłannego indeksu, który zastąpił) | < 1 s | :material-check-circle: |
| Odmowy prescanu na bibliotece standardowej CPythona 3.14 | 8,3 % z 1921 plików | im mniej, tym szybciej | :material-check-circle: |
| Importy pominięte przez prescan na tym samym korpusie | 0 | 0 | :material-check-circle: |
| Importy pominięte przez prescan na korpusie prawdziwych repozytoriów (6543 pliki, pięć serwisów) | 0 | 0 | :material-check-circle: |
| Szczytowe zużycie pamięci, pełne uruchomienie syntetyczne | około 120 MB RSS | nie dotyczy | |
| Rozmiar pliku binarnego, Linux x64 | 82 MB | nie dotyczy | :material-alert: duży |

<figure markdown="span">
  ![zimne uruchomienie na syntetycznym repozytorium z 2100 plikami](../assets/screens/benchmark.svg){ loading=lazy }
  <figcaption>Jedno zimne uruchomienie na syntetycznym repozytorium, jeden rdzeń. Rozrzut między uruchomieniami jest w tabeli powyżej.</figcaption>
</figure>

!!! note "Wyrywkowe sprawdzenie na 0.1.0 (2026-09-26)"
    Ten sam laptop, świeży build `inwards-linux-x64`, średnie obciążenie około 1, zmierzone dwa razy niezależnie z tym samym wynikiem. Sprawdzenie jednego pliku w przykładowej aplikacji, 30 uruchomień: p50 37 ms, p95 40 ms czasu rzeczywistego, 14 ms czasu silnika. `inwards --version`: około 19 ms, wcześniej około 10 ms. Zimne pełne uruchomienie na syntetycznym repozytorium, 5 uruchomień: 0,40 do 0,44 s. Szczytowe RSS około 207 MB, wcześniej około 120 MB. Rozmiar pliku binarnego bez zmian, 82 MB (79 MiB). Opisany niżej eksperyment z bajtkodem skrócił start o połowę już po tym sprawdzeniu, a rozkład czasu startu przeliczono z jego użyciem. Benchmark w CI ([#29](https://github.com/SirCypkowskyy/inwards/issues/29)) oblewa teraz każdy PR, który spowalnia hook albo pełne sprawdzenie o ponad 20%; nie śledzi pamięci, startu ani rozmiaru pliku binarnego.

### Eksperyment: bajtkod i minifikacja { #spike-bytecode-and-minification }

[#39](https://github.com/SirCypkowskyy/inwards/issues/39) pytało, czy flagi `bun build --compile` skracają start albo zmniejszają plik binarny. Od tego czasu `scripts/build-binaries.ts` buduje z `--bytecode --format=esm` oprócz `--minify --sourcemap=linked`.

**Metoda.** Sześć wariantów `inwards-linux-x64` z jednego commitu, Bun 1.4.2, ten sam laptop co wyżej. Start: 200 rund `inwards --version`, każdy wariant raz na rundę w rotującej kolejności. Hook i pełne sprawdzenie: `bench/compare.ts` z obecnym buildem jako bazą, 100 uruchomień hooka i 20 pełnych sprawdzeń na stronę, zmiana jako mediana stosunków w parach. Szczytowe RSS: `/usr/bin/time -f %M`, mediana z 5 uruchomień. MB oznacza wszędzie 10^6 bajtów. Średnie obciążenie wynosiło 2 do 6 w trakcie uruchomień, więc bardziej ufaj stosunkom niż bezwzględnym milisekundom; porównanie bazy z bazą dało różnicę 0,2% (hook) i 0,6% (pełne).

| Wariant | Rozmiar (Linux x64) | `inwards --version` p50 / p95 | Hook, jeden plik | Pełne sprawdzenie | Szczytowe RSS, pełne / hook |
|---|---|---|---|---|---|
| Przedtem: `--minify --sourcemap=linked` | 82,4 MB (37,1 MB po gzip) | 22,3 / 30,9 ms | baza | baza | 202 / 54 MB |
| Bez `--minify` | 82,6 MB | +3,0% | +3,7% | +1,5% | 203 MB pełne |
| Bez sourcemapy | 82,2 MB | -0,7% | nie uruchomiono | nie uruchomiono | |
| Bez automatycznego wczytywania `.env` i `bunfig.toml` | 82,4 MB | -0,8% | -3,0% | +0,6% | 205 MB pełne |
| `--bytecode` (CJS, domyślny w Bunie z tą flagą) | 85,0 MB | 10,0 / 14,6 ms (-56%) | -45,6% | -5,6% | 205 / 55 MB |
| **`--bytecode --format=esm` (przyjęty)** | 84,9 MB (38,4 MB po gzip) | 10,5 / 14,3 ms (-53%) | -45,4% | -7,0% | 205 / 56 MB |

Powtórka z zacommitowanym buildem i domyślnymi ustawieniami `bench/compare.ts` (40 uruchomień hooka, 12 pełnych sprawdzeń) dała dla hooka p50 / p95 64,4 / 73,6 ms przedtem i 32,6 / 37,4 ms potem (-48,0%), a dla pełnego sprawdzenia -9,9%. Drugie uruchomienie pomiaru startu dało 25,0 ms przedtem i 10,8 ms potem. Na przykładowej aplikacji, 60 naprzemiennych sprawdzeń jednego pliku: p50 58,7 → 30,3 ms i p95 77,7 → 39,5 ms czasu rzeczywistego, a własny czas silnika spadł z 21,7 do 14,5 ms, bo silnik i klej JS web-tree-sittera też nie są już parsowane przy pierwszym wywołaniu.

- **Wygrywa bajtkod.** Przenosi parsowanie JS z każdego startu na czas budowania. Kosztuje 2,5 MB na plik binarny (1,3 MB po gzip) i od 1 do 3 MB RSS.
- **Rozmiaru nie da się naprawić flagami.** Wszystko, co dodaje Inwards, to mniej niż 1 MB (176 KB zminifikowanego JS, 0,67 MB WASM); reszta to środowisko Buna. Minifikacja była już włączona i oszczędza 0,1 MB; sourcemapa kosztuje 0,26 MB i sprawia, że stosy wywołań wskazują źródło w TypeScripcie, więc zostaje.
- **ESM, nie CJS.** W bezpośrednim porównaniu oba buildy z bajtkodem różnią się o +2,9% (hook) i +2,2% (pełne), w granicach szumu. ESM zachowuje semantykę modułów, którą plik binarny miał wcześniej.
- **Sprawdzone.** 350 testów przechodzi na skompilowanym pliku binarnym (`INWARDS_BIN=dist/inwards-linux-x64 bun test`), podobnie `--version` i oba osadzone pliki `.wasm` (każde sprawdzenie parsuje). Program testowy zbudowany w ten sam sposób wciąż podaje linię w TypeScripcie dla rzuconego błędu przez dołączoną sourcemapę. Wszystkie sześć platform docelowych kompiluje się skrośnie, a build musl sprawdza syntetyczne repozytorium wewnątrz Alpine. Macierz testów w CI buduje i testuje pliki binarne dla macOS i Windows natywnie.
- **Niewypróbowane.** Aktualna dokumentacja Buna wymienia `--compile-jit-policy` i `--bytecode-order` (układ bajtkodu sterowany profilem); `bun build` w Bunie 1.4.2 nie ma żadnej z nich. `--bytecode-depth`, które 1.4.2 ma, nie zostało zmierzone. Warto do tego wrócić po aktualizacji Buna.

### Na co idzie czas przy sprawdzeniu jednego pliku { #where-a-single-file-check-spends-its-time }

Przeliczone w eksperymencie z bajtkodem, na buildzie z bajtkodem. Start procesu to `inwards --version`. Liczby dla gramatyki i parsowania pochodzą ze skryptu skompilowanego w ten sam sposób, który mierzy czas odczytu osadzonych plików `.wasm`, `Parser.init`, `Language.load` i jednego parsowania `shop/domain/order.py` z przykładowej aplikacji, mediana z 30 uruchomień. „Konfiguracja + I/O + reguły” to czas silnika zgłaszany przez CLI (14,5 ms) minus powyższe, a nie pomiar.

```mermaid
---
config:
  theme: base
  themeVariables:
    pieSectionTextColor: "#ffffff"
    pieTitleTextColor: "#6b7580"
    pieStrokeColor: "#ffffff"
    pieOpacity: "1"
    pie1: "#084e65"
    pie2: "#0b6784"
    pie3: "#2f7f99"
    pie4: "#3e4852"
    pie5: "#56616c"
    pie6: "#6b7580"
---
pie showData
    title Sprawdzenie jednego pliku, około 25 ms pracy (silnik + start)
    "Start procesu (środowisko Buna)" : 10.5
    "Inicjalizacja środowiska WASM" : 7.8
    "Wczytanie gramatyki Pythona (447 KB)" : 2.7
    "Parsowanie pliku (pierwsze parsowanie)" : 2
    "Konfiguracja + I/O plików + reguły (reszta)" : 1.5
    "Odczyt osadzonych plików .wasm" : 0.5
```

W M0 to samo sprawdzenie oznaczało około 30 ms pracy: 10 ms startu procesu, 12 ms inicjalizacji WASM, 3,5 ms wczytywania gramatyki, 1 ms parsowania i 3,5 ms reszty, wszystko bez bajtkodu. Parsowanie pliku to wciąż mały kawałek. Około 85% kosztu to płacenie tej samej ceny za start przy każdym wywołaniu hooka. Mediana czasu rzeczywistego, 30 ms, jest wyższa niż te 25 ms pracy, bo narzędzie pomiarowe uruchamia proces, a mechanizm uruchamiający hooki agenta też za to płaci.

To zmienia plan poprawy wydajności. W pętli agenta szybkość parsowania nie ma dużego znaczenia. Liczy się start.

### Eksperyment: stały proces { #spike-a-resident-process }

[#59](https://github.com/SirCypkowskyy/inwards/issues/59) pytało, czy hooki i serwer języka powinny dzielić jeden stały proces i co hooki by na nim zyskały. Decyzja to [ADR-039](05-ADR.md#adr-039-a-hook-daemon-per-project-separate-from-the-language-server).

**Metoda.** Jeden laptop arm64 z macOS, Bun 1.4.2, `inwards-darwin-arm64` zbudowany przez `scripts/build-binaries.ts` z `aede2ab`. Na maszynie pracowali inni agenci, więc średnie obciążenie wynosiło od 5 do 7; bardziej ufaj różnicom niż wartościom bezwzględnym. Projekt to `examples/broken-app` z dodanym wygenerowanym `shop/domain/big.py`: 4492 linie, 114 KB, dwa naruszenia INW001, blisko pliku z polara z [#122](https://github.com/SirCypkowskyy/inwards/issues/122) (4482 linie, dwa naruszenia). Dane wejściowe hooka to fixture `PostToolUse` z Claude Code skierowany na każdy z plików, po SessionStart, więc naruszenia obu plików liczą się jako stare. Każdy przypadek uruchomiono 80 razy (60 dla PreToolUse i Stop), w każdej rundzie raz, w zmieniającej się kolejności, po jednym rozgrzewkowym uruchomieniu; sprawdzenia działały z `INWARDS_NO_CACHE=1`. Stały proces to jednorazowy skrypt Buna uruchamiany ze źródeł, który obsługuje dzisiejsze `hookClaudeCode` na ciepło za gniazdem uniksowym, z `Runtime` dla każdego żądania i buforowanymi `Streams`; klient to 10-liniowy program skompilowany jak plik binarny. „Z pamięciami podręcznymi” dodaje pamięciową pamięć podręczną ekstrakcji z kluczem z treści i zachowuje na czas życia procesu odpowiedzi `git cat-file blob`, które wskazują commit.

| Scenariusz | p50 | p95 |
|---|--:|--:|
| Pusty program skompilowany jak plik binarny | 16,6 ms | 17,4 ms |
| `inwards --version` | 15,5 ms | 16,9 ms |
| Klient z eksperymentu, gdy żaden daemon nie nasłuchuje | 13,1 ms | 14,1 ms |
| `inwards check` na 13-liniowym `order.py` | 27,7 ms | 30,6 ms |
| `inwards check` na `big.py` | 70,8 ms | 77,3 ms |
| Te same dwa sprawdzenia na ciepło, w jednym procesie (`runCheck`, 200 uruchomień) | 0,8 / 29,8 ms | 1,4 / 31,3 ms |
| PreToolUse, jednorazowo | 16,8 ms | 17,6 ms |
| Stop na obu plikach, jednorazowo | 141,1 ms | 149,6 ms |
| PostToolUse `order.py`: jednorazowo | 46,6 ms | 50,2 ms |
| PostToolUse `order.py`: stały proces | 32,3 ms | 35,2 ms |
| PostToolUse `order.py`: stały proces z pamięciami podręcznymi | 17,2 ms | 19,8 ms |
| PostToolUse `big.py`: jednorazowo | 119,9 ms | 151,6 ms |
| PostToolUse `big.py`: stały proces | 91,1 ms | 97,7 ms |
| PostToolUse `big.py`: stały proces z pamięciami podręcznymi | 18,2 ms | 19,7 ms |
| PostToolUse `big.py` zmieniany przed każdym wywołaniem (40 rund): jednorazowo | 117,5 ms | 122,8 ms |
| PostToolUse `big.py` zmieniany przed każdym wywołaniem: stały proces z pamięciami podręcznymi | 47,6 ms | 50,1 ms |

- **Start klienta to podłoga.** Każde wywołanie hooka uruchamia proces, tu około 15 ms, zanim w ogóle dotrze do daemona. Wykrycie, że żaden daemon nie nasłuchuje, nie kosztuje nic mierzalnego.
- **Jedno wywołanie gita to połowa hooka dla małego pliku.** PostToolUse czyta tekst pliku ze startu sesji przez `git cat-file blob`, żeby oddzielić stare naruszenia od nowych: na tej maszynie około 15 ms na wywołanie. Daemon czyta go raz na sesję.
- **PostToolUse sprawdza plik dwa razy,** taki, jaki jest teraz, i taki, jaki był na starcie sesji: po 30 ms dla `big.py`, na ciepło. Z pamięcią podręczną z kluczem z treści tekst ze startu jest parsowany raz na sesję; edytowany plik nadal kosztuje jedno parsowanie.
- **Rozgrzany JIT też się liczy.** Jednorazowe sprawdzenie kosztuje o 27 ms więcej niż ciepłe dla `order.py` i o 41 ms więcej dla `big.py`. Dodatkowe 14 ms to kod parsowania i przechodzenia drzewa, którego świeży proces jeszcze nie zoptymalizował.
- **PreToolUse nie może zyskać:** 16,8 ms wobec podłogi 15,5 ms. Stop trwa 141 ms, ale raz na turę.
- **Pamięć.** Stałe procesy zajmowały po pomiarach 151 i 212 MB RSS.
- **Niezmierzone:** nazwane potoki na Windows, skompilowany plik binarny jako stały proces i Linux. Skrypty eksperymentu były jednorazowe i nie ma ich w repozytorium; [#60](https://github.com/SirCypkowskyy/inwards/issues/60) dodaje daemona do zadania benchmarku.

### Daemon hooków { #the-hook-daemon }

[#60](https://github.com/SirCypkowskyy/inwards/issues/60) zbudowało stały proces, który mierzył eksperyment powyżej, tak jak zdecydował [ADR-039](05-ADR.md#adr-039-a-hook-daemon-per-project-separate-from-the-language-server): `inwards daemon` obsługuje PostToolUse przez gniazdo Unix (na Windows przez nazwany potok), trzyma ekstrakcje według skrótu tekstu i odpowiedzi gita według identyfikatora commita, a wszystko inne czyta od nowa przy każdym żądaniu. Samo polecenie hooka się nie zmieniło, więc każdy PostToolUse nadal uruchamia jeden proces.

**Metoda.** Ten sam laptop arm64 z macOS co w eksperymencie, skompilowany `inwards-darwin-arm64` z bajtkodem, średnie obciążenie 5 do 7 od innych agentów. `examples/broken-app` w świeżym repozytorium git z wygenerowanym `shop/domain/big.py` o 4492 liniach z dwoma naruszeniami INW001, po SessionStart, więc każde znalezisko jest stare, a hook czyta tekst każdego pliku ze startu z gita. Uruchomienie jednorazowe (`INWARDS_DAEMON=0`) i przez daemona na przemian w każdej rundzie, z `INWARDS_NO_CACHE=1`; 80 rund po 2 rozgrzewkowych, 40, gdy plik zmienia się przed każdym wywołaniem.

| PostToolUse | Jednorazowo p50 / p95 | Przez daemona p50 / p95 |
|---|--:|--:|
| `order.py`, 13 linii | 38,0 / 39,3 ms | 15,3 / 16,2 ms |
| `big.py`, 4492 linie | 75,7 / 81,8 ms | 16,0 / 19,2 ms |
| `big.py`, zmieniany przed każdym wywołaniem | 76,1 / 79,0 ms | 26,8 / 36,8 ms |

- **Cel jest spełniony na tym laptopie.** p95 jest poniżej 50 ms w każdym przypadku, także dla dużego pliku zmienianego przed każdym wywołaniem, gdzie prototyp z eksperymentu miał 50,1 ms.
- **Syntetyczne repozytorium zadania benchmarku** na tym samym laptopie: 23,8 / 25,3 ms jednorazowo, 14,9 / 16,5 ms przez daemona (40 uruchomień; bez sesji, więc bez odczytu z gita).
- **Pamięć.** Daemon zajmował 188 MB RSS po 206 uruchomieniach hooka na obu plikach.
- **Niezmierzone tutaj:** nazwane potoki na Windows. CI uruchamia testy daemona na Linuksie w każdym PR; wiersze Windows i macOS uruchamiają je tylko w ręcznej pełnej macierzy przed wydaniem.

### Duży plik sprawdzany dwa razy { #a-large-file-checked-twice }

[#122](https://github.com/SirCypkowskyy/inwards/issues/122) wykazało, że jednorazowy hook PostToolUse przekracza budżet 100 ms na pliku `server/polar/subscription/service.py` z polara (4482 linie, dwa naruszenia INW001). Hook sprawdza edytowany plik w obecnej postaci i drugi raz w postaci ze startu sesji, żeby odróżnić stare naruszenia od nowych, a plik z naruszeniem za każdym razem wymaga pełnego parsowania. Profil CPU jednego uruchomienia (95 ms) pokazał 43 ms w dwóch parsowaniach tree-sittera i 14 ms w `git cat-file blob`, który czyta tekst ze startu.

**Co się zmieniło.** Silnik przyjmuje opcjonalny `TreeReuse` (`src/core/src/python/reparse.ts`), który trzyma ostatnie pełne parsowanie. Gdy następne pełne parsowanie dotyczy tej samej ścieżki, opisuje tree-sitterowi zmianę między dwoma tekstami jako jedną edycję (zakres między ich wspólnym prefiksem i sufiksem, w jednostkach kodu UTF-16) i parsuje od starego drzewa, więc od nowa parsowany jest tylko zmieniony fragment. CLI trzyma jeden taki obiekt na proces, a `inwards daemon` jeden na cały czas działania, więc jego następne żądanie dla tego samego pliku korzysta z poprzedniego. Jeśli nowe drzewo ma błąd składni, plik jest parsowany jeszcze raz od zera: odtwarzanie po błędzie może pójść inną drogą, gdy zaczyna od starego drzewa, i pierwsza wersja testu złapała taki przypadek. Wynik się nie zmienia: `src/core/test/python/reparse.test.ts` porównuje każdy węzeł ze świeżym parsowaniem na wybranych ręcznie edycjach i na 12 losowanych z ziarnem łańcuchach po 25 edycji, a jednorazowe uruchomienie na 655 plikach biblioteki standardowej CPythona 3.14, z czterema nałożonymi edycjami na plik i trzema ziarnami (7860 parsowań, około połowa z błędami składni), nie znalazło żadnej różnicy w drzewach, importach ani komentarzach wyciszających.

**Metoda.** Laptop arm64 z macOS i 10 rdzeniami, plik binarny darwin-arm64 z `develop` (`ec2bd65`) wobec tego, oba zbudowane przez `scripts/build-binaries.ts`. Na maszynie pracowali inni agenci (średnie obciążenie 4 do 10), więc stosunkom warto ufać bardziej niż milisekundom. polar na commicie z korpusu, z podziałem na warstwy z korpusu, po SessionStart, więc oba naruszenia są stare; „zmieniony” oznacza, że przed każdym wywołaniem dodano linię. Oba buildy występują na przemian w każdej rundzie, 60 rund po 2 rozgrzewkowych (40 dla wierszy z daemonem, mierzonych build po buildzie).

| polar `subscription/service.py` | Przed p50 / p95 | Po p50 / p95 |
|---|--:|--:|
| PostToolUse jednorazowo, plik niezmieniony od startu sesji | 99,8 / 101,8 ms | 84,6 / 87,5 ms |
| PostToolUse jednorazowo, plik zmieniony | 99,7 / 103,9 ms | 86,5 / 88,4 ms |
| PostToolUse przez daemona, plik zmieniony | 44,3 / 62,9 ms | 28,3 / 31,9 ms |
| `inwards check --no-cache` na tym pliku | 60,0 / 61,6 ms | 59,2 / 61,5 ms |

- **Budżet jest dotrzymany na tym laptopie** na każdej ścieżce: p95 jest poniżej 100 ms jednorazowo i poniżej 50 ms przez daemona.
- **Drugie parsowanie kosztuje około 3 ms zamiast około 16 ms** przy edycji kilku linii, mierzone w procesie na tym samym pliku.
- **`inwards check` jednego pliku się nie zmienia,** bo parsuje raz. Pełne sprawdzenie też nie: tam żaden plik nie jest parsowany dwa razy.
- **Zadanie benchmarku** mierzy teraz hook na module z 4478 liniami podobnym do pliku z polara (`bench/large-file.ts`): 105,5 / 107,5 ms przed, 87,5 / 89,3 ms po na tym samym laptopie (po 40 uruchomień).
- **Co zostaje z jednorazowego hooka:** około 15 ms startu procesu, 14 ms na odczyt tekstu ze startu z gita i pierwsze pełne parsowanie.

### Wątki robocze dla pełnego uruchomienia { #worker-threads-for-a-full-run }

[#61](https://github.com/SirCypkowskyy/inwards/issues/61) rozłożyło zimne pełne sprawdzenie na kilka wątków. Decyzję i odrzucone możliwości opisuje [ADR-040](05-ADR.md#adr-040-worker-threads-parse-a-large-full-check-the-main-thread-keeps-every-decision).

**Co działa gdzie.** `inwards check` i `inwards baseline` uruchamiają wątki robocze, gdy czytają 1000 plików lub więcej: jeden wątek na 500 plików, do `INWARDS_THREADS`, a bez niej do połowy rdzeni ponad dwa, najwyżej 4 (o Linuksie niżej). Wątek główny liczy się jako jeden z nich. Workery robią tylko to, o czym decyduje tekst pliku: test na loader, szkielet importów oraz importy i komentarze wyciszające z pełnego parsowania. Wątek główny przechodzi drzewo, czyta pliki, uruchamia wszystkie reguły w kolejności plików i sam parsuje nieliczne pliki z importami dynamicznymi. Wynik jest identyczny co do bajtu przy dowolnej liczbie wątków, a `INWARDS_THREADS=1` trzyma całe sprawdzenie w jednym wątku.

**Metoda.** Plik binarny darwin-arm64 zbudowany przez `scripts/build-binaries.ts`, bazowa kompilacja z `develop` (`73936df`) wobec tej, na laptopie arm64 z macOS i 10 rdzeniami. Na maszynie pracowali inni agenci, więc średnie obciążenie wynosiło od 4 do 7: bardziej ufaj proporcjom niż milisekundom. Każdy przypadek uruchomiono 11 razy po jednej rozgrzewce, każdy raz na rundę w zmiennej kolejności, z `INWARDS_NO_CACHE=1`; JSON z każdego uruchomienia musiał się zgadzać z bazową kompilacją. Prawdziwe repozytoria są sprawdzane z warstwami z korpusu (`bench/corpus.json`). Szczytowe RSS to `/usr/bin/time -l`, po trzy uruchomienia.

| Repozytorium | Pliki | Baza | Jeden wątek | Cztery wątki (domyślnie) | Osiem wątków |
|---|--:|--:|--:|--:|--:|
| saleor | 4324 | 1,48 s | 1,43 s | 0,98 s (1,51×) | 1,04 s |
| polar | 1831 | 0,80 s | 0,76 s | 0,55 s (1,45×) | 0,55 s |
| Syntetyczne (`bench/generate.py`) | 2100 | 0,52 s | 0,49 s | 0,44 s (1,17×) | 0,48 s |
| Syntetyczne w trybie starszego kodu (`--legacy`, każdy moduł wymaga potwierdzenia) | 2101 | 2,34 s | 2,31 s | 1,14 s (2,04×) | 1,03 s |

- **Jeden wątek też przyspieszył**, o 2% do 5%: sprawdzenie ustala teraz rzeczywistą ścieżkę każdego pliku raz zamiast dwa razy.
- **Parsowanie się skaluje, reszta nie.** Przy czterech wątkach saleor spędza mniej więcej jedną trzecią czasu na przejściu drzewa, ustalaniu rzeczywistych ścieżek i czytaniu plików, zanim ruszy silnik, potem około 120 ms na regułach i 100 ms na potwierdzeniach i raporcie, wszystko w wątku głównym. Najwięcej zyskuje repozytorium w trybie starszego kodu, w którym każdy moduł wymaga pełnego parsowania.
- **Więcej wątków szybko przestaje się opłacać.** Każdy worker sam kompiluje gramatykę i rozgrzewa swój JIT, a obciążona maszyna ma mniej wolnych rdzeni, niż podaje. Poniżej 1000 plików wątki kosztują mniej więcej tyle, ile oszczędzają: 537 plików saleora trwało 207 ms w jednym wątku i 218 ms w trzech.
- **Pamięć.** Szczytowe RSS saleora wzrosło z około 360 MB w jednym wątku do około 520 MB przy czterech i 615 MB przy ośmiu.
- **Pamięć podręczna i hooki.** Sprawdzenie z ciepłą pamięcią podręczną się nie zmieniło (0,95 → 0,91 s na saleorze), uruchomienie, które wypełnia pustą pamięć podręczną, przyspieszyło (2,6 → 2,05 s), a `bench/compare.ts` zmierzył hook i sprawdzenie PreToolUse nowego pliku w granicach 3% od bazy, pełne sprawdzenie o 20,5% szybsze.
- **Linux, i dlaczego domyślnie zostają wolne rdzenie.** Pierwsze uruchomienie zadania benchmarku w CI, na runnerze Linux arm64, który podaje 4 rdzenie, zmierzyło pełne sprawdzenie repozytorium syntetycznego o 59% wolniejsze przy czterech wątkach. Plik binarny linux-arm64 w kontenerze Ubuntu 24.04 na tym samym laptopie, przypięty do czterech albo ośmiu rdzeni (`--cpuset-cpus`), po pięć uruchomień, dał takie mediany:

    | Rdzenie | Repozytorium | 1 wątek | 2 | 3 | 4 |
    |--:|---|--:|--:|--:|--:|
    | 4 | syntetyczne | 0,42 s | 0,44 s | 0,53 s | 0,67 s |
    | 4 | syntetyczne w trybie starszego kodu | 2,28 s | 2,33 s (1,67 do 2,34) | 1,54 s | 1,77 s |
    | 8 | syntetyczne | 0,42 s | 0,38 s | 0,40 s | 0,44 s |
    | 8 | syntetyczne w trybie starszego kodu | 2,30 s | 1,68 s | 1,38 s | 1,23 s |

    Każdy wątek uruchamia własną maszynę wirtualną JavaScriptu, a jej kompilator JIT i odśmiecacz działają w osobnych wątkach, więc wątek na rdzeń głodzi wątek główny. Przy dwóch wątkach domyślnie na tym runnerze zadanie benchmarku nadal mierzyło pełne sprawdzenie repozytorium syntetycznego o 19% wolniejsze. Teraz domyślnie jest połowa rdzeni ponad dwa, najwyżej 4: jeden wątek na 4 rdzeniach, trzy na 8 i cztery od 10, jak na laptopie wyżej.
- **Niezmierzone:** hostowany 4-rdzeniowy runner `ubuntu-latest` GitHuba i Windows.

### Szeregowa część pełnego uruchomienia { #the-serial-part-of-a-full-run }

Przy czterech wątkach saleor spędzał mniej więcej jedną trzecią zimnego sprawdzenia w wątku głównym, zanim ruszył silnik: na przejściu drzewa, ustalaniu rzeczywistych ścieżek i czytaniu plików. [#281](https://github.com/SirCypkowskyy/inwards/issues/281) skróciło tę część. Wynik jest identyczny co do bajtu, a przejście drzewa znajduje te same pliki pod tymi samymi nazwami modułów.

**Co się zmieniło.**

- **Jedna rzeczywista ścieżka na katalog, nie dwie na plik.** Przejście drzewa ustala `realpath` każdego katalogu i każdego dowiązania symbolicznego. Zwykły plik dostaje rzeczywistą ścieżkę swojego katalogu i nazwę, którą zwrócił `readdir`: plik, który nie jest dowiązaniem, nie dokłada żadnego dowiązania, więc `realpath` powtórzyłby tylko to, co przejście już ustaliło. Sprawdzenie używa potem tych ścieżek zamiast ustalać każdy plik jeszcze raz. Na saleorze przejście drzewa skróciło się z około 114 ms do 30 ms, a druga runda `realpath` (około 75 ms) zniknęła.
- **Pliki są czytane jedną partią.** Sprawdzenie 1000 plików lub więcej prosi o wszystkie pliki naraz (`fs.promises.readFile`), więc odczyty czekają na dysk razem: 4324 pliki saleora w około 55 ms zamiast 90 ms. Mniejsze sprawdzenie i każdy hook czytają pliki po kolei, jak dotąd.
- **Workery startują przed czytaniem.** Sprawdzenie liczy pliki, zanim je przeczyta, więc pula startuje pierwsza i workery ładują gramatykę, gdy wątek główny czyta.
- **Każdy worker trzyma dwie partie.** Worker, który skończył partię, czekał dotąd, aż wątek główny, zajęty własną partią, wróci do pętli zdarzeń i wyśle mu następną. Teraz następna już czeka w jego kolejce.

**Metoda.** Jak dla wątków roboczych wyżej: plik binarny darwin-arm64, 11 uruchomień na kompilację po jednej rozgrzewce, w rotacyjnej kolejności, z `INWARDS_NO_CACHE=1`, a JSON każdego uruchomienia porównany z pozostałymi. Bazy to jednowątkowa baza z #61 (`73936df`) i `develop` przed tą zmianą (`3dc5489`, cztery wątki). Na tym samym laptopie pracowali inni agenci (średnie obciążenie od 5 do 11).

| Repozytorium | Pliki | Baza #61 (jeden wątek) | `develop` (cztery wątki) | Teraz (cztery wątki) | Teraz (jeden wątek) |
|---|--:|--:|--:|--:|--:|
| saleor | 4324 | 1,59 s | 1,09 s | 0,87 s | 1,31 s |
| polar | 1831 | 0,79 s | 0,57 s | 0,47 s | 0,67 s |
| Syntetyczne (`bench/generate.py`) | 2100 | 0,51 s | 0,43 s | 0,33 s | 0,40 s |
| Syntetyczne w trybie starszego kodu (`--legacy`) | 2101 | 2,47 s | 1,23 s | 1,03 s | 2,34 s |

Baza z #61 mierzyła na saleorze od 1,48 do 1,62 s w sześciu sesjach tego dnia, a ta zmiana od 0,74 do 0,87 s przy czterech wątkach: od 1,83× do 2,00×, z medianą 1,93×. Dwukrotne przyspieszenie, o które prosiło #281, jest więc na granicy, a nie wyraźnie osiągnięte. Wszystkie uruchomienia każdej kompilacji dały ten sam JSON.

**Każda zmiana osobno.** Kompilacje, z których każda pomija jedną zmianę, na saleorze, po 11 uruchomień (średnie obciążenie od 7 do 16): wszystkie cztery 744 ms; bez rzeczywistych ścieżek z przejścia drzewa 861 ms, bez czytania partią 812 ms, z pulą startowaną po czytaniu 776 ms, z jedną partią na workera 794 ms.

**Co się nie opłaciło i zostało usunięte.**

- *Listowanie dowiązań w warstwach, gdy odczyty czekają.* macOS szereguje wywołania systemu plików: przejście po dowiązaniach trwało w trakcie odczytów od 76 do 102 ms zamiast 21 ms po nich, a suma się nie zmieniła.
- *Uruchamianie workerów na plikach w miarę ich czytania.* Wolne workery liczyły szkielety każdej porcji 256 plików zaraz po jej przeczytaniu, a wywołanie silnika używało odpowiedzi na identyczne zadania. Saleor 775 → 792 ms, polar 475 → 478 ms, repozytoria syntetyczne w granicach 1%: żaden zysk wart drugiej kolejki w puli.
- *Mniej wywołań `realpath` na katalogach.* Przejście drzewa ogranicza `readdir`: 23 ms z nimi i bez nich.

**Linux.** Plik binarny linux-arm64 w kontenerze Ubuntu 24.04 na tym samym laptopie, po siedem uruchomień. Przypięty do czterech rdzeni, gdzie domyślnie działa jeden wątek, nic się nie zmieniło: saleor 1,24 s przed i po, polar 0,68 s, repozytorium syntetyczne 0,42 s, w trybie starszego kodu 2,27 s. Linux tanio odpowiada na `realpath` i odczyty plików ze swoich pamięci podręcznych, więc usunięta szeregowa część była kosztem macOS. Przypięty do ośmiu rdzeni (trzy wątki) saleor przyspieszył z 0,92 do 0,87 s, a repozytorium w trybie starszego kodu z 1,43 do 1,37 s. Trzykrotne przyspieszenie na 4 vCPU, o które prosiło #61, pozostaje poza zasięgiem: maszyna z 4 rdzeniami zostaje przy jednym wątku, a ten wątek spędza czas na parsowaniu i regułach.

**Co zostaje w wątku głównym.** Zmierzone ze źródeł na saleorze przy czterech wątkach: około 45 ms na przejście drzewa i nazwanie plików, 70 ms na ich przeczytanie, potem silnik: 260 ms na partię szkieletów (dzieloną z workerami), 127 ms na skany, 135 ms na partię pełnych parsowań (dzieloną), 60 ms na potwierdzenia i raport oraz 33 ms na kontrole całego uruchomienia. Skany i potwierdzenia to reguły, które z założenia zostają w jednym wątku ([ADR-040](05-ADR.md#adr-040-worker-threads-parse-a-large-full-check-the-main-thread-keeps-every-decision)).

### Plan poprawy wydajności { #performance-roadmap }

| Krok | Oczekiwany efekt | Na co wpływa |
|---|---|---|
| :material-check-circle: `inwards daemon`: stały proces dla każdego projektu, z którym PostToolUse łączy się przez lokalne gniazdo, z powrotem do jednorazowego uruchomienia; serwer języka zostaje osobnym procesem, `inwards server` ([ADR-039](05-ADR.md#adr-039-a-hook-daemon-per-project-separate-from-the-language-server), [#60](https://github.com/SirCypkowskyy/inwards/issues/60)), zrobione | Zmierzone ([wyżej](#the-hook-daemon)): p95 PostToolUse 39,3 → 16,2 ms dla pliku z 13 liniami, 79,0 → 36,8 ms dla pliku z 4492 liniami edytowanego przed każdym wywołaniem | p95 dla jednego pliku |
| :material-check-circle: Przyrostowe parsowanie pliku sprawdzanego dwa razy: sprawdzenie hooka teraz i w stanie ze startu sesji, następna edycja w daemonie ([#122](https://github.com/SirCypkowskyy/inwards/issues/122)), zrobione | Zmierzone ([wyżej](#a-large-file-checked-twice)) na pliku z polara z 4482 liniami: p95 PostToolUse 103,9 → 88,4 ms jednorazowo, 62,9 → 31,9 ms przez daemona | p95 dla jednego pliku |
| :material-check-circle: `bun build --bytecode` ([#39](https://github.com/SirCypkowskyy/inwards/issues/39)), zrobione | Zmierzone: start 22 → 10 ms, wywołanie hooka około 45% szybsze, 2,5 MB więcej na plik binarny (zobacz eksperyment wyżej) | p95 dla jednego pliku |
| :material-check-circle: Wątki robocze dla zimnego pełnego uruchomienia ([#61](https://github.com/SirCypkowskyy/inwards/issues/61), [ADR-040](05-ADR.md#adr-040-worker-threads-parse-a-large-full-check-the-main-thread-keeps-every-decision)), zrobione | Zmierzone przy czterech wątkach (zobacz sekcję wyżej): saleor 1,48 → 0,98 s, polar 0,80 → 0,55 s, repozytorium syntetyczne 0,52 → 0,44 s, syntetyczne w trybie starszego kodu 2,34 → 1,14 s. Daleko do oczekiwanego trzykrotnego przyspieszenia, bo czytanie plików i reguły zostają w jednym wątku | Zimne pełne uruchomienie |
| :material-check-circle: Tańsza szeregowa część pełnego uruchomienia: rzeczywiste ścieżki per katalog, czytanie jedną partią, workery startowane przed czytaniem, dwie partie na workera ([#281](https://github.com/SirCypkowskyy/inwards/issues/281)), zrobione | Zmierzone przy czterech wątkach ([wyżej](#the-serial-part-of-a-full-run)): saleor 1,09 → 0,87 s, od 1,8 do 2,0× szybciej niż jeden wątek przed #61. Bez zmian na Linuksie z czterema rdzeniami | Zimne pełne uruchomienie |
| :material-check-circle: Pamięć podręczna list importów po hashu zawartości (`.inwards/cache`, [#56](https://github.com/SirCypkowskyy/inwards/issues/56)), zrobione dla `inwards check` i `inwards baseline` | Zmierzone: ciepłe pełne sprawdzenie 3,0 raza szybsze (0,46 s wobec 1,25 s p50, po 12 uruchomień na tym laptopie pod obciążeniem), o 27% wolniejsze, gdy pamięć podręczna się wypełnia. Hooki z niej nie korzystają ([ADR-031](05-ADR.md#adr-031-a-content-keyed-extraction-cache-that-the-hooks-never-read)) | Ciepłe pełne uruchomienie |
| :material-check-circle: Przejście kursorem po drzewie zamiast `descendantsOfType` na ścieżce pełnego parsowania ([#62](https://github.com/SirCypkowskyy/inwards/issues/62)), zrobione | Zmierzone na 2100 syntetycznych plikach, na zimno, po 10 naprzemiennych uruchomień: o 13% szybciej, gdy każdy plik wymaga potwierdzenia (3,34 → 2,90 s p50), o 10% szybciej, gdy prescan odrzuca każdy plik (3,13 → 2,80 s). Odczyt importów i komentarzy wyciszających z 1059 plików biblioteki standardowej spadł z około 560 ms do 125 ms. Hook dla jednego pliku i czyste pełne sprawdzenie się nie zmieniają | Odrzucone pliki i potwierdzenia |

### Odtworzenie { #reproduce }

```sh
bun install
bun test                                                    # 2,500+ tests: unit, CLI, hook, Stop gate, baseline, stats, E2E snapshots, doc snippets, bench
bun run scripts/build-binaries.ts bun-linux-x64
python3 bench/generate.py /tmp/inwards-bench
(cd /tmp/inwards-bench && "$OLDPWD/dist/inwards-linux-x64" check)  # 2100 files, 0 violations, ms
bun run src/core/scripts/prescan-diff.ts "$(python3 -c 'import sysconfig; print(sysconfig.get_paths()["stdlib"])')"
bun run bench/corpus.ts --bin dist/inwards-linux-x64 --dir ~/.cache/inwards-corpus  # real-repo corpus, about 90 s
```

`bench/corpus.ts` ponownie używa checkoutu, który jest już na przypiętym commicie, więc kolejne uruchomienia niczego nie pobierają. Żeby dodać repozytorium, dopisz je do `bench/corpus.json` z pełnym SHA commitu, liczbą plików `.py` i podziałem na warstwy; PR uruchomi workflow korpusu.

<figure markdown="span">
  ![wyjście bun test](../assets/screens/bun-test.svg){ loading=lazy }
  <figcaption>Testy jednostkowe silnika, w tym przypadki prescanu i kolorowego wyjścia.</figcaption>
</figure>

Dwa sprawdzenia pilnują, żeby testy dotyczące agentów były wiarygodne. Blok kodu w `docs/chapters/guides` albo `docs/chapters/rules`, który następuje po linii `<!-- e2e -->` i jednej pustej linii (bez niej komentarz psuje element listy), uruchamia się jako przypadek E2E w świeżym projekcie, w CI na skompilowanym pliku binarnym (`src/cli/test/integration/docs.test.ts`); nieoznaczone bloki nigdy się nie uruchamiają. Bloki działają w systemowym bashu, który na macOS jest w wersji 3.2, więc test nigdy nie umieszcza heredoca wewnątrz `$(...)`: bash 3.2 dopasowuje przez niego cudzysłowy i jeden apostrof w udokumentowanym komunikacie psuje skrypt. Co noc `.github/workflows/nightly-e2e.yml` nagrywa ponownie dane wejściowe hooków Claude Code w nieinteraktywnej sesji (headless) `claude -p` i otwiera zgłoszenie, gdy jakieś pole zostanie dodane, usunięte albo zmieni typ względem nagranych fixture'ów.

Zrzuty ekranu w tej dokumentacji pochodzą ze `scripts/screenshots.py`, który naprawdę uruchamia każde polecenie i renderuje wyjście terminala za pomocą Rich.

## Ryzyka { #risks }

| Ryzyko | Prawdopodobieństwo | Wpływ | Środki zaradcze |
|---|:-:|:-:|---|
| Astral dodaje kontrakty warstw do ty albo Ruffa | Średnie | Wysoki | Konkurować integracją z agentami i jakością poprawek, na których Astral się nie skupia. Utrzymywać format reguł na tyle prosty, żeby dało się go wyeksportować |
| import-linter dodaje wyjście JSON i hooki dla agentów | Średnie | Średni | Utrzymać przewagę w opóźnieniu, samodzielnym pliku binarnym i poprawkach dla każdego naruszenia. Utrzymać przejście na jedno polecenie: `inwards import-config` przenosi kontrakty import-linter ([przewodnik](guides/import-linter.md)) |
| Prawdziwe repozytoria przekraczają 100 ms p95 | Wydarzyło się: plik z polara z 4482 liniami i naruszeniami trwał 125 do 280 ms przed kompilacją do bajtkodu, a jego jednorazowy hook lokalnie około 104 ms p95 po niej. Teraz 88 ms jednorazowo i 32 ms przez daemona ([#122](https://github.com/SirCypkowskyy/inwards/issues/122)) | Wysoki | `inwards daemon` ([ADR-039](05-ADR.md#adr-039-a-hook-daemon-per-project-separate-from-the-language-server)) i przyrostowe drugie parsowanie, oba zrobione; zadanie benchmarku mierzy plik tej wielkości w każdym PR. Potem prescan w WASM napisany w Ruście albo Zigu (plan awaryjny z ADR-001) |
| Prescan pomija import w jakimś nietypowym pliku | Niskie | Wysoki | Test różnicowy w CI na bibliotece standardowej, co noc na pięciu prawdziwych serwisach; poszerzać ten korpus o repozytoria design partnerów |
| Agenci edytują `[tool.inwards]`, żeby przejść sprawdzenie | Wysokie bez zabezpieczenia | Wysoki | Config guard w PreToolUse, porównanie konfiguracji w Stop gate, reguły `permissions.deny` z `init`, CODEOWNERS ([rozdział 4](04-AI-Integration.md#stopping-the-agent-from-gaming-the-check)). Bash wciąż może ominąć config guard; odtworzony start sesji wykrywa kopia zapisu startu poza projektem, chyba że agent usunie też ją, a hook Stop usunięty przez Bash jest zgłaszany dopiero przy starcie następnej sesji ([#88](https://github.com/SirCypkowskyy/inwards/issues/88)) |
| Regresje albo niekompatybilne zmiany w `--compile` Buna | Niskie | Średni | Wersja przypięta przez `.bun-version`; macierz weryfikacji w CD uruchamia każdy plik binarny |
| Plik binarny po cichu ignoruje swój bajtkod (Bun wraca do parsowania źródła) i start wydłuża się dwukrotnie | Niskie | Niski | Testy w takim przypadku nadal przechodzą; benchmark w PR wyłapuje to tylko na Linuksie. Bajtkod jest związany z wersją Buna, która go zbudowała, a każdy plik binarny osadza tę samą wersję |
| Część CI działająca na infrastrukturze self-hosted jest niedostępna, a zadania PR, które tam trafiają, czekają w kolejce | Średnie | Średni | Dla oszczędności limitów i kosztów GitHub Actions część automatycznych zadań CI działa na infrastrukturze self-hosted; gdy jest niedostępna, te zadania mogą działać na runnerach GitHuba |
| Zensical (0.0.x) zmienia format konfiguracji | Średnie | Niski | Build dokumentacji działa w CI przy każdym PR; konfiguracja jest mała |
| Kroki naprawy są błędne dla nietypowych układów (brak oczywistego miejsca na port) | Średnie | Średni | Mierzyć naprawę w ramach jednej ponownej próby dla każdej reguły; pozwolić konfiguracji wskazać moduł portów |
