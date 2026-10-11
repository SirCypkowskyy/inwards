---
source: docs/chapters/rules/fastapi/index.md
source_hash: cb0dfad5b1579927c6eba63853dc095c5c92f5e0f52e919ffb2647d79eaa7841
---

# FastAPI { #fastapi }

Rodzina `FAPI` sprawdza aplikacje FastAPI między plikami: który router aplikacja dołącza, jakie kody błędów deklaruje schemat OpenAPI ([ADR-037](../../05-ADR.md#adr-037-framework-rule-families-opt-in-with-their-own-prefix)). Każda reguła FAPI jest opt-in i żadna nie zgłasza tego, co już zgłaszają reguły `FAST` Ruffa. W nowym projekcie [`inwards init --style fastapi`](../../guides/install.md#a-new-project-start-from-a-preset) włącza je wszystkie jako ostrzeżenia.

<div class="inw-rule-category" markdown>

| Kod | Nazwa | Co zgłasza | Włączona |
|---|---|---|---|
| [FAPI001](../FAPI001.md) | `endpoint-metadata` | Operacja ścieżki bez metadanych OpenAPI, których wymaga projekt (podsumowanie, model odpowiedzi, kod statusu) | opt-in |
| [FAPI002](../FAPI002.md) | `undocumented-error-response` | Operacja ścieżki, która może zwrócić kod błędu (rzucony bezpośrednio, w funkcji pomocniczej albo zależności, albo przez handler wyjątków aplikacji) niezadeklarowany w `responses=` | opt-in |
| [FAPI003](../FAPI003.md) | `router-wiring` | `APIRouter` z trasami, którego nie dołącza żadna aplikacja, routery dołączające się nawzajem w cyklu albo `include_router` nad trasami dołączanego routera | opt-in |
| [FAPI005](../FAPI005.md) | `route-shadowing` | Operacja ścieżki, na którą wcześniejsza z tą samą metodą już odpowiada: `/users/{id}` nad `/users/me` albo ta sama metoda i ścieżka dwa razy | opt-in |
| [FAPI006](../FAPI006.md) | `lifespan-events` | Przestarzały handler `on_event` albo `on_startup=` (ostrzeżenie) oraz taki obok `lifespan=`, przez który FastAPI go pomija (błąd) | opt-in |
| [FAPI007](../FAPI007.md) | `yield-dependency-swallows` | Zależność z `yield`, której klauzula `except` wokół niego nie rzuca wyjątku ponownie, więc błąd endpointu jest ukryty | opt-in |
| [FAPI008](../FAPI008.md) | `duplicate-operation-id` | Dwie operacje ścieżki jednej aplikacji z tym samym literalnym `operation_id` | opt-in |
| [FAPI009](../FAPI009.md) | `depends-called` | `Depends(get_db())`: zależność jest wywoływana przy imporcie zamiast zostać przekazana | opt-in |

</div>

[Lista reguł](../index.md) zbiera reguły wszystkich kategorii w jednym miejscu; można ją przeszukiwać, filtrować i sortować.
