from dataclasses import dataclass

from shop.infrastructure.db import save  # INW001: the domain must not import infrastructure


@dataclass
class Order:
    id: str
    total_cents: int


def place(order: Order) -> None:
    save(order.id)
