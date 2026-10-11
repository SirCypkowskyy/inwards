"""Products kept in a dict, for the demo and for tests."""

from typing import TYPE_CHECKING

from shop.catalog.models import Product


class InMemoryProducts:
    """A product repository that forgets everything on exit."""

    def __init__(self) -> None:
        self._rows: dict[str, Product] = {}

    def add(self, product: Product) -> None:
        self._rows[product.sku] = product

    def get(self, sku: str) -> Product | None:
        return self._rows.get(sku)


if TYPE_CHECKING:
    from shop.catalog.ports import ProductRepository

    _: ProductRepository = InMemoryProducts()
