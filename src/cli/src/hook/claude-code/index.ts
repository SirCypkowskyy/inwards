/**
 * @file The Claude Code hook adapter's public face: the event dispatcher
 * `cli.ts` calls, and the pieces of the settings check and the OpenCode
 * plugin marker that `init/` reads to wire an agent. Re-exports only.
 */
export { dispatch } from "./_dispatch.ts";
export { PLUGIN_MARKER } from "./_hook-host.ts";
export { holdsInwardsHooks, INWARDS_BINARY, isInwardsHook, LAUNCHER } from "./_settings.ts";
