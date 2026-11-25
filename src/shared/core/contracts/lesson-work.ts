/**
 * What the teacher does in a lesson's running turn (GET /api/chats/{id}/work), for the lesson's
 * desk: why the turn runs, whether an agent took it, its plan, its steps in the server's words,
 * what it waits for the learner to allow, and the files on the desk.
 */
import { isRecord } from "../is-record.ts";

/** Why a turn runs. The server decides it from the turn's input; the window words it. */
const TURN_CAUSES = ["first", "answer", "problem", "ask", "next", "retry", "open_problem", "job"] as const;
type TurnCause = (typeof TURN_CAUSES)[number];

/** How the desk draws a file: pages of text, PDF pages, or no pages to show (Word, PowerPoint,
 *  EPUB). */
type DeskFileKind = "text" | "pdf" | "other";

/** A file the teacher works from. `path` is where it is on the computer, which the paper reads. */
interface DeskFile {
	name: string;
	path: string;
	kind: DeskFileKind;
}

/** The place in a file a step reads: lines of a text file, or a PDF's page. */
export interface DeskReading extends DeskFile {
	from: number | null;
	to: number | null;
	page: number | null;
}

/** One step, in the server's words ("Reading HW7_F26.pdf, page 1"). */
interface DeskStep {
	id: string;
	/** ISO time. */
	at: string;
	text: string;
	/** The tool call the step stands for when the reply sent it, so the lesson text hides its card. */
	call: string | null;
	/** The file this step reads, at its place. */
	reads: DeskReading | null;
}

/** What a permission question is about, by name (`APPROVAL_SUBJECTS` in crates/core/src/session/approval_card.rs). */
const APPROVAL_SUBJECTS = ["command", "file", "site", "search", "tool", "words"] as const;
type ApprovalSubjectKind = (typeof APPROVAL_SUBJECTS)[number];

/** A permission question the agent waits on, in the server's words: one sentence, and what it is
 *  about as its own object. `id` is what the answer is posted to. */
export interface WorkApproval {
	id: string;
	text: string;
	subject: { kind: ApprovalSubjectKind; text: string } | null;
}

interface WorkPlan {
	items: string[];
	done: number;
}

export interface LessonWork {
	/** A turn runs. */
	live: boolean;
	cause: TurnCause | null;
	/** An agent has taken the turn. */
	taken: boolean;
	plan: WorkPlan | null;
	/** Oldest first. */
	steps: DeskStep[];
	/** Oldest first; gone once answered, or denied by Stop or the turn's end. */
	approvals: WorkApproval[];
	/** The stack, front first; sent with no turn too, so it is ready when one starts. */
	files: DeskFile[];
}

export const NO_LESSON_WORK: LessonWork = { live: false, cause: null, taken: false, plan: null, steps: [], approvals: [], files: [] };

const str = (v: unknown): v is string => typeof v === "string" && v !== "";
const count = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);
const isKind = (v: unknown): v is DeskFileKind => v === "text" || v === "pdf" || v === "other";
const isCause = (v: unknown): v is TurnCause => TURN_CAUSES.includes(v as TurnCause);

function readFile(raw: unknown): DeskFile | null {
	if (!isRecord(raw) || !str(raw.name) || !str(raw.path) || !isKind(raw.kind)) return null;
	return { name: raw.name, path: raw.path, kind: raw.kind };
}

function readReading(raw: unknown): DeskReading | null {
	const file = readFile(raw);
	if (!file || !isRecord(raw)) return null;
	return { ...file, from: count(raw.from), to: count(raw.to), page: count(raw.page) };
}

function readPlan(raw: unknown): WorkPlan | null {
	if (!isRecord(raw) || !Array.isArray(raw.items) || !raw.items.every(str) || typeof raw.done !== "number") return null;
	return { items: raw.items, done: Math.max(0, Math.min(Math.trunc(raw.done), raw.items.length)) };
}

const isSubjectKind = (v: unknown): v is ApprovalSubjectKind => APPROVAL_SUBJECTS.includes(v as ApprovalSubjectKind);

function readApproval(raw: unknown): WorkApproval | null {
	if (!isRecord(raw) || !str(raw.id) || !str(raw.text)) return null;
	const subject = isRecord(raw.subject) && isSubjectKind(raw.subject.kind) && str(raw.subject.text) ? { kind: raw.subject.kind, text: raw.subject.text } : null;
	return { id: raw.id, text: raw.text, subject };
}

/** The answer made safe to use. */
export function readLessonWork(raw: unknown): LessonWork {
	if (!isRecord(raw)) return NO_LESSON_WORK;
	const files = Array.isArray(raw.files) ? raw.files.flatMap((f) => readFile(f) ?? []) : [];
	if (raw.live !== true) return { ...NO_LESSON_WORK, files };
	const steps = Array.isArray(raw.steps)
		? raw.steps.flatMap((s): DeskStep[] => (isRecord(s) && str(s.id) && str(s.at) && str(s.text) ? [{ id: s.id, at: s.at, text: s.text, call: str(s.call) ? s.call : null, reads: readReading(s.reads) }] : []))
		: [];
	const approvals = Array.isArray(raw.approvals) ? raw.approvals.flatMap((a) => readApproval(a) ?? []) : [];
	return { live: true, cause: isCause(raw.cause) ? raw.cause : null, taken: raw.taken === true, plan: readPlan(raw.plan), steps, approvals, files };
}
