/**
 * The light server door: the small reads the
 * root layout makes on every render — the settings record, the
 * first-launch check, the "What's new" check and the welcome check.
 * Importing the full `@/server` barrel for them loaded the whole server
 * (agent engine, MCP, extraction) on the first page load.
 * Allowed for src/app/ beside the two barrels (eslint.config.mjs). Keep it
 * this small: only modules with no heavy imports.
 */
export { readSettings as readSettingsRecord } from "../store/settings.ts";
export { onboardingNeeded } from "./onboarding.ts";
export { firstLoadScreen } from "./welcome.ts";
export { whatsNewSince } from "./whats-new.ts";
