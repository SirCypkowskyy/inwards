"""What the rest of the shop may call in the catalog."""

from shop.catalog.commands.add_product import AddProduct
from shop.catalog.models import Product
from shop.catalog.queries.get_product import GetProduct
from shop.shared.models import Money


class CatalogApi:
    """The catalog's entry point. It also satisfies `shop.orders.ports.PriceList`."""

    def __init__(self, add_product: AddProduct, get_product: GetProduct) -> None:
        self._add_product = add_product
        self._get_product = get_product

    def add(self, sku: str, name: str, price_cents: int, discount_percent: int = 0) -> Product:
        return self._add_product(sku, name, price_cents, discount_percent)

    def price_of(self, sku: str) -> Money:
        product = self._get_product(sku)
        if product is None:
            msg = f"no product {sku!r} in the catalog"
            raise KeyError(msg)
        return product.price
