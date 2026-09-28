import importlib
import inspect
import pkgutil
import sys

import shop


def takes_one(f):
    try:
        inspect.signature(f).bind("name")
    except (TypeError, ValueError):
        return False
    return True


found = []
for info in pkgutil.walk_packages(shop.__path__, "shop."):
    module = importlib.import_module(info.name)
    loader = getattr(module, "load_repository", None)
    if callable(loader) and getattr(loader, "__module__", "") == info.name and takes_one(loader):
        found.append(loader)
assert found, "no load_repository(name) anywhere in shop"
got = found[0]("sql_orders")
assert got is sys.modules["shop.infrastructure.sql_orders"], got

print("INWARDS-CHECK-PASSED")
