---
source: docs/chapters/08-Run-Log.md
source_hash: d50ea709e8a396af008b63ae8662dbdcc1fe1847a290fc602126e3f8d100a3d1
---

# Run log { #run-log }

Run log pozwala design partnerom mierzyć [hipotezę biznesową](02-Business-Context.md#business-hypothesis) na ich własnych sesjach. Jest lokalny, domyślnie wyłączony, a Inwards nigdy go nigdzie nie wysyła.

## Włączanie { #turning-it-on }

Każde z tych ustawień go włącza:

- `run-log = true` w głównym `[tool.inwards]`;
- `INWARDS_RUN_LOG=1` w środowisku, w którym działają hooki.

`INWARDS_RUN_LOG=0` wyłącza go nawet wtedy, gdy konfiguracja mówi `run-log = true`. Tak czy inaczej, w projekcie, który nie używa Inwards (bez `[tool.inwards]` w katalogu głównym i bez stanu sesji), nic nie jest zapisywane, więc ustawienie na poziomie całego użytkownika nie dotyka innych projektów. `inwards check --log` zapisuje to jedno uruchomienie nawet przy wyłączonym logu; w ten sposób zapisywane są uruchomienia `lint-cmd` z Aidera (dodaj `--log` do polecenia, które wypisuje `init`).

Linie trafiają do `.inwards/runs.jsonl`, który `inwards init` wyłącza z gita dla każdego agenta. Plik może czytać tylko ty. `inwards check` zapisuje log obok konfiguracji, której używa, więc w monorepo sprawdzenie uruchomione wewnątrz pakietu zapisuje do `.inwards/` tego pakietu. Po osiągnięciu 5 MiB plik przenosi się do `.inwards/runs.1.jsonl`, zastępując poprzedni, i zaczyna się nowy plik. Dwa uruchomienia, które rotują log w tej samej chwili, mogą zgubić ten starszy plik; szansa jest mała, a nic więcej nie ginie.

## Schemat linii `inwards/run@1` { #line-schema-inwardsrun1 }

Każda linia to jeden obiekt JSON:

| Pole | Typ | Znaczenie |
|---|---|---|
| `v` | number | Wersja schematu, `1`. Pola są tylko dodawane; zmiana znaczenia podnosi `v` |
| `at` | string | Czas zakończenia uruchomienia w ISO 8601 |
| `session_id` | string albo null | Identyfikator sesji Claude Code; null dla `inwards check` |
| `event` | string | `SessionStart`, `PreToolUse`, `PostToolUse`, `Stop` albo `check` |
| `tool` | string albo null | Narzędzie zdarzenia narzędziowego, np. `Edit` |
| `files` | string[] | Pliki sprawdzone w uruchomieniu, ze ścieżkami względnymi wobec projektu. Dla `check` jego argumenty ścieżek albo `"."` dla całego projektu |
| `lines` | object[] | Tylko `PostToolUse`, dla pliku sprawdzonego przez hook: `{ "file", "added", "removed" }`, liczone z wywołania narzędzia bez linii, które edycja powtarza bez zmian wokół swojej zmiany. `Write` liczy każdą linię jako dodaną; `replace_all` liczy jedno wystąpienie |
| `fingerprints` | string[] | Po jednym na każde zgłoszone naruszenie (zahashowane: kod reguły, moduł i komunikat), tak samo jak w stanie sesji. Dwa identyczne importy w jednym pliku dają ten sam fingerprint dwa razy |
| `codes` | string[] | Kod reguły każdego fingerprintu, w tej samej kolejności (np. `INW001`). Linie zapisane, zanim to pole powstało, go nie mają |
| `severities` | string[] | `error` albo `warning` dla każdego fingerprintu, w tej samej kolejności, tak jak ustawiła je `[tool.inwards.rules]`. Linie zapisane, zanim to pole powstało, go nie mają i są czytane jako błędy |
| `exit` | number | Kod wyjścia zwrócony przez Inwards |
| `durationMs` | number | Czas od startu procesu, łącznie ze startem procesu, z dokładnością do 0,1 ms |

```json title=".inwards/runs.jsonl (jedna linia, zawinięta)"
{"v":1,"at":"2026-09-25T20:14:03.512Z","session_id":"7a425a88-...","event":"PostToolUse",
 "tool":"Edit","files":["shop/domain/order.py"],
 "lines":[{"file":"shop/domain/order.py","added":2,"removed":1}],
 "fingerprints":["4c1f0e9a2b7d3e10"],"codes":["INW001"],"severities":["error"],
 "exit":2,"durationMs":24.8}
```

## Odczyt { #reading-it }

`inwards stats [DIR]` czyta każdy `.inwards/runs.1.jsonl` i `.inwards/runs.jsonl` w projekcie: ten w katalogu głównym, do którego piszą hooki, i ten obok każdej konfiguracji, do którego pisze `inwards check --log`. Scala je w kolejności czasowej i wypisuje trzy liczby, każdą obok jej [progu z rozdziału 2](02-Business-Context.md#business-hypothesis). Projekt to DIR, a jeśli go nie podano, to `CLAUDE_PROJECT_DIR`, potem drzewo robocze gita, w którym jesteś, potem najbliższy katalog powyżej ze stanem hooków w `.inwards/state`, a na końcu najbardziej zewnętrzny katalog z run logiem, przy czym wyszukiwanie zatrzymuje się poniżej twojego katalogu domowego. `--config` nie ma tu zastosowania: `stats` zawsze czyta cały projekt. `--format json` wypisuje te same liczby jako `inwards/stats@1`, z werdyktem `met` dla każdej. Nic nie opuszcza maszyny. Żeby udostępnić sam log, `inwards stats --export FILE --redact` zapisuje każdą linię logów projektu, w kolejności czasowej, do jednego pliku, z każdą ścieżką i każdym fingerprintem zastąpionym hashem z kluczem z `.inwards/export-key`; zobacz [przewodnik dla design partnerów](guides/design-partners.md#sharing).

```text title="inwards stats"
Run log: 2 sessions, 6 hook runs, 1 unreadable line skipped.

Fixed within one retry: 1 of 2 (50%). Target: at least 80%. Not met.
    INW001  1 of 1 (100%)
    INW011  0 of 1 (0%)
    unknown  0 of 0, 1 without a retry
    1 more had no later run for their file and weren't reported at Stop.
Violations per 1,000 agent-written lines: 60 (3 in 50 lines). Target: at least 1. Met.
Hook latency: p50 40 ms, p95 200 ms over 6 runs. Target: p50 under 100 ms. Met.
```

Co jest liczone:

- **Naprawione w ramach jednej ponownej próby (fixed within one retry):** naruszenie liczy się raz na sesję i plik, przy pierwszej linii `PostToolUse`, która je zgłasza, i tylko jeśli jest błędem: ostrzeżenia nie blokują agenta. Jest naprawione, gdy następna linia `PostToolUse` dla tego pliku nie zawiera już jego fingerprintu, więc musi zniknąć każda jego kopia. Gdy dla pliku nie ma późniejszego uruchomienia, późniejsza linia `Stop` z tej samej sesji, która wciąż je zgłasza, liczy się jako nienaprawione, więc agent, który się poddaje, nie wypada ze wskaźnika. Wszystko inne jest wymienione jako bez ponownej próby. Podział na reguły korzysta z `codes`; fingerprint, który nigdy nie został zapisany z kodem, liczy się pod `unknown`.
- **Naruszenia na 1000 linii napisanych przez agenta:** fingerprinty błędów po raz pierwszy zgłoszone w liniach `PostToolUse` sesji, raz na sesję i plik, tak jak we wskaźniku ponownych prób, podzielone przez sumę `added` w tych liniach. `.py` i jego `.pyi` dzielą moduł, więc naruszenie powtórzone w pliku zaślepki liczy się dwa razy, raz na plik.
- **Opóźnienie hooka:** p50 i p95 z `durationMs` w liniach `PostToolUse`, które sprawdziły plik, metodą najbliższej rangi. Edycje innych plików (Markdown, pliki spoza projektu) też uruchamiają hook, ale niczego nie sprawdzają, więc są pomijane.
- **Werdykty** porównują z progami dokładne proporcje, a nie zaokrąglone procenty.

Hook sprawdza cały plik, więc jego fingerprinty obejmują naruszenia, które były tam, zanim agent go dotknął. Oba wskaźniki pomijają dwa ich rodzaje:

- naruszenia, które linia `check` zgłosiła przed pierwszą edycją w sesji. Uruchom `inwards check --format json --log`, zanim poprosisz agenta o pierwszą zmianę; bez tego naruszenia, które już są w pliku, liczą się na konto agenta przy pierwszej edycji tego pliku;
- naruszenia, które miało ostatnie uruchomienie hooka na tym pliku w innej sesji, więc naruszenie pozostałe po wczorajszej sesji, sprzed `/clear` albo od innego agenta pracującego równocześnie nad tym samym plikiem nie jest liczone jako naruszenie tej sesji, dopóki któreś uruchomienie na tym pliku nie przestanie go zgłaszać. Jeśli potem wróci, należy już do tej sesji.

Adopcji hooków, czyli odsetka instalacji z hookiem agenta, nie ma w logu: jeden projekt nie widzi pozostałych. Partnerzy podają ją sami.
