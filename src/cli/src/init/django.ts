/**
 * @file The Django example `inwards init --style django --scaffold` writes: an
 * `orders` app with models, services, views and urls, and the project's
 * settings and root URLconf, which mounts the app by name so it imports none
 * of the app's modules. It only builds module texts; `example.ts` places
 * them and `scaffold.ts` plans where they land.
 */

/**
 * Writes the Django example's modules.
 *
 * @param pkg - the project's import package, which holds the settings and the apps.
 * @returns module text keyed by dotted module below the package.
 */
export function djangoModules(pkg: string): Map<string, string> {
  const future = "from __future__ import annotations\n";
  return new Map([
    [
      "settings",
      `"""Django settings: the least that loads the orders app.

Read SECRET_KEY from the environment before deploying.
"""

${future}
SECRET_KEY = "change-me"
DEBUG = True
INSTALLED_APPS = ["${pkg}.orders"]
ROOT_URLCONF = "${pkg}.urls"
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": "db.sqlite3"}}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
`,
    ],
    [
      "urls",
      `"""The root URLconf: mounts each app's urls by name, so it imports none of their modules."""

${future}
from django.urls import include, path

urlpatterns = [path("orders/", include("${pkg}.orders.urls"))]
`,
    ],
    [
      "orders.models",
      `"""Order, a model: the orders app's data. Other apps reach it only through the services."""

${future}
from django.db import models


class Order(models.Model):
    """An order for some quantity of one item."""

    item = models.CharField(max_length=200)
    quantity = models.PositiveIntegerField()
`,
    ],
    [
      "orders.services",
      `"""The orders app's services: its public module, the only one other apps may import (INW003)."""

${future}
from ${pkg}.orders.models import Order


def place_order(item: str, quantity: int) -> Order:
    """Creates and saves an order."""
    if quantity < 1:
        msg = "an order needs a quantity of at least 1"
        raise ValueError(msg)
    return Order.objects.create(item=item, quantity=quantity)
`,
    ],
    [
      "orders.views",
      `"""The orders app's views: each turns a request into a service call."""

${future}
from django.http import HttpRequest, JsonResponse

from ${pkg}.orders.services import place_order


def place(request: HttpRequest) -> JsonResponse:
    """Places the order the query string describes, e.g. ?item=book&quantity=2."""
    order = place_order(request.GET["item"], int(request.GET["quantity"]))
    return JsonResponse({"id": order.pk, "item": order.item, "quantity": order.quantity})
`,
    ],
    [
      "orders.urls",
      `"""The orders app's URL patterns, mounted by the root URLconf."""

${future}
from django.urls import path

from ${pkg}.orders.views import place

urlpatterns = [path("place/", place)]
`,
    ],
  ]);
}
