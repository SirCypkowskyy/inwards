from src.users import service
from src.users.schemas import UserOut


async def valid_user_id(user_id: int) -> UserOut:
    return service.get_user(user_id)
