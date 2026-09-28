/**
 * @file FAPI003 `router-wiring` (#184) in the agent loop. Creating a router and
 * wiring it into the app are two edits, so the PostToolUse hook doesn't
 * block on a router nothing includes yet; the Stop gate does if it is still
 * unmounted at the end of the session, and a router that was already
 * unmounted when the session started doesn't block.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { inwards, payload, type RunResult } from "../support/run.ts";
import { ID, put, session, stop } from "../support/stop-helpers.ts";

const PYPROJECT = `[tool.inwards]
layers = [{ name = "app", modules = ["app"] }]

[tool.inwards.rules]
extend-select = ["FAPI003"]
`;

const MAIN = `from fastapi import FastAPI

from app.orders import router as orders

app = FastAPI()
app.include_router(orders.router)
`;

/**
 * Writes a router module with one path operation per name.
 *
 * @param names - the operations' function names.
 * @returns the module's source.
 */
function routes(...names: string[]): string {
  const ops = names.map((n) => `\n\n@router.get("/${n}")\nasync def ${n}(): ...\n`).join("");
  return `from fastapi import APIRouter\n\nrouter = APIRouter()\n${ops}`;
}

const PROJECT: Record<string, string> = {
  "pyproject.toml": PYPROJECT,
  "app/__init__.py": "",
  "app/main.py": MAIN,
  "app/orders/__init__.py": "",
  "app/orders/router.py": routes("orders"),
};

/**
 * Writes a file the way an agent's Write tool does and sends PostToolUse.
 *
 * @param root - the project directory.
 * @param rel - the file, relative to the project.
 * @param text - the new content.
 * @returns the hook's exit code and output.
 */
function write(root: string, rel: string, text: string): RunResult {
  put(root, rel, text);
  const stdin = payload("post-write-order", root, {
    session_id: ID,
    tool_input: { file_path: join(root, rel) },
  });
  return inwards(["hook", "claude-code"], { cwd: root, stdin });
}

describe("FAPI003 in the hooks", () => {
  test("a new router doesn't block its edit, blocks at Stop while unmounted, and passes once wired", () => {
    const root = session(PROJECT);
    const created = write(root, "app/invoices/router.py", routes("invoices"));
    expect(created.code).toBe(0);
    expect(created.stdout).not.toContain("FAPI003");
    write(root, "app/invoices/__init__.py", "");

    const blocked = stop(root);
    expect(blocked.code).toBe(2);
    expect(blocked.stderr).toContain('"code":"FAPI003"');
    expect(blocked.stderr).toContain(
      "APIRouter `app.invoices.router.router` has path operations, but no app includes it",
    );

    const wired = MAIN.replace(
      "from app.orders import router as orders\n",
      "from app.invoices import router as invoices\nfrom app.orders import router as orders\n",
    ).concat("app.include_router(invoices.router)\n");
    expect(write(root, "app/main.py", wired).code).toBe(0);
    expect(stop(root).code).toBe(0);
  });

  test("a router already unmounted at session start doesn't block when the agent edits it", () => {
    const root = session({ ...PROJECT, "app/legacy.py": routes("old") });
    expect(write(root, "app/legacy.py", routes("old", "older")).code).toBe(0);
    expect(stop(root).code).toBe(0);
  });

  test("an include_router above the router's routes blocks the edit", () => {
    const root = session(PROJECT);
    const early = `from fastapi import FastAPI, APIRouter\n\napp = FastAPI()\nrouter = APIRouter()\napp.include_router(router)\n\n\n@router.get("/late")\nasync def late(): ...\n`;
    const posted = write(root, "app/early.py", early);
    expect(posted.code).toBe(2);
    expect(posted.stderr).toContain('"code":"FAPI003"');
  });
});
