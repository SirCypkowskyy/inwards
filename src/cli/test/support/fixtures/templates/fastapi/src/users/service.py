from src.database import engine
from src.users.exceptions import UserNotFound
from src.users.models import User
from src.users.schemas import UserOut


def get_user(user_id: int) -> UserOut:
    if engine is None:
        raise UserNotFound()
    return UserOut(id=User(id=user_id).id)
