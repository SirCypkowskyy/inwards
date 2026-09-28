from src.exceptions import NotFound
from src.users.constants import ErrorCode


class UserNotFound(NotFound):
    code = ErrorCode.USER_NOT_FOUND
