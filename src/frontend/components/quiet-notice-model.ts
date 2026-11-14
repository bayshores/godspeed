/**
 * The "no new files" notice: a space with a linked folder that brought no
 * new file for QUIET_DAYS, so its material may be out of date.
 * Closing it snoozes it for another QUIET_DAYS.
 */
import type { SpaceSummary } from "@/shared/core";

const QUIET_DAYS = 4;
const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface QuietSpace {
	spaceId: string;
	name: string;
	folder: string;
	/** When the newest folder file arrived. */
	lastAt: string;
}

/** Spaces whose linked folder has been quiet for QUIET_DAYS and that
 *  aren't snoozed (`snoozedUntil`: space id → ms time). */
export function quietSpaces(spaces: readonly SpaceSummary[], snoozedUntil: Readonly<Record<string, number>>, now: number): QuietSpace[] {
	return spaces.flatMap((c) => {
		if (c.closed || !c.linkedFolder || !c.lastFolderFileAt) return [];
		if (now - Date.parse(c.lastFolderFileAt) < QUIET_DAYS * DAY_MS || (snoozedUntil[c.id] ?? 0) > now) return [];
		return [{ spaceId: c.id, name: c.name, folder: c.linkedFolder, lastAt: c.lastFolderFileAt }];
	});
}

/** When a notice closed now shows again. */
export function snoozeEnd(now: number): number {
	return now + QUIET_DAYS * DAY_MS;
}

/** "No new files in CSE 29 for 4 days". */
export function quietTitle(entry: QuietSpace, now: number): string {
	const days = Math.floor((now - Date.parse(entry.lastAt)) / DAY_MS);
	return `No new files in ${entry.name} for ${days} days`;
}

/** "Last one came Sun, Nov 2." */
export function quietLine(entry: QuietSpace): string {
	const at = new Date(entry.lastAt);
	return `Last one came ${WEEKDAYS[at.getDay()]}, ${MONTHS[at.getMonth()]} ${at.getDate()}.`;
}
