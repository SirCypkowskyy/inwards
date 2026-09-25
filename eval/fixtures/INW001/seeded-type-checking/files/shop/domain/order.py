from dataclasses import dataclass
from typing import TYPE_CHECKING

from shop.domain.ports import OrderRepository

if TYPE_CHECKING:
    from shop.infrastructure.sql_orders import SqlOrderRepository


@dataclass
class Order:
    id: str
    total_cents: int


def place(order: Order, repo: OrderRepository) -> None:
    repo.save(order)


def place_in_sql(order: Order, repo: "SqlOrderRepository") -> None:
    repo.save(order)
