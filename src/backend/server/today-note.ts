/**
 * The [Today] note for a lesson, built from this computer's clock and time
 * zone and the lesson's space as it stands now (core/today-note.ts has the
 * text and the append rule).
 */

import type { ChatRecord } from "../../shared/core/contracts.ts";
import type { LhMarkerMessage, LhMessage } from "../../shared/core/native-messages.ts";
import { todayNoteText, todayNoteToAppend, wallClock, type TodayNoteSpace } from "../../shared/core/today-note.ts";
import { hintedProblems } from "./progress.ts";
import { stores } from "./stores.ts";

export function localTimeZone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** The space part of the note. Archived spaces show none. */
function noteSpace(spaceId: string | undefined): TodayNoteSpace | null {
	if (!spaceId) return null;
	const space = stores.spaceStore.getSpace(spaceId);
	if (!space || space.archived) return null;
	return { deadlines: space.deadlines ?? [], files: space.files, hinted: hintedProblems(spaceId) };
}

/** The current note text for a lesson in `spaceId` (or no space). */
export function currentTodayNote(spaceId: string | undefined): string {
	return todayNoteText({ now: new Date(), timeZone: localTimeZone(), space: noteSpace(spaceId) });
}

/** The note to append before the learner's next message, or null. */
export function todayNoteFor(record: Pick<ChatRecord, "spaceId"> & { messages: readonly LhMessage[] }): LhMarkerMessage | null {
	const now = new Date();
	const timeZone = localTimeZone();
	const text = todayNoteText({ now, timeZone, space: noteSpace(record.spaceId) });
	return todayNoteToAppend(record.messages, text, wallClock(now, timeZone).day);
}
