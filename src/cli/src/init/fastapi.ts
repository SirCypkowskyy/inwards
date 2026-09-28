/**
 * @file The FastAPI example `inwards init --style fastapi --scaffold` writes,
 * in the fastapi-best-practices layout: a `posts` domain with a module for
 * every role of the fastapi-domain template, on a kernel of shared modules,
 * and `main.py`, which builds the app. Every endpoint documents its metadata
 * and errors, so the FastAPI rules find nothing. It only builds module
 * texts; `example.ts` places them and `scaffold.ts` plans where they land.
 */

/**
 * Writes the FastAPI example's modules.
 *
 * @param pkg - the project's import package, e.g. `src` for fastapi-best-practices itself.
 * @returns module text keyed by dotted module below the package.
 */
export function fastapiModules(pkg: string): Map<string, string> {
  return new Map([...kernelModules(pkg), ...postsModules(pkg)]);
}

/**
 * Writes the kernel's shared modules and the app.
 *
 * @param pkg - the project's import package.
 * @returns module text keyed by dotted module below the package.
 */
function kernelModules(pkg: string): Map<string, string> {
  return new Map([
    [
      "config",
      `"""Global settings, read from the environment. A config.py is where BaseSettings is subclassed."""

from pydantic_settings import BaseSettings


class Config(BaseSettings):
    """The app's settings; each field can be set by an environment variable of its name."""

    APP_NAME: str = "posts"


settings = Config()
`,
    ],
    [
      "models",
      `"""The base model: every schema subclasses CustomModel, never pydantic.BaseModel itself."""

from pydantic import BaseModel, ConfigDict


class CustomModel(BaseModel):
    """What every schema of the app shares."""

    model_config = ConfigDict(str_strip_whitespace=True)
`,
    ],
    [
      "exceptions",
      `"""Global exceptions: each domain subclasses them, and main.py answers them with a status code."""


class NotFound(Exception):
    """Something the request names doesn't exist: answered with 404."""
`,
    ],
    [
      "main",
      `"""The app: includes each domain's router and answers the global exceptions.

Run it with \`uvicorn ${pkg}.main:app\`.
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from ${pkg}.config import settings
from ${pkg}.exceptions import NotFound
from ${pkg}.posts.router import router as posts_router

app = FastAPI(title=settings.APP_NAME)
app.include_router(posts_router)


@app.exception_handler(NotFound)
async def not_found(request: Request, exc: NotFound) -> JSONResponse:
    """Answers a NotFound from any domain with 404."""
    return JSONResponse(status_code=404, content={"detail": str(exc)})
`,
    ],
  ]);
}

/**
 * Writes the `posts` domain: one module for every role of the fastapi-domain template.
 *
 * @param pkg - the project's import package.
 * @returns module text keyed by dotted module below the package.
 */
function postsModules(pkg: string): Map<string, string> {
  return new Map([
    [
      "posts.constants",
      `"""The posts domain's constants."""

MAX_TITLE_LENGTH = 100
`,
    ],
    [
      "posts.config",
      `"""The posts domain's settings, read from POSTS_* environment variables."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class PostsConfig(BaseSettings):
    """How the posts domain behaves."""

    model_config = SettingsConfigDict(env_prefix="POSTS_")

    EXCERPT_LENGTH: int = 80


posts_settings = PostsConfig()
`,
    ],
    [
      "posts.utils",
      `"""Helpers of the posts domain, with no business logic."""

from ${pkg}.posts.config import posts_settings


def excerpt(body: str) -> str:
    """Returns the start of a post's body, as long as the settings say."""
    return body[: posts_settings.EXCERPT_LENGTH]
`,
    ],
    [
      "posts.models",
      `"""Post, the stored record. Other domains never import it (INW003); they use the schemas."""

from dataclasses import dataclass


@dataclass
class Post:
    """A post as it is stored."""

    id: int
    title: str
    body: str
`,
    ],
    [
      "posts.schemas",
      `"""What the posts endpoints take and return."""

from pydantic import Field

from ${pkg}.models import CustomModel
from ${pkg}.posts.constants import MAX_TITLE_LENGTH


class PostCreate(CustomModel):
    """A new post."""

    title: str = Field(max_length=MAX_TITLE_LENGTH)
    body: str


class PostResponse(CustomModel):
    """A stored post, with the start of its body."""

    id: int
    title: str
    body: str
    excerpt: str
`,
    ],
    [
      "posts.exceptions",
      `"""The posts domain's errors."""

from ${pkg}.exceptions import NotFound


class PostNotFound(NotFound):
    """No post has the id asked for."""
`,
    ],
    [
      "posts.service",
      `"""The posts domain's business logic. It keeps posts in memory, so the example needs no database."""

from dataclasses import asdict

from ${pkg}.posts.exceptions import PostNotFound
from ${pkg}.posts.models import Post
from ${pkg}.posts.schemas import PostCreate, PostResponse
from ${pkg}.posts.utils import excerpt

_posts: dict[int, Post] = {}


def _response(post: Post) -> PostResponse:
    return PostResponse(**asdict(post), excerpt=excerpt(post.body))


def create_post(data: PostCreate) -> PostResponse:
    """Stores a new post."""
    post = Post(id=len(_posts) + 1, title=data.title, body=data.body)
    _posts[post.id] = post
    return _response(post)


def get_post(post_id: int) -> PostResponse:
    """Returns the post with this id, or raises PostNotFound."""
    post = _posts.get(post_id)
    if post is None:
        msg = f"no post has the id {post_id}"
        raise PostNotFound(msg)
    return _response(post)
`,
    ],
    [
      "posts.dependencies",
      `"""The posts domain's dependencies: checks the endpoints share, such as a post that must exist."""

from ${pkg}.posts.schemas import PostResponse
from ${pkg}.posts.service import get_post


async def valid_post_id(post_id: int) -> PostResponse:
    """Returns the post the path names, or raises PostNotFound (404)."""
    return get_post(post_id)
`,
    ],
    [
      "posts.router",
      `"""The posts domain's endpoints. Each declares its summary, status code, response model and errors."""

from typing import Annotated

from fastapi import APIRouter, Depends, status

from ${pkg}.posts.dependencies import valid_post_id
from ${pkg}.posts.schemas import PostCreate, PostResponse
from ${pkg}.posts.service import create_post

router = APIRouter(prefix="/posts", tags=["posts"])


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a post")
async def add_post(data: PostCreate) -> PostResponse:
    return create_post(data)


@router.get(
    "/{post_id}",
    summary="Read a post",
    responses={status.HTTP_404_NOT_FOUND: {"description": "No post has this id"}},
)
async def read_post(
    post: Annotated[PostResponse, Depends(valid_post_id)],
) -> PostResponse:
    return post
`,
    ],
  ]);
}
