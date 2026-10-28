/**
 * WHO SEES "WHAT'S NEW" (owner, 2026-10-27). The root layout asks on every
 * page load; the answer lives in settings.json as general.lastSeenVersion:
 *  - older than this version → show the notes since it, then record this
 *    version so they show once;
 *  - absent → a brand-new install records this version and shows nothing;
 *    an existing user (already onboarded) counts as coming from 0.4.0, the
 *    last version without these notes, so their first update shows them.
 */
import { compareVersions, isVersion } from "../core/changelog.ts";
import { readSettings, writeSettings } from "../store/settings.ts";

const BEFORE_WHATS_NEW = "0.4.0";

/** The version the learner last saw notes for, when this version has newer
 *  ones to show; null otherwise. */
export function whatsNewSince(current: string = process.env.LH_VERSION ?? ""): string | null {
	if (!isVersion(current)) return null;
	const record = readSettings();
	const general = record?.general ?? {};
	const recorded = isVersion(general.lastSeenVersion) ? general.lastSeenVersion : undefined;
	const since = recorded ?? (general.onboarded === true ? BEFORE_WHATS_NEW : current);
	if (recorded !== current) {
		writeSettings({ ...(record ?? { version: 1 }), general: { ...general, lastSeenVersion: current } });
	}
	return compareVersions(since, current) < 0 ? since : null;
}
