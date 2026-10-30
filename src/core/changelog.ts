/**
 * THE CHANGELOG: src/changelog.json lists each
 * release's changes, newest first. The app shows them in the "What's new"
 * dialog after an update, and the release workflow copies the tag's entry
 * into the GitHub release page, so both always say the same thing.
 */
import entries from "../changelog.json";

export interface ChangelogEntry {
	/** "0.4.1" — matches package.json and the release tag (minus the v). */
	version: string;
	/** "2026-10-27" */
	date: string;
	/** One plain-language sentence per change. */
	changes: string[];
}

export const CHANGELOG: readonly ChangelogEntry[] = entries;

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

export function isVersion(value: unknown): value is string {
	return typeof value === "string" && VERSION.test(value);
}

/** Negative when a is older than b, 0 when equal, positive when newer.
 *  Anything that isn't "x.y.z" sorts as oldest. */
export function compareVersions(a: string, b: string): number {
	const pa = VERSION.exec(a);
	const pb = VERSION.exec(b);
	if (!pa || !pb) return (pa ? 1 : 0) - (pb ? 1 : 0);
	for (let i = 1; i <= 3; i++) {
		const diff = Number(pa[i]) - Number(pb[i]);
		if (diff !== 0) return diff;
	}
	return 0;
}

/** The entries newer than `since` and no newer than `current`, newest
 *  first: every version someone skipped over, up to the one they run. */
export function entriesSince(since: string, current: string, all: readonly ChangelogEntry[] = CHANGELOG): ChangelogEntry[] {
	return all
		.filter((e) => compareVersions(e.version, since) > 0 && compareVersions(e.version, current) <= 0)
		.sort((a, b) => compareVersions(b.version, a.version));
}

export function entryFor(version: string, all: readonly ChangelogEntry[] = CHANGELOG): ChangelogEntry | null {
	return all.find((e) => e.version === version) ?? null;
}
