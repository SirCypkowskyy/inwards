"""Add a product to the catalog."""

from shop.catalog.models import Product
from shop.catalog.ports import ProductRepository
from shop.catalog.services import discounted
from shop.shared.models import Money


class AddProduct:
    """Prices a new product and stores it."""

    def __init__(self, products: ProductRepository) -> None:
        self._products = products

    def __call__(self, sku: str, name: str, price_cents: int, discount_percent: int = 0) -> Product:
        product = Product(sku, name, discounted(Money(price_cents), discount_percent))
        self._products.add(product)
        return product
