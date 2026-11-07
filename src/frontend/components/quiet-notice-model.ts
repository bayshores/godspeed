/**
 * The "no new files" notice: a class with a linked folder that brought no
 * new file for QUIET_DAYS, so its course material may be out of date.
 * Closing it snoozes it for another QUIET_DAYS.
 */
import type { ClassSummary } from "@/shared/core";

const QUIET_DAYS = 4;
const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface QuietClass {
	classId: string;
	name: string;
	folder: string;
	/** When the newest folder file arrived. */
	lastAt: string;
}

/** Classes whose linked folder has been quiet for QUIET_DAYS and that
 *  aren't snoozed (`snoozedUntil`: class id → ms time). */
export function quietClasses(classes: readonly ClassSummary[], snoozedUntil: Readonly<Record<string, number>>, now: number): QuietClass[] {
	return classes.flatMap((c) => {
		if (c.archived || !c.linkedFolder || !c.lastFolderFileAt) return [];
		if (now - Date.parse(c.lastFolderFileAt) < QUIET_DAYS * DAY_MS || (snoozedUntil[c.id] ?? 0) > now) return [];
		return [{ classId: c.id, name: c.name, folder: c.linkedFolder, lastAt: c.lastFolderFileAt }];
	});
}

/** When a notice closed now shows again. */
export function snoozeEnd(now: number): number {
	return now + QUIET_DAYS * DAY_MS;
}

/** "No new files in CSE 29 for 4 days". */
export function quietTitle(entry: QuietClass, now: number): string {
	const days = Math.floor((now - Date.parse(entry.lastAt)) / DAY_MS);
	return `No new files in ${entry.name} for ${days} days`;
}

/** "Last one came Sun, Nov 2." */
export function quietLine(entry: QuietClass): string {
	const at = new Date(entry.lastAt);
	return `Last one came ${WEEKDAYS[at.getDay()]}, ${MONTHS[at.getMonth()]} ${at.getDate()}.`;
}
