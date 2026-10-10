---
source: docs/chapters/rules/FAPI005.md
source_hash: 35a905e897e0b6ae0634ea5e50961bfa8c0ef7c04e2e8c52b7e2340f14ae326d
type: rule
title: FAPI005 route-shadowing
description: Żadna operacja ścieżki FastAPI nie jest przesłonięta przez wcześniejszą z tą samą metodą, więc każda trasa jest osiągalna.
code: FAPI005
name: route-shadowing
severity: error
suppressible: true
autofix: false
status: stable
tags: [fastapi]
resource: https://github.com/SirCypkowskyy/inwards/blob/develop/src/core/src/rules/fastapi/route-shadowing.ts
timestamp: 2026-10-09T12:00:00Z
related_issues: [186, 184, 224]
---

# FAPI005 `route-shadowing`

## Co robi { #what-it-does }

Opt-in. Zgłasza operację ścieżki, do której nic nie dotrze, bo wcześniejsza odpowiada na każde żądanie, na jakie odpowiedziałaby ona:

- **Przesłonięta:** `GET /users/{id}` jest zadeklarowane przed `GET /users/me`. Żądanie `/users/me` pasuje do pierwszej trasy, z `id` równym `"me"`, więc druga nigdy się nie wykona.
- **Powtórzona:** ta sama metoda i ścieżka zadeklarowane dwa razy. FastAPI zostawia obie w schemacie OpenAPI, ale odpowiada tylko pierwsza.

Zgłoszenie stoi na dekoratorze nieosiągalnej operacji i wskazuje wcześniejszą wraz z plikiem i linią. Porównuje pełne ścieżki między routerami, które dołącza aplikacja, z prefiksami z `APIRouter(prefix=...)` i `include_router(..., prefix=...)`.

## Dlaczego to źle { #why-is-this-bad }

FastAPI dopasowuje trasy w kolejności ich dodania, a wygrywa pierwsze dopasowanie, bez ostrzeżenia. Dokumentacja o tym mówi ("Order matters"). Agent, który dopisze `GET /users/me` pod `GET /users/{id}`, pisze handler, do którego nie trafi żadne żądanie, a test wołający funkcję handlera bezpośrednio przechodzi. Ruff sprawdza jeden plik naraz i nie ma na to reguły.

## Przykład { #example }

<!-- e2e -->

```toml title="pyproject.toml"
[tool.inwards]
layers = [{ name = "app", modules = ["app"] }]

[tool.inwards.rules]
extend-select = ["FAPI005"]
```

<!-- e2e -->

```python title="app/main.py"
from fastapi import FastAPI

from app import users

app = FastAPI()
app.include_router(users.router, prefix="/users")
```

<!-- e2e -->

```python title="app/users.py"
from fastapi import APIRouter

router = APIRouter(tags=["users"])


@router.get("/{user_id}")
async def get_user(user_id: str) -> dict[str, str]:
    return {"id": user_id}


@router.get("/me")
async def get_me() -> dict[str, str]:
    return {"id": "me"}
```

<!-- e2e -->

```sh
inwards check app
```

<!-- e2e -->

```text
app/users.py:11:1: FAPI005 `@router.get("/me")` (GET /users/me) can never be reached: `@router.get("/{user_id}")` (GET /users/{user_id}) at app/users.py:6 comes first and matches the same requests, so FastAPI always picks that one.
  fix: Declare the specific route before the one with the path parameter.
    1. Move `@router.get("/me")` (GET /users/me) above `@router.get("/{user_id}")` (GET /users/{user_id}), so the specific path is matched first.
    2. If they are on different routers, include the router with the specific route first: the order of the include_router calls decides.
    3. Don't delete either route to make this finding go away.
  docs: https://sircypkowskyy.github.io/inwards/rules/FAPI005/
```

Poprawione: ścieżka dosłowna idzie pierwsza.

<!-- e2e -->

```python title="app/users.py"
from fastapi import APIRouter

router = APIRouter(tags=["users"])


@router.get("/me")
async def get_me() -> dict[str, str]:
    return {"id": "me"}


@router.get("/{user_id}")
async def get_user(user_id: str) -> dict[str, str]:
    return {"id": user_id}
```

<!-- e2e -->

```sh
inwards check app
```

## Jak działa { #how-it-works }

FAPI005 czyta wspólny model FastAPI ([ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)) oraz graf aplikacji i routerów z [FAPI003](FAPI003.md). Dla każdej aplikacji i dla każdego routera, którego nie dołącza żadna znana aplikacja ani router, układa trasy w kolejności, w jakiej trzyma je FastAPI: dekoratory i wywołania `include_router` aplikacji lub routera w kolejności w źródle, z trasami dołączonego routera w miejscu dołączenia, i z pełną ścieżką każdej trasy złożoną z prefiksów po drodze.

Trasa jest zgłaszana, gdy dla każdej metody, którą obsługuje, wcześniejsza trasa obsługuje tę metodę i pasuje do każdej ścieżki, do której pasuje ona. Ścieżki porównują się segment po segmencie, tak jak dopasowuje je Starlette:

- `{id}` i `{id:str}` pasują do dowolnego niepustego segmentu: dosłownego albo parametru z dowolnym konwerterem poza `path`.
- `{id:int}` pasuje do segmentu z cyfr, więc obejmuje `/items/42` i `/items/{n:int}`, ale nie `/items/new`.
- `{rest:path}` na końcu ścieżki pasuje do wszystkiego, co po niej następuje.
- Nazwy parametrów nie mają znaczenia: `/u/{a}` i `/u/{b}` to ta sama ścieżka, a druga jest zgłaszana jako powtórzenie.
- Segment mieszający tekst z parametrem (`{name}.json`) obejmuje tylko identyczny segment.

Metody porównują się osobno: `@router.api_route("/a", methods=["GET", "POST"])` jest zgłaszane tylko wtedy, gdy nad nim obsługiwane są już i `GET`, i `POST`.

Gdzie działa:

- **`inwards check`**, `inwards baseline` i **Stop gate** zgłaszają oba rodzaje, w obrębie routera i między routerami, w plikach, które sprawdzają.
- **Hook PostToolUse** i edytor zgłaszają tylko to, co widać w jednym routerze w jednym pliku. Przesunięcie trasy w jednym pliku to edycja jednego pliku; podpięcie routerów do aplikacji to druga edycja, więc zgłoszenia między routerami czekają na Stop gate. Wyciszenie zgłoszenia między routerami nadal liczy się w hooku jako użyte.

## Jak naprawić { #how-to-fix }

1. Przesłonięta: przenieś konkretną trasę nad tę z parametrem. Poprawka wymienia obie. Gdy leżą na różnych routerach, dołącz najpierw router z konkretną trasą.
2. Powtórzona: zdecyduj, która z dwóch jest zamierzona, i nadaj drugiej własną ścieżkę lub metodę. Nie usuwaj pierwszej bez pytania: klienci trafiają do niej dziś.

## Bezpieczeństwo poprawki { #fix-safety }

Brak automatycznej poprawki (`autofix: false`). Która trasa jest zamierzona i czy powtórzenie to pozostałość, czy pomyłka, to decyzje autora.

## Konfiguracja { #configuration }

Waga: błąd. Opt-in: włącz przez `extend-select`. Nie ma własnych opcji; `modules` działa jak w każdej regule ([tabele opcji](index.md#opt-in-rules)).

Każde zgłoszenie stoi na dekoratorze i można je wyciszyć w kodzie przez `# inwards: ignore[FAPI005] reason="..."` w tej linii.

## Znane ograniczenia { #known-limitations }

Nieznane oznacza ciszę. Nic nie jest zgłaszane, gdy:

- ścieżka, lista `methods=` albo `prefix=` nie jest literałem tekstowym (zmienna, f-string, wywołanie) albo `**kwargs` może któreś ukrywać;
- router trzyma trasy w kilku plikach, bo ich kolejność jest nieznana;
- segment używa konwertera, którego Inwards nie zna, innego niż identyczny;
- inne dołączenie tego samego routera, pod prefiksem, którego Inwards nie czyta, albo w innej aplikacji, zostawia trasę osiągalną.

Dalsze ograniczenia:

- **`mount`** nie jest śledzony: zamontowana aplikacja routuje sama, po trasach aplikacji, na której jest zamontowana.
- **Trasy dodawane w czasie działania** (`app.add_api_route(...)`, `app.router.routes.insert(...)`) nie są widoczne, podobnie jak trasy `@router.websocket`.
- **Trasy warunkowe** (`if settings.DEBUG:`) liczą się jako obecne.
- **Trasa zapisana pod `include_router`, który dołącza jej router**, w tym samym pliku, nie trafia do aplikacji, bo FastAPI kopiuje trasy istniejące w chwili wywołania ([FAPI003](FAPI003.md) zgłasza to wywołanie). Jest pomijana w porównaniu.
- **Ukośniki końcowe**: `/users` i `/users/` to tu różne ścieżki, tak jak w dopasowaniu Starlette przed jego przekierowaniem.

## Źródła { #references }

- [ADR-037](../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix): rodzina FastAPI, opt-in, i wspólny model.
- Dokumentacja FastAPI, [Path Operation order](https://fastapi.tiangolo.com/tutorial/path-params/#order-matters): "Order matters".
