---
source: docs/chapters/guides/libraries.md
source_hash: 8d972e214e67d2f86e443e57cb3e2fc588763c5ff1ab09132464b6cd3af0177a
---

# Biblioteki w warstwach { #libraries-per-layer }

Reguły warstw (INW001) patrzą tylko na twój własny kod, więc `from sqlalchemy.orm import Session` w domenie je przechodzi, choć wiąże domenę z bazą danych równie mocno jak `import shop.infrastructure.db`. INW005 `pure-domain` określa, jakie biblioteki może importować każda warstwa, i ma domyślne ustawienie, które trzyma frameworki i operacje wejścia-wyjścia z dala od najbardziej wewnętrznej warstwy.

## Co sprawdza { #what-it-checks }

Każdy import pliku w warstwie trafia do jednej z trzech kategorii:

- **własny kod**: należy do warstwy albo jest modułem twojego projektu (to samo sondowanie, którego używa INW006, więc twój własny pakiet `redis/` na najwyższym poziomie jest twój, a nie biblioteką). Zajmują się nim INW001 i INW006; INW005 nigdy go nie zgłasza.
- **biblioteka standardowa**: jej nazwa najwyższego poziomu jest na dołączonej liście, czyli `sys.stdlib_module_names` z CPythona 3.11–3.14 oraz moduły, które miały jeszcze starsze wersje.
- **biblioteka zewnętrzna**: wszystko inne.

Import jest sprawdzany, gdziekolwiek się znajduje: na najwyższym poziomie, wewnątrz funkcji, pod `if TYPE_CHECKING:` i w importach dynamicznych z dosłownym celem (`importlib.import_module("requests")`, `exec("import socket")`), tak jak sprawdzają je INW001 i INW011.

## Konfiguracja { #configure-it }

Trzy opcjonalne klucze warstwy, każdy z listą nazw importu: identyfikatorów Pythona z kropkami, takich jak `sqlalchemy` albo `http.client`. Wpis obejmuje moduł i wszystko pod nim: `sqlalchemy` obejmuje `sqlalchemy.orm.Session`, a `http.client` obejmuje `http.client.HTTPConnection`, ale nie `http.HTTPStatus`. Globy (`sqlalchemy.*`) i nazwy dystrybucji (`python-dateutil`, importowany jako `dateutil`) to błędy konfiguracji, bo do niczego by nie pasowały.

- `allow-libraries`: gdy jest ustawione, warstwa może importować tylko te biblioteki zewnętrzne. Biblioteka standardowa pozostaje dozwolona.
- `deny-libraries`: warstwa nie może importować tych modułów, łącznie z biblioteką standardową. W najbardziej wewnętrznej z dwóch lub więcej warstw zastępuje domyślną listę zakazów.
- `extend-deny-libraries`: dopisuje te moduły do listy zakazów warstwy, łącznie z biblioteką standardową. Lista, do której dopisuje, to `deny-libraries`, gdy warstwa je ustawia, w przeciwnym razie domyślna lista zakazów w najbardziej wewnętrznej z dwóch lub więcej warstw, a w przeciwnym razie pusta lista, więc w każdej innej warstwie działa jak `deny-libraries`. Powtórzone wpisy i wpisy, które już są na liście, niczego nie psują.

Gdy lista dozwolonych i lista zakazów wymieniają ten sam moduł, wygrywa dłuższy wpis (`deny-libraries = ["os"]` z `allow-libraries = ["os.path"]` pozwala tylko na `os.path`), a przy remisie wygrywa `allow`. Dlatego `allow-libraries = ["http"]` nie znosi dłuższego wpisu `http.client` z listy domyślnej; znosi go `allow-libraries = ["http.client"]`. Bez żadnego z tych trzech kluczy warstwa może importować dowolną bibliotekę, z wyjątkiem najbardziej wewnętrznej warstwy w konfiguracji z dwiema lub więcej warstwami, która dostaje opisaną niżej domyślną listę zakazów.

!!! warning "`deny-libraries` w najbardziej wewnętrznej warstwie zastępuje listę domyślną"
    Nie dopisuje się do niej. `deny-libraries = ["pydantic"]` w domenie zabrania `pydantic` i niczego więcej: SQLAlchemy, Requests i reszta listy domyślnej znowu są dozwolone. Żeby zabronić jeszcze jednej biblioteki i zachować listę domyślną, użyj `extend-deny-libraries = ["pydantic"]`, które przejmuje też wpisy dodane do listy domyślnej w późniejszych wersjach. `deny-libraries = []` wyłącza listę domyślną. Żeby dopuścić jeden wpis z listy domyślnej, dodaj go zamiast tego do `allow-libraries`, co zachowuje resztę. `allow-libraries` wygrywa z `extend-deny-libraries` według tej samej reguły najdłuższego wpisu.

<!-- e2e -->

```toml title="pyproject.toml"
[tool.inwards]
layers = [
  { name = "domain",         modules = ["shop.domain"], allow-libraries = ["attrs"], extend-deny-libraries = ["os"] },
  { name = "application",    modules = ["shop.application"], deny-libraries = ["sqlalchemy", "requests"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]
```

<!-- e2e -->

```sh
inwards check
```

Tutaj domena może używać `attrs` i biblioteki standardowej, z wyjątkiem domyślnej listy zakazów i `os`; aplikacja może używać każdej biblioteki poza SQLAlchemy i Requests; infrastruktura może używać wszystkiego. Wartość, która nie jest listą nazw modułów, albo nieznany klucz to błąd konfiguracji (kod wyjścia 2), a [config guard](../04-AI-Integration.md#stopping-the-agent-from-gaming-the-check) odrzuca edycję któregokolwiek z tych trzech kluczy przez agenta, tak jak resztę `[tool.inwards]`.

### Domyślna lista zakazów { #the-default-deny-list }

Frameworki i serwery: `django`, `fastapi`, `flask`, `litestar`, `starlette`, `celery`, `grpc`. Bazy danych i ORM-y: `sqlalchemy`, `sqlmodel`, `alembic`, `peewee`, `psycopg`, `psycopg2`, `asyncpg`, `pymysql`, `pymongo`, `redis`, `sqlite3`. Klienci sieciowi: `requests`, `httpx`, `aiohttp`, `urllib3`, `boto3`, `botocore`, `pika`. Operacje wejścia-wyjścia z biblioteki standardowej: `socket`, `subprocess`, `http.client`, `http.server`, `urllib.request`, `smtplib`, `ftplib`.

Czyste moduły biblioteki standardowej pozostają dozwolone: `dataclasses`, `typing`, `datetime`, `decimal`, `enum`, `urllib.parse`, `http.HTTPStatus`. Podobnie `os` i `pathlib`; dodaj je do `extend-deny-libraries`, jeśli twoja domena nie może też sięgać do systemu plików.

### Zakaz biblioteki dla części warstwy { #prefix-deny }

Trzy klucze dotyczą całej warstwy. Żeby trzymać bibliotekę z dala od jednego pakietu w warstwie albo od pakietu, który nie należy do żadnej warstwy, wpisz ją w `deny` w tabeli opcji INW005:

```toml title="pyproject.toml"
[tool.inwards]
layers = [{ name = "mypackage", modules = ["mypackage"] }]

[tool.inwards.rules.pure-domain]
deny = [
  { modules = ["mypackage.one"], libraries = ["django"] },
  { modules = ["mypackage.*.jobs"], libraries = ["celery", "http.client"] },
]
```

`mypackage.one.views` nie może importować `django`, a `mypackage.two` nadal może. `modules` przyjmuje prefiksy i selektory jak `modules` warstwy; `libraries` przyjmuje nazwy importu jak `deny-libraries`, także z biblioteki standardowej. Wpis działa niezależnie od tego, czy moduł należy do warstwy, a `allow-libraries` warstwy go nie znosi: to węższa reguła. Gdy import zakazują też listy samej warstwy, zgłaszany jest raz, z komunikatem warstwy, więc dodanie wpisu nie zmienia istniejących kluczy baseline'u. `inwards import-config` zapisuje tę tabelę dla kontraktu `forbidden` import-lintera, którego `source_modules` nie są całymi warstwami.

## Co widzi agent { #what-the-agent-sees }

Komunikat podaje warstwę, import i pakiet najwyższego poziomu biblioteki, nigdy listy, więc wpis w [baseline'ie](install.md#on-an-existing-codebase) przetrwa ich zmianę. Poprawka podaje wpis, który zabronił importu, niezależnie od listy, z której pochodzi (`http.client` dla `from http.client import HTTPConnection`; pakiet najwyższego poziomu, gdy import jest spoza `allow-libraries`), port do wprowadzenia i każdą warstwę zewnętrzną, której wolno używać tej biblioteki. Agent wybiera tę, która zawiera adaptery: w układzie heksagonalnym nie zawsze jest to następna warstwa na zewnątrz.

```text
shop/domain/order.py:3:28: INW005 Layer "domain" imports "sqlalchemy.orm.Session" from library "sqlalchemy", which "domain" may not use.
  fix: Use "sqlalchemy" in an outer layer, behind a port owned by "domain".
    1. Delete `from sqlalchemy.orm import Session`. Do not move the import into a function, behind TYPE_CHECKING or into importlib; Inwards checks those too.
    2. Declare a typing.Protocol in `shop.domain` (for example `shop.domain.ports`) that describes only what this module needs from "sqlalchemy".
    3. Type this module against that Protocol and receive the implementation through a constructor or function parameter.
    4. Implement the Protocol with "sqlalchemy" in the outer layer that holds adapters (allowed: "infrastructure"), and wire it in the outermost layer (the composition root).
    5. If "domain" should be allowed to use "sqlalchemy", ask the user to add "sqlalchemy" to that layer's allow-libraries in [tool.inwards]. Don't edit [tool.inwards] yourself.
```

Gdy biblioteki nie może używać także żadna warstwa zewnętrzna, poprawka zachowuje kroki 1 i 5 i każe agentowi zapytać użytkownika, gdzie ta biblioteka powinna się znaleźć.

Import zakazany przez [wpis `deny`](#prefix-deny) podaje moduł i prefiks, do którego pasował wpis, a jego poprawka umieszcza port w tym prefiksie, a implementację poza nim:

```text
mypackage/one/views.py:1:8: INW005 Module "mypackage.one.views" imports "django.db" from library "django", which [tool.inwards.rules.pure-domain] denies to "mypackage.one".
  fix: "mypackage.one" may not use "django" ([tool.inwards.rules.pure-domain].deny): use it outside "mypackage.one", behind a port "mypackage.one" owns.
```

## Czego jeszcze nie obejmuje { #not-covered-yet }

Nazwy dystrybucji, które różnią się od nazwy importu (`PyYAML` to `yaml`), nie są mapowane: podawaj nazwę importu. Lista biblioteki standardowej jest ustalana w czasie budowania, więc moduł dodany w późniejszym CPythonie liczy się jako biblioteka zewnętrzna, dopóki Inwards nie zaktualizuje listy.
