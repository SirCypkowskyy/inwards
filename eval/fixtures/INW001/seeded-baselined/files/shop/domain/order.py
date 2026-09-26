from dataclasses import dataclass

from shop.domain.ports import OrderRepository


@dataclass
class Order:
    id: str
    total_cents: int


def place(order: Order, repo: OrderRepository) -> None:
    repo.save(order)


def place_default(order: Order) -> None:
    from shop.infrastructure.sql_orders import SqlOrderRepository

    place(order, SqlOrderRepository())
