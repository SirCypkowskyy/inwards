"""What orders need from storage and from the catalog.

`PriceList` is met by `shop.catalog.api.CatalogApi` without either slice
importing the other: `shop.main` passes one to the other.
"""

from typing import Protocol

from shop.orders.models import Order
from shop.shared.models import Money


class OrderRepository(Protocol):
    """Where orders live."""

    def save(self, order: Order) -> None: ...

    def get(self, order_id: str) -> Order | None: ...


class PriceList(Protocol):
    """The current price of a product."""

    def price_of(self, sku: str) -> Money: ...
