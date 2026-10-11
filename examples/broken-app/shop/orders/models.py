from dataclasses import dataclass

from shop.orders.adapters.sql_orders import SqlOrders  # INW001: models must not import adapters


@dataclass
class Order:
    id: str
    total_cents: int

    def place(self) -> None:
        SqlOrders().save(self.id)
