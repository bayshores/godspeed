/**
 * data/agent-notes.json: the notes outside agents save about the learner
 * (core/agent-notes.ts). Read-modify-write; small by design (NOTES_MAX).
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../config.ts";
import { cleanNoteText, NOTE_MAX_CHARS, NOTES_MAX, parseAgentNotes, type AgentNote } from "../core/agent-notes.ts";
import { writeFileAtomic } from "./write-file-atomic.ts";

const NOTES_FILE = path.join(PATHS.data, "agent-notes.json");
const VERSION = 1;

/** Oldest first. A missing or unreadable file reads as no notes. */
export function listAgentNotes(): AgentNote[] {
	try {
		return parseAgentNotes(JSON.parse(fs.readFileSync(NOTES_FILE, "utf8")));
	} catch {
		return [];
	}
}

function writeNotes(notes: AgentNote[]): void {
	writeFileAtomic(NOTES_FILE, JSON.stringify({ version: VERSION, notes }, null, "\t"));
}

export function addAgentNote(text: string, classId: string | undefined): { ok: true; value: AgentNote } | { ok: false; error: string } {
	const clean = cleanNoteText(text);
	if (!clean) return { ok: false, error: `A note is one line of 1 to ${NOTE_MAX_CHARS} characters.` };
	const notes = listAgentNotes();
	if (notes.length >= NOTES_MAX) {
		const saved = notes.map((n) => `- ${n.id}: ${n.text}`).join("\n");
		return { ok: false, error: `godspeed already keeps ${NOTES_MAX} notes. Forget one that is out of date first.\n${saved}` };
	}
	const note: AgentNote = { id: `note_${randomBytes(4).toString("hex")}`, text: clean, ...(classId ? { classId } : {}), createdAt: new Date().toISOString() };
	writeNotes([...notes, note]);
	return { ok: true, value: note };
}

/** False when no note has that id. */
export function removeAgentNote(id: string): boolean {
	const notes = listAgentNotes();
	const kept = notes.filter((n) => n.id !== id);
	if (kept.length === notes.length) return false;
	writeNotes(kept);
	return true;
}
