from shop.domain.order import Order

assert Order("1", 1000).discounted(10) == 900, Order("1", 1000).discounted(10)
assert Order("2", 999).discounted(0) == 999, Order("2", 999).discounted(0)

print("INWARDS-CHECK-PASSED")
