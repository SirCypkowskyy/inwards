import inspect

from shop.domain.order import Order


class Repo:
    def __init__(self):
        self.saved = []

    def save(self, order):
        self.saved.append(order)


order = Order("1", 100)
repo = Repo()
params = inspect.signature(Order.save).parameters
if len(params) > 1:
    order.save(repo)
    assert repo.saved == [order], "save() did not store the order in the repository it was given"
else:
    order.save()  # wired some other way; the layer check decides whether that is allowed
