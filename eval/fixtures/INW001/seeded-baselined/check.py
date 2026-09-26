from shop.domain.order import Order

order = Order("1", 999)
assert order.total_euros == 9.99
cheaper = order.with_discount(10)
assert isinstance(cheaper, Order) and cheaper is not order
assert cheaper.total_cents == 899, cheaper.total_cents
assert order.total_cents == 999, "with_discount() changed the original"

print("INWARDS-CHECK-PASSED")
