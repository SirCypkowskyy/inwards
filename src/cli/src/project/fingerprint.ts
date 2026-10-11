/**
 * @file The identity of a violation across hook runs and sessions: same rule, same
 * module, same message (which names the offending import target), hashed
 * short. The session log, escalation and the run log count repeats by it.
 * Pure: hashing only.
 */
import { createHash } from "node:crypto";
import type { Diagnostic } from "@inwards/core";

/** Hex digits kept from a fingerprint's SHA-256: 64 bits is plenty for one session. */
const FINGERPRINT_LENGTH = 16;

/**
 * Identifies a violation across hook runs: same rule, same module, same message
 * (which names the offending import target).
 *
 * @param d - a diagnostic.
 * @returns a short stable hash.
 */
export function fingerprint(d: Diagnostic): string {
  return createHash("sha256")
    .update(`${d.code}\u0000${d.module}\u0000${d.message}`)
    .digest("hex")
    .slice(0, FINGERPRINT_LENGTH);
}
