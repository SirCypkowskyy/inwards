/**
 * @file Reads an HTTP status code out of a `Value`, as FAPI001 and FAPI002 see
 * one: an int literal, a `status.HTTP_404_NOT_FOUND` constant from FastAPI or
 * Starlette, an `http.HTTPStatus` member, or a first-party module-level
 * constant holding one of those. Anything else is unknown, and the rules stay
 * quiet about it. Names are resolved by the caller's lookup; nothing here
 * reads a file.
 */
import type { Value } from "./values.ts";

/** A status constant such as `HTTP_404_NOT_FOUND`, which spells its code. */
const STATUS_NAME = /^HTTP_(?<code>\d{3})(?:_|$)/u;

/** The modules whose `HTTP_*` constants spell their code. */
const STATUS_MODULES: ReadonlySet<string> = new Set(["fastapi.status", "starlette.status"]);

/** `http.HTTPStatus` members FastAPI apps use, by name: the 4xx and 5xx ones, and 201 and 204. */
const HTTP_STATUS: ReadonlyMap<string, number> = new Map([
  ["CREATED", 201],
  ["NO_CONTENT", 204],
  ["BAD_REQUEST", 400],
  ["UNAUTHORIZED", 401],
  ["PAYMENT_REQUIRED", 402],
  ["FORBIDDEN", 403],
  ["NOT_FOUND", 404],
  ["METHOD_NOT_ALLOWED", 405],
  ["NOT_ACCEPTABLE", 406],
  ["PROXY_AUTHENTICATION_REQUIRED", 407],
  ["REQUEST_TIMEOUT", 408],
  ["CONFLICT", 409],
  ["GONE", 410],
  ["LENGTH_REQUIRED", 411],
  ["PRECONDITION_FAILED", 412],
  ["REQUEST_ENTITY_TOO_LARGE", 413],
  ["CONTENT_TOO_LARGE", 413],
  ["REQUEST_URI_TOO_LONG", 414],
  ["URI_TOO_LONG", 414],
  ["UNSUPPORTED_MEDIA_TYPE", 415],
  ["REQUESTED_RANGE_NOT_SATISFIABLE", 416],
  ["RANGE_NOT_SATISFIABLE", 416],
  ["EXPECTATION_FAILED", 417],
  ["IM_A_TEAPOT", 418],
  ["MISDIRECTED_REQUEST", 421],
  ["UNPROCESSABLE_ENTITY", 422],
  ["UNPROCESSABLE_CONTENT", 422],
  ["LOCKED", 423],
  ["FAILED_DEPENDENCY", 424],
  ["TOO_EARLY", 425],
  ["UPGRADE_REQUIRED", 426],
  ["PRECONDITION_REQUIRED", 428],
  ["TOO_MANY_REQUESTS", 429],
  ["REQUEST_HEADER_FIELDS_TOO_LARGE", 431],
  ["UNAVAILABLE_FOR_LEGAL_REASONS", 451],
  ["INTERNAL_SERVER_ERROR", 500],
  ["NOT_IMPLEMENTED", 501],
  ["BAD_GATEWAY", 502],
  ["SERVICE_UNAVAILABLE", 503],
  ["GATEWAY_TIMEOUT", 504],
  ["HTTP_VERSION_NOT_SUPPORTED", 505],
  ["VARIANT_ALSO_NEGOTIATES", 506],
  ["INSUFFICIENT_STORAGE", 507],
  ["LOOP_DETECTED", 508],
  ["NOT_EXTENDED", 510],
  ["NETWORK_AUTHENTICATION_REQUIRED", 511],
]);

/** Finds the value a first-party module-level constant holds, or null when the name isn't one. */
export type ConstantLookup = (qualified: string) => Value | null;

/** How many constants `statusCode` follows (`A = B`, `B = 404`) before it gives up. */
const MAX_HOPS = 4;

/**
 * Reads a status code.
 *
 * @param value - the expression, as the model reads it.
 * @param constant - finds a first-party constant's value.
 * @returns the code, or null when it isn't one of the spellings above.
 */
export function statusCode(value: Value, constant: ConstantLookup): number | null {
  let current = value;
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    if (current.kind === "int") {
      return current.value;
    }
    if (current.kind !== "name") {
      return null;
    }
    const known = namedCode(current.name);
    const next = known === null ? constant(current.name) : null;
    if (known !== null || next === null) {
      return known;
    }
    current = next;
  }
  return null;
}

/**
 * Reads a status constant that spells its code.
 *
 * @param qualified - a qualified name.
 * @returns the code for `fastapi.status.HTTP_*`, `starlette.status.HTTP_*`
 *   or an `http.HTTPStatus` member, else null.
 */
function namedCode(qualified: string): number | null {
  const dot = qualified.lastIndexOf(".");
  const owner = qualified.slice(0, dot);
  const member = qualified.slice(dot + 1);
  const spelled = STATUS_MODULES.has(owner)
    ? STATUS_NAME.exec(member)?.groups?.["code"]
    : undefined;
  if (spelled !== undefined) {
    return Number(spelled);
  }
  return owner === "http.HTTPStatus" ? (HTTP_STATUS.get(member) ?? null) : null;
}
