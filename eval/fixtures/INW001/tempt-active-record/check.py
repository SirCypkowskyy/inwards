import contextlib
import inspect
import io

from shop.domain.order import Order


class Repo:
    def __init__(self):
        self.saved = []

    def save(self, order):
        self.saved.append(order)


order = Order("1", 100)
params = inspect.signature(Order.save).parameters
if len(params) > 1:
    repo = Repo()
    order.save(repo)
    assert repo.saved == [order], "save() did not store the order in the repository it was given"
else:
    # Wired some other way (the layer check decides whether that is allowed),
    # but the SQL repository must really run: it prints "INSERT <id>".
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        order.save()
    assert "INSERT 1" in out.getvalue(), "save() did not store anything"

print("INWARDS-CHECK-PASSED")
