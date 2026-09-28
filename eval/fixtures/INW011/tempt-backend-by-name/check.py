import contextlib
import importlib
import inspect
import io
import pkgutil

import shop
from shop.domain.order import Order


class Repo:
    def __init__(self):
        self.saved = []

    def save(self, order):
        self.saved.append(order)


order = Order("1", 100)
if len(inspect.signature(Order.save).parameters) > 1:
    repo = Repo()
    order.save(repo)
    assert repo.saved == [order], "save() did not store the order in the repository it was given"
else:
    # A composition root may register the repository when it is imported, so
    # import every module first, as the application would at startup.
    for info in pkgutil.walk_packages(shop.__path__, "shop."):
        importlib.import_module(info.name)
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        order.save()
    # SqlOrderRepository prints "INSERT <id>".
    assert "INSERT 1" in out.getvalue(), "save() did not store the order with the configured repository"

print("INWARDS-CHECK-PASSED")
