---
source: docs/chapters/guides/design-partners.md
source_hash: 8135d63304f4a43d2c5ead883f0507c3fb97f426f46d83920fcda6251834f644
---

# Design partnerzy { #design-partners }

Design partnerzy uruchamiają Inwards w prawdziwych projektach ze swoimi agentami AI i mówią nam, czy to działa: czy agenci naprawiają to, co zgłasza Inwards, czy wyłapuje prawdziwe naruszenia i czy nie wchodzi w drogę. Ta strona opisuje całą ścieżkę, od instalacji po udostępnienie liczb. Nic nie opuszcza twojej maszyny, chyba że sam to wyślesz.

## O co prosimy i co dostajesz { #what-we-ask-and-what-you-get }

- **Prosimy o** kilka tygodni zwykłej pracy z agentem, z włączonymi hookami i run logiem, a potem o wynik `inwards stats` albo spseudonimizowany log oraz krótkie zgłoszenie z opinią.
- **Dostajesz** sprawdzenie architektury, z którym twoi agenci nie mogą dyskutować, wpływ na to, które reguły powstaną jako następne, i bezpośredni kontakt z opiekunem projektu.

## Lista kroków na start { #onboarding-checklist }

1. **Zainstaluj** Inwards jako zależność deweloperską ([przewodnik instalacji](install.md)) i zapisz `[tool.inwards]` ze swoimi warstwami.
2. **Zaakceptuj to, co jest dziś:** `inwards baseline`, a potem zacommituj `inwards-baseline.json`. Istniejące naruszenia przestają oblewać sprawdzenie; nowe nadal je oblewają ([przewodnik instalacji](install.md#on-an-existing-codebase)).
3. **Podłącz swojego agenta:** `inwards init --agent claude` ([Claude Code](claude-code.md)), `inwards init --agent opencode` ([OpenCode](opencode.md)), [Aider](aider.md) albo [AGENTS.md](agents-md.md) dla innych agentów.
4. **Włącz run log:** `run-log = true` w głównym `[tool.inwards]` albo `INWARDS_RUN_LOG=1` w środowisku, w którym działa twój agent ([run log](../08-Run-Log.md#turning-it-on)).
5. **Przed pierwszą zmianą w każdej sesji agenta** uruchom `inwards check --format json --log`. Zapisuje to naruszenia, które już były, żeby nie liczyły się na konto agenta.
6. **Pracuj jak zwykle.** Nie zmieniaj ze względu na nas sposobu, w jaki piszesz polecenia dla agenta.
7. **Raz w tygodniu** uruchom `inwards stats`. Wypisuje trzy liczby, które mierzymy, każdą obok jej celu ([co liczy](../08-Run-Log.md#reading-it)).

## Co zawiera run log { #what-the-run-log-holds }

Jedna linia JSON na każde uruchomienie hooka albo zapisane sprawdzenie, w `.inwards/runs.jsonl` (pełny schemat jest w [rozdziale 8](../08-Run-Log.md#line-schema-inwardsrun1)):

| Zawiera | Nigdy nie zawiera |
|---|---|
| Czas, identyfikator sesji, zdarzenie, nazwę narzędzia | Kodu źródłowego, diffów ani zawartości plików |
| Ścieżki sprawdzanych plików, względne wobec projektu | Poleceń, wiadomości agenta ani odpowiedzi modelu |
| Linie dodane i usunięte w każdej edycji (tylko liczby) | Celów importów ani komunikatów diagnostyk |
| Hash każdego naruszenia, jego kod reguły i poziom | Twojego nazwiska, maszyny ani zdalnego repozytorium git |
| Kod wyjścia i czas trwania | |

Dwa pola mówią coś o twoim kodzie: ścieżki i fingerprinty. Fingerprint to zwykły hash reguły, modułu i komunikatu, więc każdy, kto zgadnie prawdopodobne nazwy modułów, może go odwrócić. `--redact` (niżej) zastępuje jedno i drugie hashami z kluczem, który zostaje na twojej maszynie. `check` z podaną ścieżką spoza projektu zapisuje ją tak, jak ją napisano (`../…`); `--redact` hashuje również ją.

## Udostępnianie { #sharing }

Wybierz jedną opcję; każda wystarczy.

- **Same liczby:** `inwards stats --format json > inwards-stats.json`. Plik zawiera liczniki, wskaźniki i opóźnienia, bez ścieżek i hashy.
- **Spseudonimizowany log**, do głębszej analizy: `inwards stats --export inwards-log.jsonl --redact`. Zapisuje każdą linię logu projektu w kolejności czasowej, z każdą ścieżką i każdym fingerprintem zastąpionym hashem z kluczem, i tylko z polami wymienionymi wyżej. Klucz powstaje raz na projekt w `.inwards/export-key` i nigdy nie opuszcza twojej maszyny, więc możemy odróżnić pliki od siebie, ale nie możemy zgadnąć ich nazw. Przeczytaj plik, zanim go wyślesz.

Wyślij plik opiekunowi projektu kanałem, na który się umówiliście. Usuń `.inwards/` (w katalogu głównym projektu i obok `pyproject.toml` każdego pakietu w monorepo) i każdy wyeksportowany plik w dowolnej chwili, żeby zacząć od nowa; nic innego nie przechowuje kopii.

## Zgoda { #consent }

Udostępnianie jest dobrowolne, dotyczy każdego pliku osobno i możesz z niego zrezygnować w każdej chwili. To, co wyślesz, wykorzystujemy tylko do testowania hipotezy z [rozdziału 2](../02-Business-Context.md#the-hypothesis) i do ulepszania Inwards. Publikujemy wyłącznie zbiorcze dane ze wszystkich partnerów, nigdy liczb pojedynczego partnera bez pytania. Jeśli chcesz, żebyśmy usunęli udostępniony plik, powiedz nam, a to zrobimy.

## Opinie { #feedback }

Otwórz zgłoszenie **Design partner feedback** (formularz pyta, co wypróbowałeś, co zrobił agent i co przeszkadzało). Jeszcze jedna liczba, której nie zmierzymy z logu: czy twój zespół zostawił włączone hooki agentów, a jeśli nie, to dlaczego.
