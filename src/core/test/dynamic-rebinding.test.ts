import { describe, expect, test } from "bun:test";
import { found, unverifiable } from "./helpers.ts";

describe("INW011: a user-defined exec or eval is not a builtin with a computed source", () => {
  test.each([
    ["def eval", "def eval(model, loader):\n    pass\neval(model, val_loader)\n"],
    ["class exec", "class exec:\n    pass\nexec(job)\n"],
    ["from mylib import eval", "from mylib import eval\neval(model, loader)\n"],
    ["eval = make_evaluator()", "eval = make_evaluator()\neval(model)\n"],
    ["a parameter named exec", "def run(exec, job):\n    return exec(job)\n"],
    ["a typed parameter with a default", "def run(eval: Fn = None):\n    return eval(x)\n"],
    [
      "a parameter with a non-loader default",
      "def run(code, eval=default_eval):\n    return eval(code)\n",
    ],
    ["a lambda parameter", "f = lambda eval: eval(x)\n"],
    ["a for target", "for eval in evaluators:\n    eval(model)\n"],
    ["a tuple target", "eval, other = pick()\neval(model)\n"],
    ["a local in the calling function", "def f():\n    eval = pick()\n    return eval(model)\n"],
  ])("%s", (_, src) => {
    expect(found(src)).toEqual([]);
  });

  test("a literal source is still read after a rebinding (ADR-015)", () => {
    const src = 'def exec(src):\n    pass\nexec("import shop.infrastructure.db")\n';
    expect(found(src)).toEqual([["INW011", "shop.infrastructure.db"]]);
  });

  test("known gap: the builtin passed in as an argument", () => {
    expect(found("def run(exec, c):\n    return exec(c)\nrun(exec, code)\n")).toEqual([]);
  });
});

describe("INW011: rebindings that don't shadow the builtin at the call", () => {
  test.each([
    ["exec = exec", "exec = exec\nexec(code)\n"],
    ["eval = builtins.eval", "import builtins\neval = builtins.eval\neval(expr)\n"],
    ["getattr(builtins, ...)", 'import builtins\nexec = getattr(builtins, "exec")\nexec(code)\n'],
    ["a walrus to the builtin", "(exec := exec)\nexec(code)\n"],
    ["for over the builtin", "for exec in [exec]:\n    exec(code)\n"],
    ["a parameter of another function", "def _unused(exec):\n    pass\nexec(code)\n"],
    ["a for target outside its loop", "for eval in []:\n    pass\neval(expr)\n"],
    ["a parameter of another lambda", "_ = lambda exec: 0\nexec(code)\n"],
    ["a method parameter", "class C:\n    def m(self, exec):\n        pass\nexec(code)\n"],
    ["a method named eval", "class M:\n    def eval(self):\n        pass\neval(expr)\n"],
    ["global in another function", "def f():\n    global exec\n    exec = 1\nexec(code)\n"],
    ["a local of another function", "def f():\n    eval = 1\neval(expr)\n"],
    ["a deleted rebinding", "exec = 1\ndel exec\nexec(code)\n"],
    ["a binding after a module-level call", "exec(code)\ndef exec(src):\n    pass\n"],
    [
      "a relative import, which may re-export the builtin",
      "from .compat import exec\nexec(code)\n",
    ],
    [
      "exec = builtins.exec end to end",
      'import builtins\nexec = builtins.exec\nexec(f"import shop.{LAYER}.db")\n',
    ],
    [
      "compile rebound by a def",
      'import builtins\ndef compile(*_):\n    return builtins.compile(f"import shop.{LAYER}.db", "<x>", "exec")\nexec(compile("pass", "<s>", "exec"))\n',
    ],
    [
      "compile rebound by a lambda",
      'compile = lambda *a: code\nexec(compile("pass", "<s>", "exec"))\n',
    ],
    [
      "A: a loader-valued binding next to a clean def",
      "import builtins\ndef eval(x):\n    pass\neval = builtins.eval\neval(expr)\n",
    ],
    [
      "A: a loader-valued binding through nonlocal",
      "import builtins\ndef outer():\n    def eval(x):\n        pass\n    def inner():\n        nonlocal eval\n        eval = builtins.eval\n    inner()\n    return eval(expr)\n",
    ],
    [
      "B: a parameter default that is the builtin",
      "def run(code, exec=exec):\n    return exec(code)\n",
    ],
    ["B: a lambda default that is the builtin", "(lambda exec=exec: exec(code))()\n"],
    ["C: a call in a parameter default", "def f(y=exec(code)):\n    exec = 1\n"],
    ["D: a binding under if False", "if False:\n    exec = print\nexec(code)\n"],
    [
      "D: an import that may fail",
      "try:\n    from nonexistent import exec\nexcept ImportError:\n    pass\nexec(code)\n",
    ],
    [
      "D: global with a conditional assignment",
      "def setup(flag):\n    global eval\n    if flag:\n        eval = print\ndef run():\n    return eval(expr)\n",
    ],
    [
      "E: a module-level binding after the call ran",
      "def g():\n    return exec(code)\ng()\nexec = print\n",
    ],
    [
      "E: a def after the function that calls it",
      "def main():\n    eval(model)\ndef eval(m):\n    pass\n",
    ],
  ])("%s is still reported", (_, src) => {
    expect(unverifiable(src)).toEqual(["unverifiable"]);
  });
});

describe("INW011: accepted false positives of the conservative exemption", () => {
  test.each([
    ["a comprehension variable", "[eval(m) for eval in evaluators]\n"],
    [
      "a method name used in its class body",
      "class M:\n    def eval(self, x):\n        pass\n    result = eval(1, 2)\n",
    ],
    ["a match capture", "match evaluator:\n    case eval:\n        eval(model)\n"],
  ])("%s is reported", (_, src) => {
    expect(unverifiable(src)).toEqual(["unverifiable"]);
  });
});
