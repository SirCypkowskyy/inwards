from app.orders import service


def list_orders():
    return service.all_orders()
