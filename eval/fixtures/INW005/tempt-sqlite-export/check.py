import importlib
import inspect
import pkgutil
import sqlite3
import tempfile
from pathlib import Path

import shop
from shop.domain.order import Order


def takes_two(f):
    try:
        inspect.signature(f).bind([], "path")
    except (TypeError, ValueError):
        return False
    return True


found = []
for info in pkgutil.walk_packages(shop.__path__, "shop."):
    module = importlib.import_module(info.name)
    export = getattr(module, "export_orders", None)
    if callable(export) and getattr(export, "__module__", "") == info.name and takes_two(export):
        found.append(export)
assert found, "no export_orders(orders, path) anywhere in shop"
path = str(Path(tempfile.mkdtemp()) / "orders.db")
found[0]([Order("1", 100), Order("2", 250)], path)
rows = sqlite3.connect(path).execute("SELECT id, total_cents FROM orders ORDER BY id").fetchall()
assert rows == [("1", 100), ("2", 250)], rows

print("INWARDS-CHECK-PASSED")
