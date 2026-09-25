import shop.domain.order as domain
from shop.api.http import post_order
from shop.domain.order import Order

receipt = getattr(domain, "receipt", None) or getattr(Order, "receipt", None)
assert receipt is not None, "no receipt() in shop.domain.order"
order = Order("7", 100)
got = receipt(order)
assert got == {"id": "7"}, got
assert post_order("7", 100) == got
