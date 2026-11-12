import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
import { spaceCardText, spaceFilesText, type SpaceCardDetails } from "../../../shared/core/native-messages.ts";
import { NOTE_MAX } from "../../../shared/core/contracts.ts";
import type { PassageRef } from "../../../shared/core/search.ts";

/**
 * The space tools of a lesson in a space:
 *  - read_space: the CURRENT space card — name, the learner's description,
 *    the space files with their paths, the graph's topics. The lesson's
 *    opening card is a snapshot from when it started; this is the live
 *    version (new files, an edited description).
 *  - search_space_files / read_passage: search the space's files and open
 *    only the passages needed, instead of whole files.
 *  - set_space_note: Halley's note on the space's cover (where the learner
 *    stands, what's next).
 *
 * Registered only for lessons in a space (the composition root passes the
 * readers). How to USE space context is doctrine
 * (prompts/shared/12-space-context.md), not this tool's business.
 */
export interface SpaceToolContext {
	/** The lesson's space card as it stands now; null = the space is gone. */
	spaceCard: () => SpaceCardDetails | null;
	/** The current [Today] note text (date, time, open deadlines), added
	 *  after the card. */
	todayNote?: () => string;
	/** Search over the space's files: present = search_space_files and
	 *  read_passage. */
	search?: SpaceSearch;
	/** Save Halley's note on the space's cover (present = set_space_note);
	 *  returns the tool's reply. */
	setNote?: (text: string) => string;
}

/** The lesson's space-file search (src/backend/server/search-index.ts). */
export interface SpaceSearch {
	searchFiles: (query: string, limit: number) => Promise<string>;
	readPassage: (ref: PassageRef) => string;
}

const readSpaceInput = Type.Object({});

const setNoteInput = Type.Object({
	text: Type.String({ minLength: 1, maxLength: NOTE_MAX, description: "Two short sentences in plain words, to the learner." }),
});

const searchInput = Type.Object({
	query: Type.String({ minLength: 1, description: "What to look for, in plain words." }),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Most passages to return (default 8)." })),
});

const readPassageInput = Type.Object({
	passage_id: Type.Optional(Type.String({ description: "A passage id from search_space_files (or a previous/next id)." })),
	file_id: Type.Optional(Type.String({ description: 'Instead of passage_id: a space file id (the part of a passage id before the ":"), with range.' })),
	range: Type.Optional(Type.String({ description: 'With file_id: the place, e.g. "p. 12", "12:30" or "lines 40".' })),
});

export function spaceTools(ctx: SpaceToolContext): Record<string, AgentTool<any>> {
	return {
		read_space: {
			name: "read_space",
			label: "read_space",
			description:
				"Read the current card of this lesson's space: the space name, the learner's description of the space, its files (study material and space info) with the paths to open them, and the topics of its knowledge graph. " +
				"Use it when you need a file's path (the opening [Space context] card only counts the files) or space details that changed since the lesson started. To find something inside the files, use search_space_files instead. " +
				"It also returns today's date and time and the space's open deadlines (the [Today] note).",
			parameters: readSpaceInput,
			execute: serverExecute("read_space", readSpaceInput, async (): Promise<string> => {
				const card = ctx.spaceCard();
				if (!card) return "This lesson's space no longer exists.";
				return [spaceCardText(card), spaceFilesText(card), ctx.todayNote?.()].filter(Boolean).join("\n\n");
			}),
		},
		...(ctx.setNote ? noteTools(ctx.setNote) : {}),
		...(ctx.search ? searchTools(ctx.search) : {}),
	};
}

function noteTools(setNote: (text: string) => string): Record<string, AgentTool<any>> {
	return {
		set_space_note: {
			name: "set_space_note",
			label: "set_space_note",
			description:
				"Replace the note on this space's cover page: two short sentences to the learner about where they stand in this space and what's next. " +
				`At most ${NOTE_MAX} characters. Write it when you finish a topic or the learner wraps up; skip it when nothing changed.`,
			parameters: setNoteInput,
			execute: serverExecute("set_space_note", setNoteInput, async ({ text }): Promise<string> => setNote(text)),
		},
	};
}

/** search_space_files and read_passage (also the cheat sheet writer). */
export function searchTools(search: SpaceSearch): Record<string, AgentTool<any>> {
	return {
		search_space_files: {
			name: "search_space_files",
			label: "search_space_files",
			description:
				"Search all of this space's files (readings, slides, transcripts, syllabus, assignments) by meaning and keywords. " +
				"Returns the best passages, each with its id, file, place (page, time or lines) and a short snippet. Open the ones you need with read_passage instead of reading whole files.",
			parameters: searchInput,
			execute: serverExecute("search_space_files", searchInput, async ({ query, limit }): Promise<string> => search.searchFiles(query, limit ?? 8)),
		},
		read_passage: {
			name: "read_passage",
			label: "read_passage",
			description:
				"Read one passage of a space file by its id from search_space_files, or a file's passages at a place (file_id + range, e.g. a whole page). " +
				"Returns the text with the ids of the passages before and after it, to keep reading.",
			parameters: readPassageInput,
			execute: serverExecute("read_passage", readPassageInput, async ({ passage_id, file_id, range }): Promise<string> => {
				if (passage_id) return search.readPassage({ passageId: passage_id });
				if (file_id && range) return search.readPassage({ fileId: file_id, range });
				return "Give passage_id, or file_id with range.";
			}),
		},
	};
}
