import inspect

import shop.domain.order as order

functions = [f for _, f in inspect.getmembers(order, inspect.isfunction) if f.__module__ == order.__name__]
assert functions, "no functions left"
assert all((f.__doc__ or "").strip() for f in functions), "a function has no docstring"
