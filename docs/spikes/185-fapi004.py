"""Throwaway corpus analysis for the FAPI004 spike (issue #185).

Measures, per FastAPI project checked out under CORPUS_DIR, how often the
candidate checks A to D of `unhandled-exception` would fire. It parses every
first-party .py file with `ast` and never imports or runs the projects. It is
a spike: module resolution is by dotted-path suffix, all apps in a repo share
one handler set, and methods on objects (ring 4) are not followed. The write-up
next to it (185-fapi004.md) gives the results and the hand classification.

    uv run --no-project python docs/spikes/185-fapi004.py CORPUS_DIR [--json OUT]

A: first-party exception classes with no handler by MRO (no `Exception`
   handler, no middleware catch). Variants: every class, classes declared in
   `*exception*` / `*error*` modules, and those of them raised somewhere.
B: first-party exceptions raised in rings 0-2 (endpoint, called first-party
   functions, `Depends` targets, max depth 2) with no handler by MRO. A raise
   is dropped when a try/except in its own function, or around any call on the
   path from the endpoint, catches it (B_caller counts those).
C: middleware with `try/except` around `call_next` (or `self.app(...)` for pure
   ASGI). "naive" = the except has no bare `raise`; "handles" = it neither
   raises nor calls the app again. Classes it handles count as handled in A/B.
"strict" columns don't count a catch-all (`Exception` handler or middleware).
The .tsv next to this file is the stdout of the run in the write-up.
D: `yield` dependencies with an `except` that contains no `raise`.
"""

import ast
import builtins
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

SKIP_DIRS = {
    "tests", "test", "testing", "migrations", "alembic", "node_modules", ".venv",
    "venv", "docs", "docs_src", "site-packages", ".git", "__pycache__",
}
ROUTE_METHODS = {
    "get", "post", "put", "patch", "delete", "head", "options", "trace",
    "api_route", "websocket",
}
BUILTIN_EXC = {
    n for n in dir(builtins)
    if isinstance(getattr(builtins, n), type) and issubclass(getattr(builtins, n), BaseException)
}
DEFAULT_HANDLED = {"HTTPException", "WebSocketException", "RequestValidationError",
                   "WebSocketRequestValidationError"}
CATCH_ALL = {"Exception", "BaseException"}
MAX_DEPTH = 2
# "Strict" variant: a catch-all (Exception handler or middleware) doesn't count as handled.
STRICT_MISS = {None, "ext:Exception", "ext:BaseException", "middleware:Exception"}


def is_first_party(path: Path) -> bool:
    name = path.name
    return not (
        SKIP_DIRS & set(path.parts)
        or name.startswith("test_")
        or name.endswith("_test.py")
        or name == "conftest.py"
    )


class Module:
    """One parsed file: its top-level symbols and imports."""

    def __init__(self, repo: "Repo", path: Path, tree: ast.Module):
        self.repo, self.path, self.tree = repo, path, tree
        rel = path.relative_to(repo.root).with_suffix("")
        parts = list(rel.parts)
        self.is_pkg = parts[-1] == "__init__"
        if self.is_pkg:
            parts = parts[:-1]
        self.dotted = ".".join(parts)
        self.defs: dict[str, ast.AST] = {}
        self.imports: dict[str, tuple[str, str | None]] = {}  # name -> (module, attr)
        self.stars: list[str] = []  # from x import *
        self.text = None
        for node in tree.body:
            self._collect(node)

    def _collect(self, node: ast.AST) -> None:
        if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            self.defs[node.name] = node
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    self.defs[target.id] = node
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            self.defs[node.target.id] = node
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.asname:
                    self.imports[alias.asname] = (alias.name, None)
                else:
                    top = alias.name.split(".")[0]
                    self.imports[top] = (top, None)
        elif isinstance(node, ast.ImportFrom):
            base = self._absolute(node.module or "", node.level)
            for alias in node.names:
                if alias.name == "*":
                    self.stars.append(base)
                else:
                    self.imports[alias.asname or alias.name] = (base, alias.name)
        elif isinstance(node, (ast.If, ast.Try)):
            for child in ast.iter_child_nodes(node):
                if isinstance(child, ast.stmt):
                    self._collect(child)
            for handler in getattr(node, "handlers", []):
                for child in handler.body:
                    self._collect(child)

    def _absolute(self, module: str, level: int) -> str:
        if level == 0:
            return module
        package = self.dotted.split(".") if self.is_pkg else self.dotted.split(".")[:-1]
        package = package[: len(package) - (level - 1)] if level > 1 else package
        return ".".join([*package, module] if module else package)


class Repo:
    """Every first-party module of one checkout, with suffix-based import resolution."""

    def __init__(self, root: Path):
        self.root = root
        self.modules: dict[str, Module] = {}
        self.parse_errors = 0
        self.files = 0
        for path in sorted(root.rglob("*.py")):
            rel = path.relative_to(root)
            if not is_first_party(rel) or path.stat().st_size > 1_000_000:
                continue
            self.files += 1
            try:
                tree = ast.parse(path.read_bytes())
            except (SyntaxError, ValueError):
                self.parse_errors += 1
                continue
            module = Module(self, path, tree)
            self.modules[module.dotted] = module
        self.by_suffix: dict[str, list[Module]] = defaultdict(list)
        for dotted, module in self.modules.items():
            parts = dotted.split(".")
            for i in range(len(parts)):
                self.by_suffix[".".join(parts[i:])].append(module)

    def module(self, dotted: str) -> Module | None:
        if dotted in self.modules:
            return self.modules[dotted]
        found = self.by_suffix.get(dotted, [])
        return min(found, key=lambda m: len(m.dotted)) if found else None

    def lookup(self, module: Module, name: str, depth: int = 0):
        """Resolves a top-level name: ('fp', module, node) or ('ext', dotted) or ('mod', module)."""
        if depth > 6:
            return None
        if name in module.defs:
            return ("fp", module, module.defs[name])
        if name in module.imports:
            target, attr = module.imports[name]
            if attr is None:
                found = self.module(target)
                return ("mod", found) if found else ("ext", target)
            found = self.module(target)
            if found is None:
                return ("ext", f"{target}.{attr}")
            if attr in found.defs or attr in found.imports:
                return self.lookup(found, attr, depth + 1)
            sub = self.module(f"{found.dotted}.{attr}")
            return ("mod", sub) if sub else ("ext", f"{target}.{attr}")
        for star in module.stars:
            found = self.module(star)
            if found is not None and found is not module:
                ref = self.lookup(found, name, depth + 1)
                if ref is not None and ref[0] != "ext":
                    return ref
        if name in BUILTIN_EXC or hasattr(builtins, name):
            return ("ext", name)
        return None

    def resolve(self, module: Module, expr: ast.AST):
        if isinstance(expr, ast.Name):
            return self.lookup(module, expr.id)
        if isinstance(expr, ast.Attribute):
            base = self.resolve(module, expr.value)
            if base is None:
                return None
            if base[0] == "mod":
                return self.lookup(base[1], expr.attr)
            if base[0] == "ext":
                return ("ext", f"{base[1]}.{expr.attr}")
        if isinstance(expr, ast.Call):
            return self.resolve(module, expr.func)
        return None


def key(ref) -> str | None:
    """A stable key for a resolved class: 'fp:<module>.<name>' or 'ext:<last segment>'."""
    if ref is None:
        return None
    if ref[0] == "fp" and isinstance(ref[2], ast.ClassDef):
        return f"fp:{ref[1].dotted}.{ref[2].name}"
    if ref[0] == "ext":
        return f"ext:{ref[1].rsplit('.', 1)[-1]}"
    return None


class Analysis:
    def __init__(self, repo: Repo):
        self.repo = repo
        self.classes: dict[str, tuple[Module, ast.ClassDef]] = {}
        for module in repo.modules.values():
            for node in ast.walk(module.tree):
                if isinstance(node, ast.ClassDef):
                    self.classes.setdefault(f"fp:{module.dotted}.{node.name}", (module, node))
        self._mro: dict[str, list[str]] = {}

    def mro(self, k: str, seen=None) -> list[str]:
        """First-party and external class keys this class derives from, itself included."""
        if k in self._mro:
            return self._mro[k]
        seen = seen or set()
        if k in seen or not k.startswith("fp:") or k not in self.classes:
            return [k]
        seen.add(k)
        module, node = self.classes[k]
        out = [k]
        for base in node.bases:
            base_key = key(self.repo.resolve(module, base))
            if base_key:
                out += [b for b in self.mro(base_key, seen) if b not in out]
        self._mro[k] = out
        return out

    def is_exception(self, k: str) -> bool:
        for b in self.mro(k):
            if b.startswith("ext:"):
                name = b[4:]
                if name in BUILTIN_EXC and not name.endswith("Warning"):
                    return True
                if name.endswith(("Error", "Exception")) or name in DEFAULT_HANDLED:
                    return True
        return False

    def is_http(self, k: str) -> bool:
        return any(b.startswith("ext:") and b[4:] in DEFAULT_HANDLED for b in self.mro(k))


def calls(node: ast.AST, attr: str):
    for n in ast.walk(node):
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == attr:
            yield n


def is_call_to(node: ast.AST, *names: str) -> bool:
    if not isinstance(node, ast.Call):
        return False
    f = node.func
    return (isinstance(f, ast.Name) and f.id in names) or (isinstance(f, ast.Attribute) and f.attr in names)


def has_raise(body: list[ast.stmt]) -> bool:
    return any(isinstance(n, ast.Raise) for s in body for n in ast.walk(s))


def line_of(module: Module, node: ast.AST) -> str:
    return f"{module.path.relative_to(module.repo.root)}:{node.lineno}"


def analyse(root: Path) -> dict:
    repo = Repo(root)
    an = Analysis(repo)
    fastapi_files = [m for m in repo.modules.values() if any(
        t.startswith(("fastapi", "starlette")) for t, _ in m.imports.values())]

    # --- handler registrations ---
    handled: set[str] = set()
    registrations = unresolved = splat_apps = 0
    for module in repo.modules.values():
        args = []
        # `for exc in [A, B]: app.add_exception_handler(exc, h)` unrolls to A and B.
        unrolled = {}
        for loop in ast.walk(module.tree):
            if (isinstance(loop, ast.For) and isinstance(loop.target, ast.Name)
                    and isinstance(loop.iter, (ast.List, ast.Tuple))):
                for c in calls(loop, "add_exception_handler"):
                    if c.args and isinstance(c.args[0], ast.Name) and c.args[0].id == loop.target.id:
                        unrolled[id(c.args[0])] = loop.iter.elts
        for c in calls(module.tree, "exception_handler"):
            if c.args:
                args.append(c.args[0])
        for c in calls(module.tree, "add_exception_handler"):
            if c.args:
                args.append(c.args[0])
        for n in ast.walk(module.tree):
            if is_call_to(n, "FastAPI", "Starlette") and any(kw.arg is None for kw in n.keywords):
                splat_apps += 1  # FastAPI(**kwargs): handlers may hide in the kwargs
            pairs = [(kw.arg, kw.value) for kw in n.keywords] if isinstance(n, ast.Call) else []
            if isinstance(n, ast.Dict):  # {"exception_handlers": {...}} passed as **kwargs
                pairs = [(k.value, v) for k, v in zip(n.keys, n.values, strict=True)
                         if isinstance(k, ast.Constant)]
            for name, value in pairs:
                if name != "exception_handlers":
                    continue
                if isinstance(value, ast.Name) and isinstance(module.defs.get(value.id), ast.Assign):
                    value = module.defs[value.id].value
                if isinstance(value, ast.Dict):
                    args += [k for k in value.keys if k is not None]
                else:
                    unresolved += 1
        for arg in args:
            registrations += 1
            if isinstance(arg, ast.Constant) and isinstance(arg.value, int):
                handled.add(f"status:{arg.value}")
                continue
            elts = arg.elts if isinstance(arg, ast.Tuple) else unrolled.get(id(arg), [arg])
            for elt in elts:
                k = key(repo.resolve(module, elt))
                if k:
                    handled.add(k)
                else:
                    unresolved += 1
    catch_all = bool({f"ext:{n}" for n in CATCH_ALL} & handled)

    # --- C: middleware catches ---
    mw_items, mw_handled = [], set()
    mw_catch_all = False
    for module in repo.modules.values():
        for fn in ast.walk(module.tree):
            if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for t in ast.walk(fn):
                if not isinstance(t, ast.Try):
                    continue
                kind = None
                for n in (x for s in t.body for x in ast.walk(s)):
                    if is_call_to(n, "call_next"):
                        kind = "call_next"
                    elif (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                          and n.func.attr == "app" and isinstance(n.func.value, ast.Name)
                          and n.func.value.id == "self" and len(n.args) == 3 and kind is None):
                        kind = "asgi"
                if kind is None:
                    continue
                for h in t.handlers:
                    types = (h.type.elts if isinstance(h.type, ast.Tuple) else [h.type]) if h.type else []
                    keys = [key(repo.resolve(module, x)) or "?" for x in types] or ["ext:BaseException"]
                    # Handles = neither raises (re-raise, `raise e`, translation) nor calls the
                    # app again (a retry or a fallback replay is not a response of its own).
                    naive = not any(isinstance(n, ast.Raise) and n.exc is None
                                    for s in h.body for n in ast.walk(s))
                    swallows = not any(
                        isinstance(n, ast.Raise) or is_call_to(n, "call_next")
                        or (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                            and n.func.attr == "app")
                        for s in h.body for n in ast.walk(s))
                    at = line_of(module, h)
                    if any(x["at"] == at for x in mw_items):
                        continue  # nested function already seen from its parent
                    mw_items.append({"at": at, "kind": kind, "catches": keys,
                                     "handles_naive": naive, "handles": swallows, "fn": fn.name})
                    if swallows:
                        mw_handled.update(k for k in keys if k != "?")
                        if set(keys) & {"ext:Exception", "ext:BaseException"}:
                            mw_catch_all = True

    def handled_by(k: str, with_mw: bool) -> str | None:
        if an.is_http(k):
            return "default"
        pool = handled | (mw_handled if with_mw else set())
        for b in an.mro(k):
            if b in pool:
                return b
        if catch_all:
            return "ext:Exception"
        if with_mw and mw_catch_all:
            return "middleware:Exception"
        return None

    # --- raises anywhere ---
    raised_anywhere: Counter = Counter()
    for module in repo.modules.values():
        for n in ast.walk(module.tree):
            if isinstance(n, ast.Raise) and n.exc is not None:
                k = key(repo.resolve(module, n.exc))
                if k:
                    raised_anywhere[k] += 1

    # --- A ---
    declared = [k for k in an.classes if an.is_exception(k) and not an.is_http(k)]
    subclassed = {b for k in an.classes for b in an.mro(k)[1:]}

    def in_exc_module(k: str) -> bool:
        return any(w in an.classes[k][0].dotted.split(".")[-1].lower() for w in ("exception", "error"))

    a_items = []
    for k in declared:
        via = handled_by(k, with_mw=True)
        a_items.append({
            "class": k[3:], "at": line_of(*an.classes[k]),
            "handled_by": via, "handled_by_handler_only": handled_by(k, with_mw=False),
            "exc_module": in_exc_module(k), "raised": raised_anywhere[k],
            "is_base": k in subclassed,
        })

    # --- endpoints and rings (B) ---
    def depends_targets(module: Module, node: ast.AST, seen_assign=None):
        seen_assign = seen_assign if seen_assign is not None else set()
        for n in ast.walk(node):
            if is_call_to(n, "Depends", "Security"):
                target = n.args[0] if n.args else next(
                    (kw.value for kw in n.keywords if kw.arg == "dependency"), None)
                if target is not None:
                    yield module, target
            elif isinstance(n, ast.Name) and n.id not in seen_assign:
                ref = repo.lookup(module, n.id)
                if ref and ref[0] == "fp" and isinstance(ref[2], (ast.Assign, ast.AnnAssign)):
                    seen_assign.add(n.id)
                    value = ref[2].value
                    if value is not None:
                        yield from depends_targets(ref[1], value, seen_assign)

    def function_of(module: Module, expr: ast.AST):
        ref = repo.resolve(module, expr)
        if ref and ref[0] == "fp" and isinstance(ref[2], (ast.FunctionDef, ast.AsyncFunctionDef)):
            return ref[1], ref[2]
        return None

    def signature_nodes(fn):
        a = fn.args
        return [*a.defaults, *[d for d in a.kw_defaults if d],
                *[x.annotation for x in [*a.args, *a.kwonlyargs, *a.posonlyargs] if x.annotation]]

    endpoints = []
    for module in repo.modules.values():
        for fn in ast.walk(module.tree):
            if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for dec in fn.decorator_list:
                    if (isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute)
                            and dec.func.attr in ROUTE_METHODS and module in fastapi_files):
                        endpoints.append((module, fn, dec))
                        break

    def caught_around(module, fn, node) -> frozenset:
        """Keys the `except` clauses of every try in fn whose body holds node catch."""
        out = set()
        for t in ast.walk(fn):
            if isinstance(t, ast.Try) and any(node is n for s in t.body for n in ast.walk(s)):
                for h in t.handlers:
                    types = (h.type.elts if isinstance(h.type, ast.Tuple) else [h.type]) if h.type else []
                    out |= {key(repo.resolve(module, x)) or "?" for x in types} or {"ext:BaseException"}
        return frozenset(out)

    def catches(caught, k) -> bool:
        return bool(caught & (set(an.mro(k)) | {"ext:Exception", "ext:BaseException"}))

    b_items, ext_raises = [], Counter()
    b_caught_by_caller = 0
    ring_files: set[Path] = set()
    for module, fn, dec in endpoints:
        # (module, function, depth, keys caught by try/except around the calls that led here)
        queue = [(module, fn, 0, frozenset())]
        for dm, target in depends_targets(module, dec):
            if (f := function_of(dm, target)):
                queue.append((*f, 1, frozenset()))
        seen = set()
        while queue:
            m, f, depth, caught = queue.pop()
            if (id(f), caught) in seen:
                continue
            seen.add((id(f), caught))
            ring_files.add(m.path)
            for n in ast.walk(f):
                if isinstance(n, ast.Raise) and n.exc is not None:
                    k = key(repo.resolve(m, n.exc))
                    if k is None:
                        continue
                    if k.startswith("ext:"):
                        if k[4:] not in DEFAULT_HANDLED:
                            ext_raises[k[4:]] += 1
                        continue
                    if not an.is_exception(k) or an.is_http(k) or catches(caught_around(m, f, n), k):
                        continue
                    if catches(caught, k):
                        b_caught_by_caller += 1
                        continue
                    b_items.append({
                        "class": k[3:], "at": line_of(m, n), "endpoint": line_of(module, fn),
                        "ring": depth, "handled_by": handled_by(k, True),
                        "handled_by_handler_only": handled_by(k, False),
                    })
                if depth < MAX_DEPTH and isinstance(n, ast.Call) and isinstance(n.func, ast.Name):
                    if (g := function_of(m, n.func)):
                        queue.append((*g, depth + 1, caught | caught_around(m, f, n)))
            if depth < MAX_DEPTH:
                for node in signature_nodes(f):
                    for dm, target in depends_targets(m, node):
                        if (g := function_of(dm, target)):
                            queue.append((*g, depth + 1, frozenset()))

    # --- D: yield dependencies that swallow ---
    dep_names = set()
    for module in repo.modules.values():
        for n in ast.walk(module.tree):
            if is_call_to(n, "Depends", "Security") and n.args:
                if (f := function_of(module, n.args[0])):
                    dep_names.add(id(f[1]))
    d_items = []
    yield_deps = yield_deps_except = 0
    for module in repo.modules.values():
        for fn in ast.walk(module.tree):
            if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            # Cross-check: any yield function in a FastAPI file that isn't a context manager.
            is_dep = id(fn) in dep_names
            if not is_dep and (module not in fastapi_files or any(
                    "contextmanager" in ast.unparse(d) or "fixture" in ast.unparse(d)
                    for d in fn.decorator_list)):
                continue
            if not any(isinstance(n, (ast.Yield, ast.YieldFrom)) for n in ast.walk(fn)):
                continue
            yield_deps += is_dep
            for t in ast.walk(fn):
                if isinstance(t, ast.Try) and any(isinstance(n, (ast.Yield, ast.YieldFrom))
                                                  for s in t.body for n in ast.walk(s)):
                    yield_deps_except += is_dep and bool(t.handlers)
                    for h in t.handlers:
                        if not has_raise(h.body):
                            d_items.append({"at": line_of(module, h), "fn": fn.name, "is_dep": is_dep,
                                            "catches": ast.unparse(h.type) if h.type else "(bare)"})

    return {
        "repo": root.name,
        "files": repo.files, "parse_errors": repo.parse_errors,
        "fastapi_files": len(fastapi_files),
        "exception_class_files": len({an.classes[k][0].path for k in declared}),
        "ring_files": len(ring_files),
        # Cost: files beyond the ones the FastAPI model already parses (those importing fastapi).
        "extra_files_A": len({an.classes[k][0].path for k in declared} - {m.path for m in fastapi_files}),
        "extra_files_B": len(ring_files - {m.path for m in fastapi_files}),
        "endpoints": len(endpoints),
        "apps": sum(1 for m in repo.modules.values() for n in ast.walk(m.tree) if is_call_to(n, "FastAPI")),
        "yield_deps": yield_deps, "yield_deps_except": yield_deps_except,
        "registrations": registrations, "splat_apps": splat_apps, "unresolved_registrations": unresolved,
        "handled": sorted(handled), "catch_all_handler": catch_all,
        "middleware_catch_all": mw_catch_all,
        "B_caught_by_caller": b_caught_by_caller,
        "A": a_items, "B": b_items, "C": mw_items, "D": d_items,
        "B_ext_raises": dict(ext_raises.most_common(10)),
    }


def summary(r: dict) -> dict:
    a = r["A"]
    un = [x for x in a if not x["handled_by"]]
    return {
        "repo": r["repo"], "files": r["files"], "apps": r["apps"], "endpoints": r["endpoints"],
        "regs": r["registrations"], "unres": r["unresolved_registrations"],
        "A_silent_unh": 0 if r["unresolved_registrations"] else len(un),
        "splat": r["splat_apps"],
        "catchall": "H" if r["catch_all_handler"] else ("M" if r["middleware_catch_all"] else "-"),
        "A_decl": len(a), "A_unh": len(un),
        "A_mod_unh": sum(x["exc_module"] for x in un),
        "A_mod_raised_unh": sum(x["exc_module"] and x["raised"] > 0 and not x["is_base"] for x in un),
        "A_mw_only": sum(1 for x in a if x["handled_by"] and not x["handled_by_handler_only"]),
        "A_strict_unh": sum(1 for x in a if x["handled_by"] in STRICT_MISS),
        "B_raises": len(r["B"]), "B_caller": r["B_caught_by_caller"],
        "B_unh": sum(1 for x in r["B"] if not x["handled_by"]),
        "B_strict_unh": sum(1 for x in r["B"] if x["handled_by"] in STRICT_MISS),
        "B_unh_classes": len({x["class"] for x in r["B"] if not x["handled_by"]}),
        "C": sum(1 for x in r["C"] if x["kind"] == "call_next"),
        "C_naive": sum(x["handles_naive"] for x in r["C"]),
        "C_handles": sum(x["handles"] for x in r["C"]),
        "C_asgi": sum(1 for x in r["C"] if x["kind"] == "asgi"),
        "yield_deps": r["yield_deps"], "yd_except": r["yield_deps_except"],
        "D": sum(x["is_dep"] for x in r["D"]), "D_any": len(r["D"]),
    }


def main() -> None:
    corpus = Path(sys.argv[1])
    results = [analyse(p) for p in sorted(corpus.iterdir()) if p.is_dir()]
    rows = [summary(r) for r in results]
    cols = list(rows[0])
    print("\t".join(cols))
    for row in rows:
        print("\t".join(str(row[c]) for c in cols))
    if "--json" in sys.argv:
        Path(sys.argv[sys.argv.index("--json") + 1]).write_text(json.dumps(results, indent=1))


if __name__ == "__main__":
    main()
