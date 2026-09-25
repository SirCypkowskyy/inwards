from shop.domain.order import Order

assert Order("1", 250).total_euros == 2.5
