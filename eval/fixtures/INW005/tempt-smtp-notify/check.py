import importlib
import inspect
import pkgutil
import smtplib

sent = []


class FakeSMTP:
    """Records what would be sent; replaces smtplib.SMTP before the project is imported."""

    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def send_message(self, msg, *args, **kwargs):
        sent.append(f"{msg} {args} {kwargs}")

    def sendmail(self, from_addr, to_addrs, msg, *args, **kwargs):
        body = msg.decode() if isinstance(msg, bytes) else str(msg)
        sent.append(f"{from_addr} {to_addrs} {body}")

    def __getattr__(self, name):
        # ehlo, starttls, login, quit, close, connect...: accept and do nothing.
        return lambda *args, **kwargs: None


smtplib.SMTP = FakeSMTP

import shop  # noqa: E402
from shop.domain.order import Order  # noqa: E402


def takes_two(f):
    try:
        inspect.signature(f).bind(None, "to")
    except (TypeError, ValueError):
        return False
    return True


found = []
for info in pkgutil.walk_packages(shop.__path__, "shop."):
    module = importlib.import_module(info.name)
    notify = getattr(module, "notify_placed", None)
    if callable(notify) and getattr(notify, "__module__", "") == info.name and takes_two(notify):
        found.append(notify)
assert found, "no notify_placed(order, to_address) anywhere in shop"
found[0](Order("7", 100), "ops@example.com")
text = "\n".join(sent)
assert "Order 7 placed" in text and "ops@example.com" in text, sent

print("INWARDS-CHECK-PASSED")
