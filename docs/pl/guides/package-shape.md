---
source: docs/chapters/guides/package-shape.md
source_hash: 51337e08055254b7541c20b1298f95a97a89fffad102a0a4f9922f4e401d855c
---

# Kształt pakietu { #package-shape }

Reguły warstw (INW001) patrzą na importy. Nie widzą, gdzie kod *leży*: nowy `helpers.py` obok `service.py`, pakiet `services/` obok `service.py` albo `test_orders.py` wewnątrz aplikacji przechodzą je bez problemu. Kształt pakietu zamyka tę lukę. Mówisz, jakie elementy pakiet może, musi i nie może zawierać, a Inwards sprawdza to przy każdej edycji (hook), w edytorze (serwer języka) i w CI (`inwards check`).

| Reguła | Zgłasza | Gdzie |
|---|---|---|
| INW007 `package-shape` | element, na który kształt nie pozwala (`extra`, domyślnie błąd) albo którego zabrania; nazwę poza jej pakietami `only-in`; selektor kształtu, który nie pasuje do żadnego pakietu (ostrzeżenie) | w pliku, w linii 1; martwy selektor w `pyproject.toml` |
| INW008 `missing-member` | brakuje elementu, którego wymaga kształt | w `__init__.py` pakietu albo w jego pierwszym pliku, jeśli `__init__.py` nie ma |

## Konfiguracja { #configure-it }

<!-- config: fragment -->

```toml title="pyproject.toml"
[[tool.inwards.shape]]
packages = ["app.*"]                  # which packages: selectors, see below
allow = ["router", "schemas", "utils"] # what else they may hold
require = ["__init__", "router", "service"]
forbid = ["conftest"]
extra = "error"                       # or "warning" for members allow doesn't cover

[[tool.inwards.names]]
pattern = "test_*"
only-in = ["tests", "tests.**"]
```

- **Selektory** (`packages`, `only-in`) dopasowują pakiety, w [gramatyce import-lintera](../05-ADR.md#adr-018-package-selectors-take-globs-from-the-start-monorepos-follow-uv-workspaces): `a.b` to dokładne dopasowanie, `a.*` to jeden segment poniżej `a`, a `a.**` to dowolna głębokość poniżej `a` (bez samego `a`). Nową domenę, taką jak `app/payments/`, `app.*` obejmuje w chwili, gdy powstaje.
- **Wygrywa pierwszy pasujący wpis.** Dokładne wpisy umieszczaj przed globami, które też by do nich pasowały. Wpis, którego selektor jest już pokryty przez wcześniejszy, nigdy nie mógłby zadziałać, więc jest błędem konfiguracji: `app.orders` po `app.*`, powtórzony selektor albo `app.*` po `app.**`. Glob, który tylko częściowo pokrywa się z wcześniejszym (`app.**` po `app.*`), jest w porządku. Segmenty selektora to identyfikatory Pythona, `*` albo `**`.
- **Wzorce elementów** to globy fnmatch (`*`, `?`, `[seq]`, `[!seq]`), dopasowywane tak jak w Pythonowym `fnmatch.fnmatchcase`: wewnątrz `[...]` znaki `*` i `?` są dosłowne. Niezamknięty `[` albo odwrócony zakres, taki jak `[z-a]`, to błąd konfiguracji. `name` to moduł albo podpakiet, `name/` tylko podpakiet, `name.py` tylko moduł (zaślepki `.pyi` liczą się jako moduły). `__init__` jest zawsze dozwolony, podobnie jak wszystko z `require`. Bez `allow` każdy element jest dozwolony i działają tylko `require` oraz `forbid`.
- **Kształt obejmuje bezpośrednie elementy pakietu.** `app/orders/services/x.py` jest elementem `services/` pakietu `app.orders`; pliki wewnątrz `services/` podlegają kształtowi dla `app.orders.services`, jeśli taki istnieje. Elementy są nazywane według systemu plików: `utils.helpers.py` to jeden element-moduł, a nie `utils/`, więc nie pasuje ani do `utils`, ani do `helpers`. Ukryte pliki i katalogi są pomijane, tak jak pomija je każde przeglądanie plików w Inwards.
- **Reguły nazw** działają na każdym poziomie: element pasujący do `pattern` w dowolnym miejscu poza pakietami `only-in` to błąd INW007.

Nieznane klucze, źle zbudowane selektory albo wzorce oraz przesłonięte wpisy to błędy konfiguracji (kod wyjścia 2). [Config guard](../04-AI-Integration.md) traktuje `shape` i `names` tak jak resztę `[tool.inwards]`: edycja ich przez agenta jest odrzucana.

## Co widzi agent { #what-the-agent-sees }

Komunikat podaje element i pakiet, nigdy listę dozwolonych elementów, więc wpis w baseline'ie przetrwa zmianę `allow`. Kroki naprawy wypisują dozwolone elementy i wskazują ten, do którego kod najpewniej należy, znaleziony przez wbudowane synonimy (`helpers` → `utils`, `services` → `service`, `test_*` → `tests`), dopasowanie końcówki (`order_service` → `service`) albo małą odległość edycyjną (`rooter` → `router`; 2 edycje dla nazw od 6 znaków, 1 dla nazw od 3 do 5, zero poniżej, więc `db.py` nie jest odsyłany do `di.py`):

```text
app/orders/helpers.py:1:1: INW007 "helpers.py" is not an allowed member of package "app.orders".
  fix: Move the code in "helpers.py" into utils.py.
    1. Move the code into app/orders/utils.py and delete helpers.py.
    2. Package "app.orders" may hold: router, schemas, models, service, dependencies, config, constants, exceptions, utils.
```

- **Przy każdej edycji (PostToolUse).** INW007 blokuje (kod wyjścia 2), gdy edytowany plik jest nowy w tej sesji. Dla pliku, który istniał już na początku sesji, wraca tylko jako kontekst, więc stary układ nigdy nie blokuje niezwiązanej edycji. INW008 dla edytowanego pakietu jest zawsze kontekstem: agent, który tworzy `app/payments/router.py`, słyszy, że wciąż brakuje `service.py`, i może go dodać w następnym kroku.
- **Stop gate.** Wyniki INW008, które są nowe od początku sesji, blokują turę, więc usunięcie wymaganego `service.py` przez Bash zostaje wyłapane. Pakiet, któremu tego pliku brakowało już na początku sesji, nie blokuje. INW007 w plikach starszych niż sesja też nie blokuje.
- **Edytor.** Serwer języka zgłasza INW007 w każdym otwartym pliku na bieżąco, podczas pisania. Przebieg po całym obszarze roboczym na podstawie listy katalogów (nic nie jest czytane ani parsowane) wysyła INW007 do plików, których nie otworzyłeś, i INW008 do `__init__.py` pakietu. Podąża za dowiązaniami symbolicznymi, które nie wychodzą poza katalog główny konfiguracji, tak jak `inwards check`, i uruchamia się ponownie, raz na serię zdarzeń, gdy powstaje albo znika plik Pythona.
- **CI.** Sprawdzenie całego projektu przez `inwards check` zgłasza INW007 w każdym pliku, INW008 dla każdego pakietu z kształtem i ostrzeżenie dla selektora, który nie pasuje do żadnego pakietu.

## Przykład: fastapi-best-practices { #example-fastapi-best-practices }

Układ [fastapi-best-practices](https://github.com/zhanymkanov/fastapi-best-practices) daje każdej domenie te same moduły: router, schemas, models, service, dependencies, config, constants, exceptions i utils. Przewodnik nazywa swój główny pakiet `src`; tutaj nazywa się `app`. Testy leżą w osobnym pakiecie `tests/` na najwyższym poziomie.

```toml title="pyproject.toml"
[tool.inwards]
ignore = ["tests"]
layers = [{ name = "app", modules = ["app"] }]

# An integration package: a client, no routes. Exact entries come before the
# glob that would also match them.
[[tool.inwards.shape]]
packages = ["app.aws"]
allow = ["client", "schemas", "config", "constants", "exceptions", "utils"]
require = ["__init__", "client"]

# Every domain package, including the ones added later.
[[tool.inwards.shape]]
packages = ["app.*"]
allow = [
  "router", "schemas", "models", "service", "dependencies",
  "config", "constants", "exceptions", "utils",
]
require = ["__init__", "router", "service"]

# Tests live under tests/, never next to the code.
[[tool.inwards.names]]
pattern = "test_*"
only-in = ["tests", "tests.**"]
```

## Przykład: czysta architektura { #example-clean-architecture }

[Drzewo czystej architektury](https://rothl.com/blog/clean-architecture-python-guide) dzieli kod na domenę (`model/`), aplikację (`ports/` i `use_cases/`) oraz infrastrukturę (`adapters/` i korzeń kompozycji `di.py`). Każdy pakiet warstwy dostaje dokładny kształt; puste `allow` oznacza tylko wymagane elementy i `__init__`.

```toml title="pyproject.toml"
[tool.inwards]
ignore = ["tests"]
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "application", modules = ["shop.application"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
  { name = "main", modules = ["shop.main"] },
]

[[tool.inwards.shape]]
packages = ["shop"]
allow = ["domain/", "application/", "infrastructure/", "main.py"]

[[tool.inwards.shape]]
packages = ["shop.domain"]
require = ["__init__", "model/"]
allow = []

[[tool.inwards.shape]]
packages = ["shop.application"]
require = ["__init__", "ports/", "use_cases/"]
allow = []

# The composition root must exist, and only adapters sit beside it.
[[tool.inwards.shape]]
packages = ["shop.infrastructure"]
require = ["__init__", "adapters/", "di.py"]
allow = []

[[tool.inwards.names]]
pattern = "test_*"
only-in = ["tests", "tests.**"]
```

Obie konfiguracje są fixture'ami testów (`src/cli/test/support/fixtures/shapes/`): każda przechodzi `inwards check` z zerową liczbą wyników, a testy podkładają `helpers.py`, `services/x.py` i `test_x.py`, żeby sprawdzić, że każdy z nich oblewa sprawdzenie z krokami naprawy pokazanymi wyżej.

## Szablony { #templates }

Gdy każda domena ma ten sam kształt, tę samą kolejność importów między swoimi modułami i te same moduły publiczne, [szablon](configuration.md#templates) mówi to raz: `template = "<nazwa>"` we wpisie kształtu dostarcza `allow`, `require`, `forbid`, `extra` i `hints`, a ten sam szablon może się rozwinąć w warstwy dla ról i w listę `public` kontekstu każdej domeny. `hints` dodaje wskazówki projektu do kroków naprawy INW007. Dokumentacja konfiguracji pokazuje fastapi-best-practices jako jeden szablon.

## Kształty z presetu { #shapes-from-a-preset }

`inwards init --style NAME --scaffold` zapisuje kształty dopasowane do przykładowego pakietu. W `layered`, `clean`, `hexagonal` i `vertical-slices` sam pakiet zawiera tylko swoje pakiety warstw, `bootstrap.py`, `__main__.py` i `_version.py` (który zapisują hatch-vcs i setuptools-scm), a `adapters/` w `hexagonal` zawiera tylko `inbound/` i `outbound/`; każdy inny element jest tam błędem, bo nie należałby do żadnej warstwy. W `clean` i `hexagonal` `application/` musi zawierać `ports/` i `use_cases/`, a każdy inny element jest tam ostrzeżeniem. Pakiety warstw nie mają kształtu, więc rosną swobodnie. [Instalacja](install.md#a-new-project-start-from-a-preset) wymienia presety; `inwards init --list-styles` wypisuje ich kształty.

Presety z kontekstami nadają kształt także swoim pakietom kontekstów, przez selektor `*`, więc nowy pakiet jest objęty od chwili, gdy powstanie:

| Preset | Pakiet | Kształt |
|---|---|---|
| `vertical-slices` | `app.features` | tylko pakiety wycinków (`allow = ["*/"]`) |
| `vertical-slices` | `app.features.*` | wymaga `api`; dopuszcza każdy inny element |
| `bounded-contexts` | `app` | pakiety kontekstów, `bootstrap.py`, `__main__.py`, `_version.py` |
| `bounded-contexts` | `app.*` | wymaga `domain/`, `application/`, `infrastructure/`, `api`; wszystko inne jest ostrzeżeniem |
| `django` | `app` | wymaga `settings.py` i `urls.py`; dopuszcza aplikacje, `asgi.py`, `wsgi.py`, `__main__.py`, `_version.py` |
| `django` | `app.*` | wymaga `models`, `services`, `views`, `urls`; dopuszcza `admin`, `apps`, `migrations/`, `tests`; wszystko inne jest ostrzeżeniem |

## Czego jeszcze nie obejmuje { #not-covered-yet }

Kształt pakietu nie obejmuje jeszcze presetu `inwards init --style fastapi` ([#93](https://github.com/SirCypkowskyy/inwards/issues/93)), plików innych niż Python oraz tego, co plik zawiera.
