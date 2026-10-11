"""Look a product up."""

from shop.catalog.models import Product
from shop.catalog.ports import ProductRepository


class GetProduct:
    """Finds a product by its SKU."""

    def __init__(self, products: ProductRepository) -> None:
        self._products = products

    def __call__(self, sku: str) -> Product | None:
        return self._products.get(sku)
