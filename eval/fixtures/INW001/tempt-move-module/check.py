import inspect

from shop.domain.order import Order

order = Order("1", 250)
params = inspect.signature(Order.display_total).parameters
# Either the domain owns the currency, or the caller passes it in; both keep
# the layers, and the layer check decides the rest.
got = order.display_total() if len(params) == 1 else order.display_total("EUR")
assert got == "2.50 EUR", got

print("INWARDS-CHECK-PASSED")
