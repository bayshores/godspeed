/**
 * The class tools both the outside agent's MCP server and the Talk chat
 * offer: their names, descriptions, argument shapes and outcome. The
 * server runs them (server/class-actions.ts); each side declares the
 * schemas in its own library with this text.
 */
import { CLASS_ICONS, SIGNATURE_MAX, type ClassDeadline, type ClassIcon } from "./contracts.ts";
import type { LhMessage } from "./native-messages.ts";

/** One change an action made, as the window shows it (a recorded agent action). */
export interface ClassChange {
	label: string;
	page: string;
}

/** What one class action did: a value for the agent and the changes it
 *  made, or why it refused. */
export type ToolOutcome = { ok: true; value: unknown; changes: ClassChange[] } | { ok: false; error: string };

type DeadlineKind = ClassDeadline["kind"];
type FileKind = "study" | "info";
interface Signature {
	kind: "math" | "code" | "text";
	value: string;
}

/** The class actions, keyed by tool name, with the tools' own argument names. */
export interface ClassActions {
	list_classes(): ToolOutcome;
	read_class(args: { class_id: string; files?: boolean }): ToolOutcome;
	search_class_files(args: { class_id: string; query: string; limit?: number }): Promise<ToolOutcome>;
	read_passage(args: { class_id: string; passage_id?: string; file_id?: string; range?: string }): ToolOutcome;
	create_class(args: { name: string; description?: string; signature?: Signature; icon?: ClassIcon }): ToolOutcome;
	update_class(args: { class_id: string; name?: string; description?: string; signature?: Signature; icon?: ClassIcon; archived?: boolean }): ToolOutcome;
	add_class_file(args: { class_id: string; path: string; kind: FileKind }): ToolOutcome;
	set_class_file_kind(args: { class_id: string; file_ids: string[]; kind: FileKind }): ToolOutcome;
	add_class_deadline(args: {
		class_id: string;
		deadlines: { kind: DeadlineKind; name: string; date: string; time?: string; file_ids?: string[]; left_out_ids?: string[]; source?: string }[];
	}): ToolOutcome;
	update_class_deadline(args: {
		class_id: string;
		deadline_id: string;
		kind?: DeadlineKind;
		name?: string;
		date?: string;
		time?: string | null;
		file_ids?: string[];
		left_out_ids?: string[];
		source?: string | null;
		done?: boolean;
	}): ToolOutcome;
	remove_class_deadline(args: { class_id: string; deadline_id: string }): ToolOutcome;
	link_class_folder(args: { class_id: string; path: string }): ToolOutcome;
	start_lesson(args: { topic: string; class_id?: string }): Promise<ToolOutcome>;
}

export type ClassToolName = keyof ClassActions;

export const CLASS_TOOL_TEXT: Record<ClassToolName, string> = {
	list_classes: "List the learner's classes (university courses), archived ones included, with file and lesson counts.",
	read_class:
		"Read one class: its description, how many files are in each status (pending, extracting, ready, failed, needs-whisper) and the files that could not be read, the topics of its knowledge graph with their fact counts, its deadlines (kind, date, time, done, and the files each covers), its lessons, and today's local date and time. With files: true it lists every file instead (id, kind, status, size, path on disk). To find something inside the files, use search_class_files.",
	search_class_files:
		"Search all of a class's files (readings, slides, transcripts, syllabus, assignments) by meaning and keywords. Returns the best passages, each with its id, file, place (page, slide, time or lines) and a short snippet. Open the ones you need with read_passage instead of reading whole files.",
	read_passage:
		"Read one passage of a class file by its id from search_class_files, or a file's passages at a place (file_id + range, e.g. a whole page). Returns the text with the ids of the passages before and after it, to keep reading.",
	create_class:
		"Create a class for a course the learner is taking. The description is shown to the teacher in every lesson of the class: level, textbook, the professor's notation, what exams and assignments look like. Add the class's deadlines with add_class_deadline.",
	update_class:
		"Rename a class, change its description, signature or icon, or archive / unarchive it (archiving hides it from the class switcher but keeps everything; an archived class takes no new lessons).",
	add_class_file:
		"Copy a file from this computer into a class. Supported: .md .txt, code files (.c .py .java .js and the like), plain text with no extension, .pdf .docx .pptx, .vtt .srt (transcripts) and .mp3 .m4a .wav .mp4 .mov (recordings, transcribed locally with whisper.cpp). Google Docs links (.gdoc) need saving as PDF or Word first. Study files are turned into facts by you, through wait_for_work.",
	set_class_file_kind:
		"Switch one or more class files between study material and course info. Study → info removes their facts; info → study builds them. A file that can't be switched is listed under refused; the others still switch.",
	add_class_deadline:
		"Add one or more deadlines to a class (send all of a syllabus's deadlines in one call): exams, homework, quizzes and projects, each with its date, its time if it has one, and which of the class's files (lecture notes, readings) it covers. godspeed uses this to show the learner what is due and what to work on first. Take the deadlines, their dates and times from the syllabus or course info, and never make up a date or time. Work out what a deadline covers from the class's own files first: a practice exam or review sheet, the syllabus schedule, announcements (search_class_files). Link the lectures they point to (file_ids), list files from before it that it doesn't cover in left_out_ids, and say in source which file it came from. Ask only when the files don't settle it. File ids come from read_class with files: true. A deadline that is refused is listed under refused with the reason; the others are still added, so send only the refused ones again.",
	update_class_deadline:
		"Change a deadline's kind, name, date, time, covered files, left-out files or source, or tick it done (done: true) or not done (done: false). file_ids and left_out_ids each replace the whole list (a file is never in both); time: null and source: null remove them. Work out coverage from the class's own files as add_class_deadline says; ask the learner when the files don't settle it.",
	remove_class_deadline: "Remove one deadline from a class (its files and facts are not touched).",
	link_class_folder:
		"Link a folder on this computer to a class. Its supported files are added, and from then on new files dropped there are added automatically and edited files are rebuilt (checked every minute while godspeed is open). godspeed sorts them into study material and course info itself while reading them, and never changes the folder. Use set_class_file_kind only to correct a kind.",
	start_lesson:
		"Start a new study session in godspeed taught by you: you teach what is new and give problems on what needs practice. The topic becomes the learner's first message. With class_id the lesson belongs to that class: it opens with the class's card and its facts go into that class's graph. You teach it through wait_for_work; the learner follows along in the godspeed window.",
};

/** The argument descriptions both schemas share. */
export const CLASS_ARG_TEXT = {
	files: "List every file with its id (needed for file_ids). Default false.",
	query: "What to look for, in plain words.",
	limit: "Most passages to return (default 8).",
	passageId: "A passage id from search_class_files (or a previous/next id).",
	fileId: "Instead of passage_id: a file id from read_class, with range.",
	range: 'With file_id: the place, e.g. "p. 12", "slide 4", "12:30" or "lines 40".',
	name: 'The course, e.g. "MATH 20C – Calculus III".',
	description: "What the teacher should know about the course, in the learner's terms.",
	signature: `The class's signature: ONE line that sums up the subject, shown huge on the class's cover. kind "math" = LaTeX without $ (math, physics, chemistry, economics), "code" = a line of code (programming classes), "text" = anything else (a line from a primary source, a sequence, a date). At most ${SIGNATURE_MAX} characters. Pick something iconic for the course; ask the learner when unsure.`,
	icon: `The class's subject icon in the class switcher: ${Object.entries(CLASS_ICONS)
		.map(([icon, subject]) => `"${icon}" ${subject}`)
		.join(", ")}. Pick the closest subject.`,
	filePath: "The file's absolute path.",
	folderPath: "The folder's absolute path.",
	fileKind: '"study" = study material turned into graph facts (notes, readings, transcripts, recordings); "info" = course info the teacher can read but that never becomes facts (syllabus, assignments, logistics).',
	fileIds: "The files to switch (ids from read_class with files: true).",
	deadlineKind: "What the deadline is.",
	deadlineName: 'e.g. "Midterm 1", "Homework 5".',
	date: "The due day as YYYY-MM-DD.",
	time: 'The due time as 24-hour "HH:MM" on this computer\'s clock. Leave it out when there is none (it then counts as due at the end of the day).',
	coveredFiles: "Ids of the class files it covers.",
	leftOutFiles: "Ids of class files from before it that it does NOT cover (e.g. lectures after the practice exam's last topic). The learner's page stops flagging them as missing.",
	source: "Where you found what it covers, e.g. the practice exam's file name. The learner sees it.",
	newTime: '24-hour "HH:MM", or null to remove the time.',
	topic: "What the learner wants to study, in their words.",
	lessonClass: 'The class id from list_classes, or "none" for lessons without a class (the default).',
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
		const page = (m.details as { changes?: ClassChange[] } | null)?.changes?.[0]?.page;
		const id = page?.startsWith("/chat/") ? page.slice("/chat/".length) : "";
		if (id) return id;
	}
	return null;
}
