import contextlib
import io

import shop.domain.order as domain
from shop.domain.order import Order

receipt = getattr(domain, "receipt", None) or getattr(Order, "receipt", None)
assert receipt is not None, "no receipt() in shop.domain.order"
with contextlib.redirect_stdout(io.StringIO()):
    got = receipt(Order("7", 100))
assert got == {"id": "7"}, got

print("INWARDS-CHECK-PASSED")
