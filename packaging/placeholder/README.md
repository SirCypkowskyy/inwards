# Name placeholders (issue #9)

Both registries reclaim empty squats, so these are small working packages:
`inwards --version` points to GitHub Releases and every other command exits 2,
so a dependency bump to a placeholder fails CI instead of passing every check.

Publish once, from this directory, with the project account (2FA on, and a
token scoped to this one project):

```sh
npm view inwards; curl -s -o /dev/null -w "%{http_code}\n" https://pypi.org/pypi/inwards/json  # both must say 404
(cd pypi && uv build && uvx twine check dist/* && uv publish)   # UV_PUBLISH_TOKEN
(cd npm && npm publish)                                          # after `npm login`
```

Then record on the issue who holds each credential. Replace these packages
with the real wheel and npm package as soon as they exist (a name held only
by a placeholder can be reclaimed under PEP 541 or npm's dispute policy),
and yank or deprecate 0.0.0 then.
