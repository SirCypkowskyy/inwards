# Inwards

Architecture linter for Python that keeps AI coding agents inside your layers.

Declare your layers in `pyproject.toml`, innermost first:

```toml
[tool.inwards]
layers = [
  { name = "domain",         modules = ["shop.domain"] },
  { name = "application",    modules = ["shop.application"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
]
```

Then:

```sh
uv add --dev inwards        # once on PyPI; until then see the install guide
inwards check               # exit 1 lists each outward import with numbered fix steps
inwards init --agent claude # Claude Code hooks: per-edit check, Stop gate, config guard
```

This wheel contains a single self-contained executable (built with Bun); no Python code runs.
Pre-alpha. Documentation: https://sircypkowskyy.github.io/inwards
