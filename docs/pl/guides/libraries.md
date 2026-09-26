---
source: docs/chapters/guides/libraries.md
source_hash: fc4133a97449bc716956c6ca6f45c2d1ea9f82e842793dcff5f85025eb1346b6
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

Dwa opcjonalne klucze warstwy, każdy z listą nazw importu: identyfikatorów Pythona z kropkami, takich jak `sqlalchemy` albo `http.client`. Wpis obejmuje moduł i wszystko pod nim: `sqlalchemy` obejmuje `sqlalchemy.orm.Session`, a `http.client` obejmuje `http.client.HTTPConnection`, ale nie `http.HTTPStatus`. Globy (`sqlalchemy.*`) i nazwy dystrybucji (`python-dateutil`, importowany jako `dateutil`) to błędy konfiguracji, bo do niczego by nie pasowały.

- `allow-libraries`: gdy jest ustawione, warstwa może importować tylko te biblioteki zewnętrzne. Biblioteka standardowa pozostaje dozwolona.
- `deny-libraries`: warstwa nie może importować tych modułów, łącznie z biblioteką standardową.

Gdy obie listy wymieniają ten sam moduł, wygrywa dłuższy wpis (`deny-libraries = ["os"]` z `allow-libraries = ["os.path"]` pozwala tylko na `os.path`), a przy remisie wygrywa `allow`. Dlatego `allow-libraries = ["http"]` nie znosi dłuższego wpisu `http.client` z listy domyślnej; znosi go `allow-libraries = ["http.client"]`. Bez żadnego z tych kluczy warstwa może importować dowolną bibliotekę, z wyjątkiem najbardziej wewnętrznej warstwy w konfiguracji z dwiema lub więcej warstwami, która dostaje opisaną niżej domyślną listę zakazów.

!!! warning "`deny-libraries` w najbardziej wewnętrznej warstwie zastępuje listę domyślną"
    Nie dopisuje się do niej. `deny-libraries = ["pydantic"]` w domenie zabrania `pydantic` i niczego więcej: SQLAlchemy, Requests i reszta listy domyślnej znowu są dozwolone. Skopiuj do listy wpisy domyślne, które chcesz zachować. `deny-libraries = []` wyłącza listę domyślną. Żeby dopuścić jeden wpis z listy domyślnej, dodaj go zamiast tego do `allow-libraries`, co zachowuje resztę.

<!-- e2e -->

```toml title="pyproject.toml"
[tool.inwards]
layers = [
  { name = "domain",         modules = ["shop.domain"], allow-libraries = ["attrs"] },
  { name = "application",    modules = ["shop.application"], deny-libraries = ["sqlalchemy", "requests"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]
```

<!-- e2e -->

```sh
inwards check
```

Tutaj domena może używać `attrs` i biblioteki standardowej, z wyjątkiem domyślnej listy zakazów; aplikacja może używać każdej biblioteki poza SQLAlchemy i Requests; infrastruktura może używać wszystkiego. Wartość, która nie jest listą nazw modułów, albo nieznany klucz to błąd konfiguracji (kod wyjścia 2), a [config guard](../04-AI-Integration.md#stopping-the-agent-from-gaming-the-check) odrzuca edycję któregokolwiek z tych kluczy przez agenta, tak jak resztę `[tool.inwards]`.

### Domyślna lista zakazów { #the-default-deny-list }

Frameworki i serwery: `django`, `fastapi`, `flask`, `litestar`, `starlette`, `celery`, `grpc`. Bazy danych i ORM-y: `sqlalchemy`, `sqlmodel`, `alembic`, `peewee`, `psycopg`, `psycopg2`, `asyncpg`, `pymysql`, `pymongo`, `redis`, `sqlite3`. Klienci sieciowi: `requests`, `httpx`, `aiohttp`, `urllib3`, `boto3`, `botocore`, `pika`. Operacje wejścia-wyjścia z biblioteki standardowej: `socket`, `subprocess`, `http.client`, `http.server`, `urllib.request`, `smtplib`, `ftplib`.

Czyste moduły biblioteki standardowej pozostają dozwolone: `dataclasses`, `typing`, `datetime`, `decimal`, `enum`, `urllib.parse`, `http.HTTPStatus`. Podobnie `os` i `pathlib`; dodaj je do `deny-libraries`, jeśli twoja domena nie może też sięgać do systemu plików, razem z wpisami domyślnymi, które chcesz zachować.

## Co widzi agent { #what-the-agent-sees }

Komunikat podaje warstwę, import i pakiet najwyższego poziomu biblioteki, nigdy listy, więc wpis w [baseline'ie](install.md#on-an-existing-codebase) przetrwa ich zmianę. Poprawka podaje wpis, który zabronił importu (`http.client` dla `from http.client import HTTPConnection`; pakiet najwyższego poziomu, gdy import jest spoza `allow-libraries`), port do wprowadzenia i każdą warstwę zewnętrzną, której wolno używać tej biblioteki. Agent wybiera tę, która zawiera adaptery: w układzie heksagonalnym nie zawsze jest to następna warstwa na zewnątrz.

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

## Czego jeszcze nie obejmuje { #not-covered-yet }

Nazwy dystrybucji, które różnią się od nazwy importu (`PyYAML` to `yaml`), nie są mapowane: podawaj nazwę importu. Nie ma klucza, który dopisuje wpisy do domyślnej listy zakazów zamiast ją zastępować. Lista biblioteki standardowej jest ustalana w czasie budowania, więc moduł dodany w późniejszym CPythonie liczy się jako biblioteka zewnętrzna, dopóki Inwards nie zaktualizuje listy.
