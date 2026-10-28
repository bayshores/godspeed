/**
 * The light server door (speed plan, owner 2026-10-27): the settings reader
 * alone, for pages that need one setting at render time. Importing the full
 * `@/src/server` barrel for that loaded the whole server (agent engine, MCP,
 * extraction) on the first page load. Allowed for app/ beside the two
 * barrels (eslint.config.mjs). Keep it this small.
 */
export { readSettings as readSettingsRecord } from "../store/settings.ts";
