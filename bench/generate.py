"""Generate the synthetic layered repo used in docs chapter 6.

    python3 bench/generate.py /tmp/stratum-bench     # 2,100 files, ~496k lines
    cd /tmp/stratum-bench && stratum check

Every import points inward, so a correct run reports 0 violations.
"""

import random
import sys
from pathlib import Path

LAYERS = ["domain", "application", "infrastructure", "api"]
PACKAGES_PER_LAYER = 25
MODULES_PER_PACKAGE = 20
IMPORTS_PER_MODULE = 8
FUNCTIONS_PER_MODULE = 40

BODY = "\n".join(
    f"def f{i}(x: int) -> int:\n    y = x * {i}\n    if y > 10:\n        return y - 1\n    return y + 1\n"
    for i in range(FUNCTIONS_PER_MODULE)
)

CONFIG = """[tool.stratum]
root = "src"
layers = [
  { name = "domain", modules = ["shop.domain"] },
  { name = "application", modules = ["shop.application"] },
  { name = "infrastructure", modules = ["shop.infrastructure"] },
  { name = "interface", modules = ["shop.api"] },
]
"""


def main(out: Path) -> None:
    rng = random.Random(1)
    for depth, layer in enumerate(LAYERS):
        for pkg in range(PACKAGES_PER_LAYER):
            package = out / "src" / "shop" / layer / f"p{pkg}"
            package.mkdir(parents=True, exist_ok=True)
            (package / "__init__.py").touch()
            for mod in range(MODULES_PER_PACKAGE):
                imports = [
                    f"from shop.{LAYERS[rng.randrange(depth + 1)]}.p{rng.randrange(PACKAGES_PER_LAYER)}"
                    f".m{rng.randrange(MODULES_PER_PACKAGE)} import f1"
                    for _ in range(IMPORTS_PER_MODULE)
                ]
                (package / f"m{mod}.py").write_text("\n".join(imports) + "\n\n" + BODY)
    (out / "pyproject.toml").write_text(CONFIG)


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "stratum-bench"))
