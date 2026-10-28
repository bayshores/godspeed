/**
 * The [Today] note for a lesson, built from this computer's clock and time
 * zone and the lesson's class as it stands now (core/today-note.ts has the
 * text and the append rule).
 */

import type { ChatRecord } from "../core/contracts.ts";
import type { LhMarkerMessage, LhMessage } from "../core/native-messages.ts";
import { todayNoteText, todayNoteToAppend, wallClock, type TodayNoteClass } from "../core/today-note.ts";
import { stores } from "./stores.ts";

function localTimeZone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** The class part of the note. Archived classes show no deadlines. */
function noteClass(classId: string | undefined): TodayNoteClass | null {
	if (!classId) return null;
	const cls = stores.classStore.getClass(classId);
	if (!cls || cls.archived) return null;
	return { deadlines: cls.deadlines ?? [], files: cls.files };
}

/** The current note text for a lesson in `classId` (or no class). */
export function currentTodayNote(classId: string | undefined, now = new Date()): string {
	return todayNoteText({ now, timeZone: localTimeZone(), cls: noteClass(classId) });
}

/** The note to append before the learner's next message, or null. */
export function todayNoteFor(record: Pick<ChatRecord, "classId"> & { messages: readonly LhMessage[] }, now = new Date()): LhMarkerMessage | null {
	const timeZone = localTimeZone();
	const text = todayNoteText({ now, timeZone, cls: noteClass(record.classId) });
	return todayNoteToAppend(record.messages, text, wallClock(now, timeZone).day);
}
