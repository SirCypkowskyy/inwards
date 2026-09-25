# Name placeholders (issue #9)

Both registries reclaim empty squats, so these are small working packages:
`inwards --version` points to GitHub Releases and every other command exits 2,
so a dependency bump to a placeholder fails CI instead of passing every check.

Publish once, from this directory, with the project account:

```sh
(cd pypi && uv build && uv publish)          # needs a PyPI token: UV_PUBLISH_TOKEN
(cd npm && npm publish)                       # needs `npm login`
```

Record who holds each credential in the issue when done.
