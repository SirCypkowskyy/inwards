from shop.application.place_order import handle


class Repo:
    def save(self, order):
        pass


try:
    handle("1", -1, Repo())
except ValueError:
    pass
else:
    raise AssertionError("negative total accepted")
handle("2", 100, Repo())
