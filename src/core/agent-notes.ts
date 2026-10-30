/**
 * Notes an outside agent saves about the learner (the remember / forget
 * MCP tools), so the next agent, started in any folder, knows them too
 * (agent-briefing.ts puts them in the MCP instructions).
 */

export interface AgentNote {
	/** "note_" + 8 hex. */
	id: string;
	text: string;
	/** The class the note is about; absent = not about one class. */
	classId?: string;
	createdAt: string;
}

export const NOTE_MAX_CHARS = 200;
/** Kept small so the briefing stays cheap for every agent that connects. */
export const NOTES_MAX = 30;

/** The note as one trimmed line; null when empty or too long. */
export function cleanNoteText(text: string): string | null {
	const line = text.replace(/\s+/g, " ").trim();
	return line && line.length <= NOTE_MAX_CHARS ? line : null;
}

/** The notes in a parsed agent-notes.json; malformed entries are dropped. */
export function parseAgentNotes(raw: unknown): AgentNote[] {
	const list = (raw as { notes?: unknown } | null)?.notes;
	if (!Array.isArray(list)) return [];
	return list.flatMap((entry: unknown) => {
		const n = entry as Partial<Record<keyof AgentNote, unknown>> | null;
		if (typeof n?.id !== "string" || typeof n.text !== "string" || typeof n.createdAt !== "string") return [];
		return [{ id: n.id, text: n.text, ...(typeof n.classId === "string" ? { classId: n.classId } : {}), createdAt: n.createdAt }];
	});
}
