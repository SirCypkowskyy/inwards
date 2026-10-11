"""Wires the catalog: adapters into commands and queries, those into the API."""

from shop.catalog.adapters.in_memory_products import InMemoryProducts
from shop.catalog.api import CatalogApi
from shop.catalog.commands.add_product import AddProduct
from shop.catalog.queries.get_product import GetProduct


def build_catalog() -> CatalogApi:
    """A catalog backed by memory."""
    products = InMemoryProducts()
    return CatalogApi(AddProduct(products), GetProduct(products))
