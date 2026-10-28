/**
 * The light server door (speed plan, owner 2026-10-27): the small reads the
 * root layout makes on every render — the settings record, the
 * first-launch check and the "What's new" check. Importing the full
 * `@/server` barrel for them loaded the whole server (agent engine, MCP,
 * extraction) on the first page load.
 * Allowed for src/app/ beside the two barrels (eslint.config.mjs). Keep it
 * this small: only modules that touch settings/token files.
 */
export { readSettings as readSettingsRecord } from "../store/settings.ts";
export { onboardingNeeded } from "./onboarding.ts";
export { whatsNewSince } from "./whats-new.ts";
