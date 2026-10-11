"""What the catalog needs from storage. Adapters implement these structurally."""

from typing import Protocol

from shop.catalog.models import Product


class ProductRepository(Protocol):
    """Where products live."""

    def add(self, product: Product) -> None: ...

    def get(self, sku: str) -> Product | None: ...
