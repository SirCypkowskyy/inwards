/**
 * @file The daemon's request loop (ADR-039): read one line from each
 * connection, answer the lines one at a time in arrival order, and stop when
 * the handler says so, after the idle limit, or on SIGINT or SIGTERM. Parallel
 * tool calls write the same session state, so requests never overlap. What a
 * line means is the handler's (`daemon/server.ts`); `daemon-host.ts` owns
 * the server and the files around it.
 */
import type { Server, Socket } from "node:net";
import process from "node:process";
import type { LineHandler } from "../daemon/contracts.ts";
import { MAX_REQUEST_BYTES } from "../daemon/protocol.ts";

/** How long a connection may take to send its request line. */
const LINE_MS = 10_000;

/** Answers request lines one at a time until it is told to stop or goes idle. */
export class RequestLoop {
  readonly #handler: LineHandler;
  readonly #idleMs: number;
  #queue: Promise<void> = Promise.resolve();
  #pending = 0;
  #stopping = false;
  /** The idle limit passed before `run` started; `run` stops at once. */
  #expired = false;
  #idle: ReturnType<typeof setTimeout>;
  #stop: () => void = () => {
    this.#expired = true;
  };
  /** Connections that haven't sent a whole line yet, closed when the loop stops. */
  readonly #waiting = new Set<Socket>();

  /**
   * Starts the idle clock.
   *
   * @param handler - answers request lines.
   * @param idleMs - how long to wait for a request before stopping.
   */
  constructor(handler: LineHandler, idleMs: number) {
    this.#handler = handler;
    this.#idleMs = idleMs;
    this.#idle = setTimeout(() => this.#stop(), idleMs);
  }

  /**
   * Reads one request line from a new connection and queues it; bound, so it
   * can be passed to `createServer`.
   *
   * @param socket - the connection.
   */
  readonly accept = (socket: Socket): void => {
    if (this.#stopping) {
      socket.destroy();
      return;
    }
    this.#waiting.add(socket);
    readLine(socket, this.#handler.tooLarge, (request: string) => {
      this.#waiting.delete(socket);
      this.#enqueue(socket, request);
    });
  };

  /**
   * Waits until the handler says stop, the idle limit passes or a signal
   * arrives, then closes the server.
   *
   * @param server - the listening server.
   * @returns once the server is closed.
   */
  run(server: Server): Promise<void> {
    return new Promise((resolve) => {
      /** Stops accepting connections; resolves once the open ones are closed. */
      const stop = (): void => {
        if (this.#stopping) {
          return;
        }
        this.#stopping = true;
        clearTimeout(this.#idle);
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
        server.close(() => resolve());
        for (const socket of this.#waiting) {
          socket.destroy();
        }
      };
      this.#stop = stop;
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      if (this.#expired) {
        stop();
      }
    });
  }

  /**
   * Queues a request behind the ones before it.
   *
   * @param socket - the connection to answer on.
   * @param request - the line, without its newline.
   */
  #enqueue(socket: Socket, request: string): void {
    this.#pending += 1;
    clearTimeout(this.#idle);
    this.#queue = this.#queue.then(() => this.#answer(socket, request));
  }

  /**
   * Answers one request, then stops, or restarts the idle clock when nothing waits.
   *
   * @param socket - the connection to answer on.
   * @param request - the line, without its newline.
   * @returns once the answer is sent.
   */
  async #answer(socket: Socket, request: string): Promise<void> {
    const { answer, stop } = await this.#handler
      .handle(request)
      .catch(() => ({ answer: "", stop: false }));
    await new Promise<void>((sent) => {
      socket.end(answer, () => sent());
    });
    this.#pending -= 1;
    if (stop) {
      this.#stop();
    } else if (this.#pending === 0 && !this.#stopping) {
      this.#idle = setTimeout(() => this.#stop(), this.#idleMs);
    }
  }
}

/**
 * Reads one line from a connection. A connection that sends nothing for
 * `LINE_MS` is closed, and one whose line grows past `MAX_REQUEST_BYTES` gets
 * the too-large answer.
 *
 * @param socket - the connection.
 * @param tooLarge - the answer to an oversized request.
 * @param take - called once with the line, without its newline.
 */
function readLine(socket: Socket, tooLarge: string, take: (request: string) => void): void {
  let buffer = "";
  let taken = false;
  socket.setEncoding("utf8");
  socket.setTimeout(LINE_MS, () => {
    if (!taken) {
      socket.destroy();
    }
  });
  socket.on("error", () => undefined);
  socket.on("data", (chunk: string) => {
    if (taken) {
      return;
    }
    buffer += chunk;
    const end = buffer.indexOf("\n");
    if (end >= 0) {
      taken = true;
      socket.setTimeout(0);
      take(buffer.slice(0, end));
    } else if (buffer.length > MAX_REQUEST_BYTES) {
      taken = true;
      socket.end(tooLarge);
    }
  });
}
