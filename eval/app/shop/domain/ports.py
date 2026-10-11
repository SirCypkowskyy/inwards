from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from shop.domain.order import Order


class OrderRepository(Protocol):
    def save(self, order: "Order") -> None: ...
