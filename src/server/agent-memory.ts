/**
 * What godspeed remembers for outside agents: the "Where you left off"
 * briefing an agent gets when it connects (core/agent-briefing.ts), and
 * the saved notes as Settings → Connection lists them.
 */

import { agentBriefing } from "../core/agent-briefing.ts";
import { missingSetup } from "../core/class-setup.ts";
import { listAgentNotes } from "../store/agent-notes.ts";
import { stores } from "./stores.ts";
import { localTimeZone } from "./today-note.ts";

export { removeAgentNote } from "../store/agent-notes.ts";

export function currentAgentBriefing(maxChars: number): string {
	return agentBriefing({
		now: new Date(),
		maxChars,
		timeZone: localTimeZone(),
		classes: stores.classStore.listClassRecords().map((r) => ({
			id: r.id,
			name: r.name,
			archived: r.archived,
			deadlines: r.deadlines ?? [],
			missingSetup: missingSetup(r),
		})),
		lessons: stores.chatStore.listChats().map((c) => ({
			id: c.id,
			title: c.title,
			...(c.classId ? { classId: c.classId } : {}),
			updatedAt: c.updatedAt,
			waiting: c.pendingQuestion || c.pendingProblem,
		})),
		notes: listAgentNotes(),
	});
}

/** The notes with their class names, oldest first. */
export function agentNotesView(): { id: string; text: string; className: string | null; createdAt: string }[] {
	return listAgentNotes().map((n) => ({
		id: n.id,
		text: n.text,
		className: n.classId ? (stores.classStore.getClass(n.classId)?.name ?? null) : null,
		createdAt: n.createdAt,
	}));
}
