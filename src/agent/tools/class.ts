import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
import { classCardText, type ClassCardDetails } from "../../core/native-messages.ts";
import type { PassageRef } from "../../core/search.ts";

/**
 * The class tools of a lesson in a class:
 *  - read_class: the CURRENT class card — name, the learner's description,
 *    the class files with their paths, the graph's topics. The lesson's
 *    opening card is a snapshot from when it started; this is the live
 *    version (new files, an edited description).
 *  - search_class_files / read_passage: search the class's files and open
 *    only the passages needed, instead of whole files.
 *
 * Registered only for lessons in a class (the composition root passes the
 * readers). How to USE class context is doctrine
 * (prompts/shared/12-class-context.md), not this tool's business.
 */
export interface ClassToolContext {
	/** The lesson's class card as it stands now; null = the class is gone. */
	classCard: () => ClassCardDetails | null;
	/** The current [Today] note text (date, time, open deadlines), added
	 *  after the card. */
	todayNote?: () => string;
	/** Search over the class's files: present = search_class_files and
	 *  read_passage. */
	search?: ClassSearch;
}

/** The lesson's class-file search (src/server/search-index.ts). */
export interface ClassSearch {
	searchFiles: (query: string, limit: number) => Promise<string>;
	readPassage: (ref: PassageRef) => string;
}

const readClassInput = Type.Object({});

const searchInput = Type.Object({
	query: Type.String({ description: "What to look for, in plain words." }),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Most passages to return (default 8)." })),
});

const readPassageInput = Type.Object({
	passage_id: Type.Optional(Type.String({ description: "A passage id from search_class_files (or a previous/next id)." })),
	file_id: Type.Optional(Type.String({ description: "Instead of passage_id: a class file id, with range." })),
	range: Type.Optional(Type.String({ description: 'With file_id: the place, e.g. "p. 12", "12:30" or "lines 40".' })),
});

export function classTools(ctx: ClassToolContext): Record<string, AgentTool<any>> {
	return {
		read_class: {
			name: "read_class",
			label: "read_class",
			description:
				"Read the current card of this lesson's class: the class name, the learner's description of the course, its files (study material and course info) with the paths to open them, and the topics of its knowledge graph. " +
				"Use it when you need class details the opening [Class context] card may not have (files added since the lesson started, an edited description). " +
				"It also returns today's date and time and the class's open deadlines (the [Today] note).",
			parameters: readClassInput,
			execute: serverExecute("read_class", readClassInput, async (): Promise<string> => {
				const card = ctx.classCard();
				if (!card) return "This lesson's class no longer exists.";
				return ctx.todayNote ? `${classCardText(card)}\n\n${ctx.todayNote()}` : classCardText(card);
			}),
		},
		...(ctx.search ? searchTools(ctx.search) : {}),
	};
}

function searchTools(search: ClassSearch): Record<string, AgentTool<any>> {
	return {
		search_class_files: {
			name: "search_class_files",
			label: "search_class_files",
			description:
				"Search all of this class's files (readings, slides, transcripts, syllabus, assignments) by meaning and keywords. " +
				"Returns the best passages, each with its id, file, place (page, time or lines) and a short snippet. Open the ones you need with read_passage instead of reading whole files.",
			parameters: searchInput,
			execute: serverExecute("search_class_files", searchInput, async ({ query, limit }): Promise<string> => search.searchFiles(query, limit ?? 8)),
		},
		read_passage: {
			name: "read_passage",
			label: "read_passage",
			description:
				"Read one passage of a class file by its id from search_class_files, or a file's passages at a place (file_id + range, e.g. a whole page). " +
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
