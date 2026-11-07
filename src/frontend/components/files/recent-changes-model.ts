/**
 * The Files page's Recent changes: files added or removed in the last
 * RECENT_CHANGE_DAYS, newest first, and the summary's "2 removed". Files
 * that came with linking the folder are not changes.
 */
import { isRecent, isRecentChange, type ClassFile, type RemovedFile } from "@/shared/core";

export interface RecentChange {
	change: "added" | "removed";
	id: string;
	name: string;
	at: string;
}

export function recentChanges(files: readonly ClassFile[], removed: readonly RemovedFile[], now: number): RecentChange[] {
	const added = files
		.filter((f) => (f.foundByScan || f.origin === "copied") && isRecentChange(f.addedAt, now))
		.map((f): RecentChange => ({ change: "added", id: f.id, name: f.name, at: f.addedAt }));
	const gone = removed.filter((r) => isRecentChange(r.at, now)).map((r): RecentChange => ({ change: "removed", ...r }));
	return [...added, ...gone].sort((a, b) => b.at.localeCompare(a.at));
}

/** "2 removed" (in the days new files count as new), null when none. */
export function removedLately(removed: readonly RemovedFile[], now: number): string | null {
	const n = removed.filter((r) => isRecent(r.at, now)).length;
	return n > 0 ? `${n} removed` : null;
}

/** The change's local day as YYYY-MM-DD (for shortDate). */
export function changeDay(at: string): string {
	const d = new Date(at);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
