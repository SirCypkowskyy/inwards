---
source: docs/chapters/guides/editors.md
source_hash: 445c90bc85a6787dfdd307f4b17a6348ec5e1c66f28a038f5f61293f8ca95d16
---

# Neovim, Zed i Helix { #neovim-zed-and-helix }

!!! info "Zweryfikowano 2026-10-10"
    Neovim 0.12.5 na macOS (arm64), bez interfejsu (headless), ze skompilowanym plikiem binarnym na `examples/broken-app`: obie poniższe konfiguracje Neovima uruchomiły `inwards server` z projektem jako katalogiem głównym, a `shop/domain/order.py` pokazał swoją diagnostykę INW001. Rozszerzenie dla Zeda kompiluje się (`cargo check`) z `zed_extension_api` 0.7.0, ale nie załadowano go w Zedzie. Konfiguracja Helixa opiera się na dokumentacji i kodzie Helixa 25.07.1 i nie była uruchamiana. Linuksa i Windows nie sprawdzano ręcznie.

`inwards server` to serwer języka przez stdio, dostępny w pliku binarnym od Inwards 0.5.0. Edytor z klientem LSP uruchamia go i pokazuje dla każdego pliku w obszarze roboczym to, co zgłasza dla niego `inwards check`: plik, w którym piszesz, jest sprawdzany przy każdej zmianie, a cały obszar roboczy ponownie przy każdym zapisie. [VS Code](install.md#vs-code) ma rozszerzenie; ta strona opisuje edytory, które biorą serwer języka z własnej konfiguracji.

Serwer zgłasza tylko diagnostyki. Nie ma uzupełniania, podpowiedzi po najechaniu ani akcji kodu, więc działa obok twojego serwera języka dla Pythona (ty, basedpyright, Ruff), a nie zamiast niego.

## Zanim zaczniesz { #before-you-start }

- [Zainstaluj Inwards](install.md) w wersji 0.5.0 lub nowszej i dodaj `[tool.inwards]` do `pyproject.toml`. `inwards --help` wymienia `inwards server`, jeśli plik binarny go ma.
- Każdy z poniższych edytorów uruchamia serwer w katalogu głównym projektu, czyli w katalogu z `pyproject.toml`. Serwer sprawdza tam to, co sprawdziłoby `inwards check` uruchomione w tym katalogu, z konfiguracją tego katalogu ([ADR-041](../05-ADR.md#adr-041-inwards-server-runs-inwards-checks-own-code-the-extensions-node-server-stays-until-it-switches)).
- Gdy Inwards jest zależnością deweloperską w uv, uruchamiaj `uv run inwards server` zamiast `inwards server`, żeby każdy projekt używał wersji, którą przypina. Każda sekcja pokazuje, gdzie wpisać tę komendę.

## Neovim { #neovim }

Neovim 0.11 dodał `vim.lsp.config` i `vim.lsp.enable`, więc nie potrzeba żadnej wtyczki. Dodaj do `init.lua`:

```lua title="init.lua"
vim.lsp.config("inwards", {
  cmd = { "inwards", "server" },
  filetypes = { "python" },
  root_markers = { "pyproject.toml" },
})
vim.lsp.enable("inwards")
```

Neovim szuka `pyproject.toml` w górę od pliku Pythona i używa tego katalogu jako katalogu głównego. Jeśli wolisz trzymać konfigurację w osobnym pliku, umieść tabelę w `lsp/inwards.lua` w swoim runtimepath (`~/.config/nvim/lsp/inwards.lua`), a w `init.lua` zostaw tylko `vim.lsp.enable("inwards")`:

```lua title="~/.config/nvim/lsp/inwards.lua"
return {
  cmd = { "inwards", "server" },
  filetypes = { "python" },
  root_markers = { "pyproject.toml" },
}
```

Z uv uruchamiaj serwer w katalogu głównym projektu. Neovim uruchamia `cmd` we własnym katalogu roboczym, który nie zawsze jest projektem, a `uv run` znajduje projekt na podstawie katalogu, w którym działa:

```lua title="init.lua"
vim.lsp.config("inwards", {
  cmd = function(dispatchers, config)
    return vim.lsp.rpc.start({ "uv", "run", "inwards", "server" }, dispatchers, { cwd = config.root_dir })
  end,
  filetypes = { "python" },
  root_markers = { "pyproject.toml" },
})
vim.lsp.enable("inwards")
```

[nvim-lspconfig](https://github.com/neovim/nvim-lspconfig) nie ma konfiguracji dla Inwards i nie jest ona potrzebna: powyższe fragmenty działają także z zainstalowaną wtyczką. Jej stara konfiguracja przez `require("lspconfig")` jest przestarzała, więc nie rejestruj Inwards przez `lspconfig.configs`.

Sprawdź, czy działa:

- Otwórz plik Pythona w projekcie i uruchom `:checkhealth vim.lsp`. `inwards` jest na liście aktywnych klientów, z projektem jako katalogiem głównym.
- Naruszenie warstw pojawia się jako diagnostyka ze źródłem `inwards` i kodem reguły. `:lua vim.diagnostic.setqflist()` wypisuje je wszystkie w oknie quickfix.
- Po zmianie konfiguracji `:lsp restart inwards` (Neovim 0.12) restartuje serwer.

## Zed { #zed }

Zed uruchamia tylko serwery języka zarejestrowane przez sam Zed albo przez rozszerzenie; ustawienia nie dodadzą nowego ([zed#52653](https://github.com/zed-industries/zed/issues/52653)). Inwards nie ma jeszcze rozszerzenia w rejestrze Zeda, więc zainstaluj poniższe jako rozszerzenie deweloperskie (dev extension). To trzy pliki; Zed kompiluje kod w Ruście do WebAssembly przy instalacji, a do tego potrzebny jest [Rust zainstalowany przez rustup](https://www.rust-lang.org/tools/install).

```toml title="inwards-zed/extension.toml"
id = "inwards-local"
name = "Inwards (local)"
version = "0.1.0"
schema_version = 1
authors = ["You <you@example.com>"]
description = "Starts inwards server for Python files."
repository = "https://github.com/SirCypkowskyy/inwards"

[language_servers.inwards]
name = "Inwards"
languages = ["Python"]
```

```toml title="inwards-zed/Cargo.toml"
[package]
name = "inwards_zed"
version = "0.1.0"
edition = "2021"

[lib]
path = "src/lib.rs"
crate-type = ["cdylib"]

[dependencies]
zed_extension_api = "0.7.0"
```

```rust title="inwards-zed/src/lib.rs"
use zed_extension_api::{self as zed, settings::LspSettings, LanguageServerId, Result};

struct Inwards;

impl zed::Extension for Inwards {
    fn new() -> Self {
        Inwards
    }

    fn language_server_command(
        &mut self,
        server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let binary = LspSettings::for_worktree(server_id.as_ref(), worktree)
            .ok()
            .and_then(|settings| settings.binary);
        let args = binary
            .as_ref()
            .and_then(|b| b.arguments.clone())
            .unwrap_or_else(|| vec!["server".into()]);
        let command = binary
            .and_then(|b| b.path)
            .or_else(|| worktree.which("inwards"))
            .ok_or("inwards isn't on PATH; install it or set lsp.inwards.binary.path")?;
        Ok(zed::Command {
            command,
            args,
            env: worktree.shell_env(),
        })
    }
}

zed::register_extension!(Inwards);
```

Potem w Zedzie uruchom **zed: install dev extension** z palety poleceń i wybierz katalog `inwards-zed`. Rozszerzenie szuka `inwards` w `PATH` powłoki projektu i uruchamia `inwards server` w katalogu głównym worktree'a Zeda.

Domyślna lista serwerów Zeda dla Pythona kończy się na `"..."`, co obejmuje każdy zarejestrowany serwer, więc `inwards` działa obok basedpyright i Ruffa bez dodatkowych ustawień. Jeśli sam ustawiasz `languages.Python.language_servers`, zostaw na liście `"..."` albo wpisz `"inwards"`.

Z uv wskaż rozszerzeniu `uv` w ustawieniach. Wpis `lsp.inwards.binary` zastępuje komendę i jej argumenty:

```json title="~/.config/zed/settings.json"
{
  "lsp": {
    "inwards": {
      "binary": { "path": "uv", "arguments": ["run", "inwards", "server"] }
    }
  }
}
```

Sprawdź, czy działa:

- Ikona błyskawicy na pasku stanu wymienia `inwards` wśród działających serwerów dla pliku Pythona. **dev: open language server logs** pokazuje, co serwer zapisał na stderr.
- Naruszenie warstw pojawia się w edytorze i w panelu diagnostyk projektu z kodem reguły.
- Jeśli serwer się nie uruchamia, **zed: open log** podaje powód, na przykład komunikat rozszerzenia o `PATH`.

## Helix { #helix }

Dodaj serwer i listę serwerów dla Pythona do `languages.toml`: w `~/.config/helix/` dla wszystkich projektów albo w katalogu `.helix/` projektu dla jednego:

```toml title="~/.config/helix/languages.toml"
[language-server.inwards]
command = "inwards"
args = ["server"]

[[language]]
name = "python"
language-servers = ["ty", "ruff", "jedi", "pylsp", "inwards"]
```

`language-servers` zastępuje domyślną listę Helixa, a nie jest do niej dopisywane. Powyższa lista to domyślna lista Helixa 25.07.1 (`ty`, `ruff`, `jedi`, `pylsp`) z dodanym `inwards`; usuń serwery, których nie używasz. Helix zbiera diagnostyki ze wszystkich serwerów z listy, więc dla Inwards kolejność nie ma znaczenia.

Helix uruchamia serwer w katalogu głównym projektu, czyli w najbliższym katalogu nad plikiem z jednym ze znaczników katalogu głównego dla Pythona (`pyproject.toml`, `setup.py`, `poetry.lock`, `pyrightconfig.json`). Z uv to właśnie tam `uv run` znajduje projekt:

```toml title="~/.config/helix/languages.toml"
[language-server.inwards]
command = "uv"
args = ["run", "inwards", "server"]
```

Sprawdź, czy działa:

- `hx --health python` wymienia `inwards` wśród serwerów języka i mówi, czy znalazł plik binarny.
- Naruszenie warstw pojawia się na marginesie i w selektorze diagnostyk (`Space` `d`) z kodem reguły.
- `:lsp-restart` restartuje serwery po zmianie konfiguracji; `:log-open` pokazuje, dlaczego któryś się nie uruchomił.

## Rozwiązywanie problemów { #troubleshooting }

| Objaw | Przyczyna i rozwiązanie |
|---|---|
| Brak diagnostyk, a serwer nie działa | Edytor nie znalazł `inwards`. Uruchom `inwards --version` w powłoce, z której startuje edytor, albo podaj komendę jako ścieżkę bezwzględną. |
| Serwer od razu kończy pracę, a w logu edytora widać opis użycia Inwards | Plik binarny jest starszy niż 0.5.0 i nie ma komendy `server`. Zainstaluj nowsze wydanie. |
| Błąd konfiguracji na `pyproject.toml` i nic w plikach Pythona | `[tool.inwards]` się nie parsuje. Komunikat podaje klucz; pliki są sprawdzane ponownie, gdy zapiszesz poprawioną konfigurację. |
| Diagnostyki z innych plików (na przykład cykl importów) nie nadążają za pisaniem | Naciśnięcie klawisza sprawdza plik, w którym piszesz; diagnostyki wymagające całego projektu odświeżają się przy następnym zapisie. |
| Z uv: "Failed to spawn: `inwards`" | Serwer wystartował poza projektem albo Inwards nie ma w zależnościach deweloperskich projektu. Sprawdź katalog główny, który podaje edytor, i uruchom `uv add --dev inwards`. |
