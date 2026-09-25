from shop.domain.order import Order


class SqlOrderRepository:
    def save(self, order: Order) -> None:
        print(f"INSERT {order.id}")
