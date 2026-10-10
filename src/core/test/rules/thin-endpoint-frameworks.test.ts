/**
 * @file INW012 `thin-endpoint` beyond FastAPI (#270): Flask routes, views
 * and `add_url_rule`, Litestar handlers and `Controller` methods, Django
 * class-based views, DRF's `@api_view`, `APIView`, generic views, ViewSet
 * actions and `@action`, and Django `path()` registrations are endpoints.
 * A function with the same body that none of them marks reports nothing,
 * `frameworks` picks the recognisers, `base-classes` adds in-house view
 * bases, and a view base from another first-party module is followed.
 */
import { describe, expect, test } from "bun:test";
import type { Diagnostic } from "../../src/index.ts";
import { Engine, parseConfig } from "../../src/index.ts";
import { file, grammars, indexOn } from "../support/helpers.ts";

/** The endpoint's name a finding's message opens with. */
const QUOTED_NAME = /^`(?<name>[^`]+)`/u;

const CONFIG = `[tool.inwards]
layers = [
  { name = "application", modules = ["shop.application"] },
  { name = "api", modules = ["shop.api"] },
]

[tool.inwards.rules]
extend-select = ["INW012"]
`;

/** A body that trips a loop and a denied call, indented for a method. */
const BODY = `
        rows = requests.get("https://example.com/orders").json()
        total = 0
        for row in rows:
            total += row["total"]
        return {"total": total}
`;

/**
 * Writes a function with the fat body, at module level or in a class.
 *
 * @param head - the `def` line with its decorators, e.g. `def a():`.
 * @param indent - the indent of the `def` line.
 * @returns the function's source.
 */
function fat(head: string, indent = ""): string {
  const body = BODY.split("\n")
    .map((line) => (line === "" ? line : `${indent}${line.slice(4)}`))
    .join("\n");
  return `${head
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n")}${body}`;
}

/**
 * Checks some files together with INW012 on and names the endpoints it reports.
 *
 * @param files - each file's text by path; the first one is the one checked.
 * @param options - the `[tool.inwards.rules.thin-endpoint]` body, TOML.
 * @returns `path:line name` for each INW012 finding, the name as the message quotes it.
 */
async function reported(files: Record<string, string>, options = ""): Promise<string[]> {
  const table = options === "" ? "" : `[tool.inwards.rules.thin-endpoint]\n${options}\n`;
  const engine = await Engine.create(grammars(), parseConfig(`${CONFIG}${table}`));
  const texts = new Map(Object.entries(files));
  const disk = new Map<string, "file" | "dir">([
    ["shop", "dir"],
    ["shop/__init__.py", "file"],
    ["shop/api", "dir"],
    ["shop/api/__init__.py", "file"],
    ...[...texts.keys()].map((path): [string, "file"] => [path, "file"]),
  ]);
  const [checked = ""] = Object.keys(files);
  return engine
    .checkFiles([file(checked, texts.get(checked) ?? "")], indexOn(disk, texts))
    .filter((d) => d.code === "INW012")
    .map((d) => `${d.file}:${d.line} ${QUOTED_NAME.exec(d.message)?.groups?.["name"]}`);
}

/**
 * Checks one file, `shop/api/views.py`.
 *
 * @param text - the file's text.
 * @param options - the `[tool.inwards.rules.thin-endpoint]` body, TOML.
 * @returns `line name` for each INW012 finding.
 */
async function names(text: string, options = ""): Promise<string[]> {
  const found = await reported({ "shop/api/views.py": text }, options);
  return found.map((f) => f.replace("shop/api/views.py:", ""));
}

/**
 * Checks `shop/api/views.py` alone with INW012 on.
 *
 * @param text - the file's text.
 * @returns every diagnostic.
 */
async function checkOne(text: string): Promise<Diagnostic[]> {
  const engine = await Engine.create(grammars(), parseConfig(CONFIG));
  const path = "shop/api/views.py";
  return engine.checkFiles(
    [file(path, text)],
    indexOn(new Map([[path, "file"]]), new Map([[path, text]])),
  );
}

/**
 * Finds a function's `def` line in a text.
 *
 * @param text - the file's text.
 * @param def - the start of the line, e.g. `def a(`.
 * @returns its 1-based line number.
 */
function lineOf(text: string, def: string): number {
  return text.split("\n").findIndex((line) => line.trimStart().startsWith(def)) + 1;
}

const FLASK = `import requests
from flask import Blueprint, Flask, abort
from flask.views import MethodView, View

app = Flask(__name__)
bp = Blueprint("orders", __name__)


${fat('@app.route("/a")\ndef a():')}

${fat('@bp.post("/b")\ndef b():')}

${fat("def c():")}

app.add_url_rule("/c", "c", c)

${fat("def d():")}

bp.add_url_rule("/d", view_func=d)


class Orders(MethodView):
${fat("def get(self):", "    ")}
${fat("def _load(self):", "    ")}

class Legacy(View):
${fat("def dispatch_request(self):", "    ")}

${fat("def plain():")}
`;

const LITESTAR = `import requests
from litestar import Controller, get, post, websocket
from litestar.handlers import route


${fat('@get("/a")\nasync def a() -> dict:')}

${fat('@route("/r", http_method=["GET", "POST"])\nasync def r() -> dict:')}


class Orders(Controller):
    path = "/orders"

${fat("@post()\nasync def create(self) -> dict:", "    ")}
${fat("async def total_of(self) -> dict:", "    ")}

${fat('@websocket("/ws")\nasync def ws(socket) -> None:')}

${fat("async def plain() -> dict:")}
`;

const DRF = `import requests
from django.views import View
from rest_framework import generics, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.views import APIView


${fat('@api_view(["GET"])\ndef a(request):')}


class Orders(APIView):
${fat("def get(self, request):", "    ")}
${fat("def check_permissions(self, request):", "    ")}

class OrderSet(viewsets.ModelViewSet):
${fat("def list(self, request):", "    ")}
${fat("def partial_update(self, request, pk=None):", "    ")}
${fat('@action(detail=True, methods=["post"])\ndef refund(self, request, pk=None):', "    ")}
${fat("def get_queryset(self):", "    ")}

class Page(View):
${fat("def post(self, request):", "    ")}

class Base(generics.GenericAPIView):
    pass


class Detail(Base):
${fat("def delete(self, request, pk):", "    ")}

${fat("def plain(request):")}
`;

describe("INW012 for Flask, Litestar and Django", () => {
  test("Flask: routes, add_url_rule, MethodView and View methods report; a plain function doesn't", async () => {
    expect(await names(FLASK)).toEqual([
      `${lineOf(FLASK, "def a(")} a`,
      `${lineOf(FLASK, "def b(")} b`,
      `${lineOf(FLASK, "def c(")} c`,
      `${lineOf(FLASK, "def d(")} d`,
      `${lineOf(FLASK, "def get(")} Orders.get`,
      `${lineOf(FLASK, "def dispatch_request(")} Legacy.dispatch_request`,
    ]);
  });

  test("Litestar: handlers and Controller handlers report; websockets, plain methods and functions don't", async () => {
    expect(await names(LITESTAR)).toEqual([
      `${lineOf(LITESTAR, "async def a(")} a`,
      `${lineOf(LITESTAR, "async def r(")} r`,
      `${lineOf(LITESTAR, "async def create(")} Orders.create`,
    ]);
  });

  test("Django and DRF: api_view, view methods, ViewSet actions and @action report; hooks and plain functions don't", async () => {
    expect(await names(DRF)).toEqual([
      `${lineOf(DRF, "def a(")} a`,
      `${lineOf(DRF, "def get(")} Orders.get`,
      `${lineOf(DRF, "def list(")} OrderSet.list`,
      `${lineOf(DRF, "def partial_update(")} OrderSet.partial_update`,
      `${lineOf(DRF, "def refund(")} OrderSet.refund`,
      `${lineOf(DRF, "def post(")} Page.post`,
      `${lineOf(DRF, "def delete(")} Detail.delete`,
    ]);
  });

  test("a plain Django function view counts only in the modules `modules` names", async () => {
    const found = await names(DRF, 'modules = ["shop.api.views"]');
    expect(found).toContain(`${lineOf(DRF, "def plain(")} plain`);
    expect(found).toHaveLength(8);
  });

  test("a path() in urls.py reports a function view in another module on the registration", async () => {
    const urls = `from django.urls import path

from shop.api import views

urlpatterns = [path("orders/", views.orders, name="orders")]
`;
    const views = `import requests\n\n\n${fat("def orders(request):")}`;
    expect(await reported({ "shop/api/urls.py": urls, "shop/api/views.py": views })).toEqual([
      "shop/api/urls.py:5 orders",
    ]);
  });

  test("the message and fix speak the endpoint's framework", async () => {
    const [flask] = await checkOne(FLASK);
    expect(flask?.message).toStartWith(
      "`a` is an HTTP endpoint with 1 loop over data and a direct call to `requests.get`.",
    );
    expect(flask?.fix?.steps).toContain(
      "In the endpoint keep only: read the request, call the use case, map its errors to HTTP errors with `abort()`, and return the response.",
    );
    const [drf] = await checkOne(DRF);
    expect(drf?.fix?.steps).toContain(
      "In the endpoint keep only: read the request, call the use case, map its errors to HTTP errors (`Http404`, or an `APIException` in DRF), and return the response.",
    );
  });

  test("Django's raw connection is a denied call; a model manager call is not", async () => {
    const text = `from django.db import connection
from rest_framework.decorators import api_view

from shop.api.models import Order


@api_view(["GET"])
def a(request):
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")
    return Order.objects.filter(open=True)
`;
    const [found] = await checkOne(text);
    expect(found?.message).toStartWith(
      "`a` is an HTTP endpoint with a direct call to `connection.cursor`.",
    );
  });

  test("guards that abort or raise an HTTP error don't count", async () => {
    const text = `from django.http import Http404
from flask import abort
from rest_framework.exceptions import NotFound
from rest_framework.decorators import api_view


@api_view(["GET"])
def a(request, order):
    if order is None:
        abort(404)
    if order.hidden:
        raise NotFound()
    if order.gone:
        raise Http404("gone")
    return order
`;
    expect(await names(text, "max-statements = 1\nmax-branches = 0")).toEqual([]);
  });

  test("frameworks picks the recognisers: flask alone leaves FastAPI routes out", async () => {
    const text = `import requests
from fastapi import APIRouter
from flask import Blueprint

router = APIRouter()
bp = Blueprint("x", __name__)


${fat('@router.get("/f")\ndef f():')}

${fat('@bp.get("/g")\ndef g():')}
`;
    expect(await names(text)).toEqual([
      `${lineOf(text, "def f(")} f`,
      `${lineOf(text, "def g(")} g`,
    ]);
    expect(await names(text, 'frameworks = ["flask"]')).toEqual([`${lineOf(text, "def g(")} g`]);
    expect(await names(text, 'frameworks = ["litestar"]')).toEqual([]);
  });

  test("base-classes marks an in-house view base, even in a file that names no framework", async () => {
    const text = `import requests

from shop.http import Resource


class Orders(Resource):
${fat("def get(self):", "    ")}`;
    expect(await names(text)).toEqual([]);
    expect(await names(text, 'base-classes = ["shop.http.Resource"]')).toEqual([
      `${lineOf(text, "def get(")} Orders.get`,
    ]);
  });

  test("a view base defined in another first-party module is followed", async () => {
    const base = `from rest_framework.views import APIView


class BaseView(APIView):
    permission_classes = []


class Plain:
    pass
`;
    const views = `import requests
from rest_framework.response import Response

from shop.api.base import BaseView, Plain


class Orders(BaseView):
${fat("def get(self, request):", "    ")}

class Other(Plain):
${fat("def get(self, request):", "    ")}`;
    expect(await reported({ "shop/api/views.py": views, "shop/api/base.py": base })).toEqual([
      `shop/api/views.py:${lineOf(views, "def get(")} Orders.get`,
    ]);
  });
});
