"""The catalog's entities."""

from dataclasses import dataclass

from shop.shared.models import Money


@dataclass(frozen=True)
class Product:
    """Something the shop sells."""

    sku: str
    name: str
    price: Money
