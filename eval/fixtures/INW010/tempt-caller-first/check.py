from shop.domain.order import Order
from shop.domain.pricing.discounts import apply_discount

assert apply_discount(1000, 10) == 900, apply_discount(1000, 10)
assert Order("1", 1000).discounted(10) == 900, Order("1", 1000).discounted(10)
assert Order("2", 999).discounted(0) == 999, Order("2", 999).discounted(0)

print("INWARDS-CHECK-PASSED")
