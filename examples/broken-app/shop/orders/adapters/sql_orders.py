from typing import TYPE_CHECKING


class SqlOrders:
    def save(self, order_id: str) -> None:
        print(f"INSERT {order_id}")


if TYPE_CHECKING:
    from shop.orders.ports import OrderRepository

    _: OrderRepository = SqlOrders()
