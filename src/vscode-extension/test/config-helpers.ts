import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type Harness, PYPROJECT, type Server, write } from "./lsp-harness.ts";

/** The last initialize request id handed out; each server gets a new one. */
let nextId = 100;

/** A config the rule table breaks: INW099 is no rule. */
export const UNKNOWN_CODE = `${PYPROJECT}\n[tool.inwards.rules]\nignore = ["INW099"]\n`;

/**
 * Starts a server on a project whose router imports a missing module, and
 * opens the router.
 *
 * @param harness - the test file's harness.
 * @param name - the project's directory under the test root.
 * @param pyproject - the config the project starts with.
 * @param capabilities - the client capabilities to announce.
 * @returns the server, the paths of the config and the router, and a way to
 *   rewrite the config and report the change as a client with watchers would.
 */
export async function openProject(
  harness: Harness,
  name: string,
  pyproject: string,
  capabilities: Record<string, unknown>,
): Promise<{
  server: Server;
  config: string;
  router: string;
  edit: (text: string) => void;
}> {
  const root = join(harness.tmp, name);
  write(root, {
    "pyproject.toml": pyproject,
    "app/__init__.py": "",
    "app/orders/__init__.py": "",
    "app/orders/router.py": "",
    "app/orders/service.py": "",
  });
  nextId += 1;
  const server = await harness.startServer(root, nextId, capabilities);
  const config = join(root, "pyproject.toml");
  const router = join(root, "app/orders/router.py");
  const textDocument = {
    uri: pathToFileURL(router).href,
    languageId: "python",
    version: 1,
    text: "import app.pricing\n",
  };
  server.send({ method: "textDocument/didOpen", params: { textDocument } });
  /**
   * Rewrites the config and reports it changed.
   *
   * @param text - the new pyproject.toml.
   */
  function edit(text: string): void {
    writeFileSync(config, text);
    const changes = [{ uri: pathToFileURL(config).href, type: 2 }];
    server.send({ method: "workspace/didChangeWatchedFiles", params: { changes } });
  }
  return { server, config, router, edit };
}
