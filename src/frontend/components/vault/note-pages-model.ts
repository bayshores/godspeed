/** The pages of a note as the server sends them (a space's, and a lesson's end), and what is said about them. Pure. */

/** Who owns the note: godspeed wrote it, was handed it (`godspeed: keep`), or the learner wrote it. */
export type NoteKind = "godspeed" | "kept" | "mine";

/** One page. `saving` is true while the note waits for the notes folder; `path` is null until it is written. */
export interface VaultNote {
	topicId: string;
	name: string;
	/** The question that brings the idea back; null before the teacher wrote one. */
	recall: string | null;
	/** The topic's own color on Progress: how well the learner knows it. */
	color: string;
	kind: NoteKind;
	path: string | null;
	saving: boolean;
}

/** One "My words" ask a lesson end still owes. */
export interface LessonAsk {
	topicId: string;
	name: string;
	/** The most words the note takes. */
	maxLength: number;
}

/** GET /api/chats/{id}/vault-notes. */
export interface LessonNotes {
	pages: VaultNote[];
	asks: LessonAsk[];
}

import { destination } from "./vault-model";

/** The line under a lesson end's pages: "Saving to Obsidian" until every page is written, then "Saved to Obsidian". Null with no pages. */
export function savedLine(pages: readonly VaultNote[], obsidian: boolean): string | null {
	if (pages.length === 0) return null;
	return `${pages.some((p) => p.saving) ? "Saving" : "Saved"} to ${destination(obsidian)}`;
}

/** The ask, in the learner's words: "Explain stars and bars in your own words." An acronym keeps its capitals. */
export function askLine(name: string): string {
	const second = name[1];
	const topic = second !== undefined && second === second.toLowerCase() ? name.charAt(0).toLowerCase() + name.slice(1) : name;
	return `Explain ${topic} in your own words.`;
}

/** The page name's size, smaller as the name grows, so it wraps to two lines and is never cut. */
export function nameSize(name: string): string {
	return name.length <= 22 ? "text-tab" : name.length <= 34 ? "text-item" : "text-ui";
}

/** The note's mark in its corner: the learner's own notes say so. */
export function noteMark(note: Pick<VaultNote, "kind">): "Yours" | null {
	return note.kind === "mine" ? "Yours" : null;
}

/** How many characters the words are over what the note takes; 0 or less when they fit. */
export function wordsOver(words: string, maxLength: number): number {
	return words.trim().length - maxLength;
}
