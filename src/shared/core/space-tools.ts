/**
 * The space tools both the outside agent's MCP server and the Talk chat
 * offer: their names, descriptions, argument shapes and outcome. The
 * server runs them (server/space-actions.ts); each side declares the
 * schemas in its own library with this text.
 */
import { SPACE_ICONS, SIGNATURE_MAX, type MockFormat, type SpaceDeadline, type SpaceIcon } from "./contracts.ts";
import type { LhMessage } from "./native-messages.ts";

/** One change an action made, as the window shows it (a recorded agent action). */
export interface SpaceChange {
	label: string;
	page: string;
}

/** What one space action did: a value for the agent and the changes it
 *  made, or why it refused. */
export type ToolOutcome = { ok: true; value: unknown; changes: SpaceChange[] } | { ok: false; error: string };

type DeadlineKind = SpaceDeadline["kind"];
type FileKind = "study" | "info";
interface Signature {
	kind: "math" | "code" | "text";
	value: string;
}

/** The space actions, keyed by tool name, with the tools' own argument names. */
export interface SpaceActions {
	list_spaces(): ToolOutcome;
	read_space(args: { space_id: string; files?: boolean }): ToolOutcome;
	search_space_files(args: { space_id: string; query: string; limit?: number }): Promise<ToolOutcome>;
	read_passage(args: { space_id: string; passage_id?: string; file_id?: string; range?: string }): ToolOutcome;
	create_space(args: { name: string; description?: string; signature?: Signature; icon?: SpaceIcon }): ToolOutcome;
	update_space(args: { space_id: string; name?: string; description?: string; signature?: Signature; icon?: SpaceIcon; archived?: boolean }): ToolOutcome;
	add_space_file(args: { space_id: string; path: string; kind: FileKind }): ToolOutcome;
	set_space_file_kind(args: { space_id: string; file_ids: string[]; kind: FileKind }): ToolOutcome;
	add_space_deadline(args: {
		space_id: string;
		deadlines: { kind: DeadlineKind; name: string; date: string; time?: string; file_ids?: string[]; left_out_ids?: string[]; source?: string; assignment_file_id?: string }[];
	}): ToolOutcome;
	update_space_deadline(args: {
		space_id: string;
		deadline_id: string;
		kind?: DeadlineKind;
		name?: string;
		date?: string;
		time?: string | null;
		file_ids?: string[];
		left_out_ids?: string[];
		source?: string | null;
		assignment_file_id?: string | null;
		done?: boolean;
	}): ToolOutcome;
	remove_space_deadline(args: { space_id: string; deadline_id: string }): ToolOutcome;
	link_space_folder(args: { space_id: string; path: string }): ToolOutcome;
	update_prep(args: {
		space_id: string;
		date?: string | null;
		about?: string;
		mock?: MockFormat;
		add_topics?: { name: string; why?: string }[];
		remove_topic_ids?: string[];
	}): ToolOutcome;
	start_lesson(args: { topic: string; space_id?: string }): Promise<ToolOutcome>;
}

export type SpaceToolName = keyof SpaceActions;

export const SPACE_TOOL_TEXT: Record<SpaceToolName, string> = {
	list_spaces: "List the learner's spaces, archived ones included, with file and lesson counts.",
	read_space:
		"Read one space: its description, how many files are in each status (pending, extracting, ready, failed, needs-whisper) and the files that could not be read, the topics of its knowledge graph with their fact counts, its deadlines (kind, date, time, done, and the files each covers), its lessons, and today's local date and time. A prep (a space made to get ready for one interview, assessment or test) also has its prep sheet: what the learner is preparing for, its day, what it is like, the topics with their ids and how each is going, what a mock is and the mocks taken. With files: true it lists every file instead (id, kind, status, size, path on disk). To find something inside the files, use search_space_files.",
	search_space_files:
		"Search all of a space's files (readings, slides, transcripts, syllabus, assignments) by meaning and keywords. Returns the best passages, each with its id, file, place (page, slide, time or lines) and a short snippet. Open the ones you need with read_passage instead of reading whole files.",
	read_passage:
		"Read one passage of a space file by its id from search_space_files, or a file's passages at a place (file_id + range, e.g. a whole page). Returns the text with the ids of the passages before and after it, to keep reading.",
	create_space:
		"Create a space for one thing the learner is studying (a university course, a certification, a language). The description is shown to the teacher in every lesson of the space: level, the book or source they follow, its notation, what they are working toward (a course's exams, an interview). Add the space's deadlines with add_space_deadline.",
	update_space:
		"Rename a space, change its description, signature or icon, or archive / unarchive it (archiving hides it from the space switcher but keeps everything; an archived space takes no new lessons).",
	add_space_file:
		"Copy a file from this computer into a space. Supported: .md .txt, code files (.c .py .java .js and the like), plain text with no extension, .pdf .docx .pptx, .vtt .srt (transcripts) and .mp3 .m4a .wav .mp4 .mov (recordings, transcribed locally with whisper.cpp). Google Docs links (.gdoc) need saving as PDF or Word first. Study files are turned into facts by you, through wait_for_work.",
	set_space_file_kind:
		"Switch one or more space files between study material and space info. Study → info removes their facts; info → study builds them. A file that can't be switched is listed under refused; the others still switch.",
	add_space_deadline:
		"Add one or more deadlines to a space (send all of a space's deadlines in one call): exams, homework, quizzes and projects, each with its date, its time if it has one, and which of the space's files (notes, readings) it covers. godspeed uses this to show the learner what is due and what to work on first. Take the deadlines, their dates and times from the space info files (a syllabus, a schedule), and never make up a date or time. Work out what a deadline covers from the space's own files first: a practice exam or review sheet, the schedule, announcements (search_space_files). Link the files they point to (file_ids), list files from before it that it doesn't cover in left_out_ids, and say in source which file it came from. Ask only when the files don't settle it. File ids come from read_space with files: true. A deadline that is refused is listed under refused with the reason; the others are still added, so send only the refused ones again.",
	update_space_deadline:
		"Change a deadline's kind, name, date, time, covered files, left-out files, source or assignment file, or tick it done (done: true) or not done (done: false). file_ids and left_out_ids each replace the whole list (a file is never in both); time: null, source: null and assignment_file_id: null remove them. Work out coverage from the space's own files as add_space_deadline says; ask the learner when the files don't settle it.",
	remove_space_deadline: "Remove one deadline from a space (its files and facts are not touched).",
	link_space_folder:
		"Link a folder on this computer to a space. Its supported files are added, and from then on new files dropped there are added automatically and edited files are rebuilt (checked every minute while godspeed is open). godspeed sorts them into study material and space info itself while reading them, and never changes the folder. Use set_space_file_kind only to correct a kind.",
	update_prep:
		"Change a prep's sheet when the learner asks (read_space shows it): move or clear its day, replace what it is like, change what a mock is, add topics, or remove topics by id. Only what you send changes. Refused while the sheet is being written.",
	start_lesson:
		"Start a new study session in godspeed taught by you: you teach what is new and give problems on what needs practice. The topic becomes the learner's first message. With space_id the lesson belongs to that space: it opens with the space's card and its facts go into that space's graph. In a prep, a topic named exactly like one on its sheet counts for that topic. You teach it through wait_for_work; the learner follows along in the godspeed window.",
};

/** The argument descriptions both schemas share. */
export const SPACE_ARG_TEXT = {
	files: "List every file with its id (needed for file_ids). Default false.",
	query: "What to look for, in plain words.",
	limit: "Most passages to return (default 8).",
	passageId: "A passage id from search_space_files (or a previous/next id).",
	fileId: "Instead of passage_id: a file id from read_space, with range.",
	range: 'With file_id: the place, e.g. "p. 12", "slide 4", "12:30" or "lines 40".',
	name: 'The space\'s name, e.g. "MATH 20C – Calculus III" or "Conversational Spanish".',
	description: "What the teacher should know about the space, in the learner's terms.",
	signature: `The space's signature: ONE line that sums up the subject, shown huge on the space's cover. kind "math" = LaTeX without $ (math, physics, chemistry, economics), "code" = a line of code (programming spaces), "text" = anything else (a line from a primary source, a sequence, a date). At most ${SIGNATURE_MAX} characters. Pick something iconic for the subject; ask the learner when unsure.`,
	icon: `The space's subject icon in the space switcher: ${Object.entries(SPACE_ICONS)
		.map(([icon, subject]) => `"${icon}" ${subject}`)
		.join(", ")}. Pick the closest subject.`,
	filePath: "The file's absolute path.",
	folderPath: "The folder's absolute path.",
	fileKind: '"study" = study material turned into graph facts (notes, readings, transcripts, recordings); "info" = space info the teacher can read but that never becomes facts (a syllabus, a schedule, logistics).',
	fileIds: "The files to switch (ids from read_space with files: true).",
	deadlineKind: "What the deadline is.",
	deadlineName: 'e.g. "Midterm 1", "Homework 5".',
	date: "The due day as YYYY-MM-DD.",
	time: 'The due time as 24-hour "HH:MM" on this computer\'s clock. Leave it out when there is none (it then counts as due at the end of the day).',
	coveredFiles: "Ids of the space files it covers.",
	leftOutFiles: "Ids of space files from before it that it does NOT cover (e.g. lectures after the practice exam's last topic). The learner's page stops flagging them as missing.",
	source: "Where you found what it covers, e.g. the practice exam's file name. The learner sees it.",
	assignmentFile: "For homework and projects: the id of the space file with its problems (the assignment sheet). The learner works on its problems in godspeed.",
	newTime: '24-hour "HH:MM", or null to remove the time.',
	prepDate: "The day it happens as YYYY-MM-DD, or null for no day.",
	prepAbout: "What it is like, in markdown. Replaces the whole text.",
	prepMock: "What one mock is: how many questions in how many minutes.",
	addTopics: "Topics to add at the end of the sheet, each with one line on why it is there.",
	removeTopics: "Ids of the sheet's topics to remove.",
	topic: "What the learner wants to study, in their words.",
	lessonSpace: 'The space id from list_spaces, or "none" for lessons without a space (the default).',
} as const;

export const DEADLINE_KINDS = ["exam", "homework", "quiz", "project"] as const satisfies readonly DeadlineKind[];
export const FILE_KINDS = ["study", "info"] as const satisfies readonly FileKind[];

/** The lesson the last turn started with start_lesson (in Talk), so the
 *  agent is sent on to teach it. Null when the turn started none. */
export function lessonStartedLastTurn(messages: readonly LhMessage[]): string | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i]!;
		if (m.role !== "assistant" && m.role !== "toolResult") return null;
		if (m.role !== "toolResult" || m.toolName !== "start_lesson" || m.isError) continue;
		const page = (m.details as { changes?: SpaceChange[] } | null)?.changes?.[0]?.page;
		const id = page?.startsWith("/chat/") ? page.slice("/chat/".length) : "";
		if (id) return id;
	}
	return null;
}
