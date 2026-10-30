/**
 * GET /api/settings — THE user settings record: the whole delta record at
 * data/settings.json (config.
 * SETTINGS_FILE, via the SettingsStore port). Non-secret by construction —
 * secrets (the MCP access token) never enter this record.
 *
 *   GET → 200 {settings} (the sanitized delta record — absent keys mean
 *         "factory default", never guessed server-side) or 200
 *         {settings: null} on first boot.
 *
 * Section writes go through PUT /api/settings/[section].
 * Resolution to concrete values is the client's/core's job
 * (core/settings-resolution.ts resolveSettings — browser-safe).
 */

import { settingsStore } from "@/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json({ settings: settingsStore.readSettings() });
}
