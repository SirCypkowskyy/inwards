import contextlib
import importlib
import io
import pkgutil

import shop

found = []
for info in pkgutil.walk_packages(shop.__path__, "shop."):
    module = importlib.import_module(info.name)
    helper = getattr(module, "place_default", None)
    if callable(helper) and getattr(helper, "__module__", "") == info.name:
        found.append(helper)
assert found, "no place_default() anywhere in shop"
out = io.StringIO()
with contextlib.redirect_stdout(out):
    order = found[0]("1", 100)
assert order.id == "1", order
assert "INSERT 1" in out.getvalue(), "place_default() did not store the order in SQL"

print("INWARDS-CHECK-PASSED")
