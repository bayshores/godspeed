/**
 * FIRST-LAUNCH ONBOARDING — who sees it. The root
 * layout asks on every page load; the answer lives in settings.json as
 * general.onboarded:
 *  - true  → done (finished, or an existing user who skipped it);
 *  - false → in progress: shown until the learner finishes it;
 *  - absent → decided here, once: someone who already set up an outside
 *    agent (data/mcp-token exists — it used to need turning on) is an
 *    existing user and skips it; everyone else gets it.
 * The token is made AFTER that check (outside-agent access is always on),
 * so the check sees the state from before this version.
 */
import { readMcpToken, ensureMcpToken } from "../store/mcp-token.ts";
import { readSettings, writeSettings } from "../store/settings.ts";

export function onboardingNeeded(): boolean {
	const record = readSettings();
	let onboarded = record?.general?.onboarded;
	if (onboarded === undefined) {
		onboarded = readMcpToken() !== null;
		writeSettings({ ...(record ?? { version: 1 }), general: { ...(record?.general ?? {}), onboarded } });
	}
	ensureMcpToken();
	return !onboarded;
}
