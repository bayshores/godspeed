import { isQuestionTool, type JobRecord, type LhViewMessage, type LhViewPart } from "@/shared/core";

/**
 * What the teacher is doing in the reply it is working on, read from that
 * reply's tool calls: its plan (the newest work_plan call), the steps it
 * took since that plan, and the file it is reading. One message can hold
 * several replies, since an answered question continues the same group.
 */

interface WorkPlan {
	items: string[];
	done: number;
}

export type ReadingTarget =
	| { kind: "text"; path: string; name: string; from: number | null; to: number | null }
	| { kind: "pdf"; path: string; name: string; page: number | null };

export interface AgentWork {
	plan: WorkPlan | null;
	steps: string[];
	reading: ReadingTarget | null;
	/** The reply's text has arrived (the view gives way to it). */
	replied: boolean;
}

/** Tools whose cards the view stands in for while the reply is in flight. */
export const STEP_TOOLS: ReadonlySet<string> = new Set([
	"read",
	"grep",
	"find",
	"ls",
	"pdf",
	"research",
	"demo",
	"visual",
	"read_space",
	"search_space_files",
	"read_passage",
	"search_graph",
]);

/** The space's files as the lesson's space card lists them, with the path the teacher can open. */
export interface CardFile {
	name: string;
	kind: "study" | "info";
	path: string | null;
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp)$/i;

const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).at(-1) ?? p;

const toolOf = (part: LhViewPart): string | null => (part.type.startsWith("tool-") ? part.type.slice("tool-".length) : null);

const inputOf = (part: LhViewPart): Record<string, unknown> => (part.input && typeof part.input === "object" ? (part.input as Record<string, unknown>) : {});

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);

/** A page spec ("3", "3-5", "1,3,7") as its first and last page; "all" or junk is null. */
export function pageSpanOf(spec: string): [number, number] | null {
	const pages = spec
		.split(",")
		.flatMap((piece) => piece.trim().split("-"))
		.map((n) => Number(n.trim()))
		.filter((n) => Number.isInteger(n) && n > 0);
	return pages.length > 0 ? [Math.min(...pages), Math.max(...pages)] : null;
}

const pagesLabel = ([a, b]: [number, number]) => (a === b ? `page ${a}` : `pages ${a} to ${b}`);

/** The PDF reader's progress line ("pdf_extract: 3-5") as a step and the page it is on. */
export function pdfActivity(activity: string): { step: string; page: number | null } | null {
	const [verb, ...rest] = activity.split(":");
	const arg = rest.join(":").trim();
	if (verb === "pdf_info") return { step: "skimmed every page", page: null };
	if (verb === "pdf_search") return { step: `searched it for ${arg}`, page: null };
	if (verb === "save_page") {
		const page = int(Number(arg));
		return page ? { step: `kept page ${page} for later`, page } : null;
	}
	if (verb === "pdf_extract" || verb === "pdf_render") {
		const span = pageSpanOf(arg.split("@")[0] ?? "");
		if (!span) return { step: verb === "pdf_extract" ? "read every page" : "looked closely at every page", page: null };
		return { step: verb === "pdf_extract" ? `read ${pagesLabel(span)}` : `looked closely at ${pagesLabel(span)}`, page: span[0] };
	}
	return null;
}

function stepLabel(tool: string, input: Record<string, unknown>): string | null {
	const path = str(input.path);
	switch (tool) {
		case "read": {
			if (!path) return null;
			const offset = int(input.offset);
			const limit = int(input.limit);
			if (offset && limit) return `read lines ${offset} to ${offset + limit - 1} of ${baseName(path)}`;
			if (offset) return `read ${baseName(path)} from line ${offset}`;
			return `opened ${baseName(path)}`;
		}
		case "grep": {
			const pattern = str(input.pattern);
			if (!pattern) return null;
			return path ? `searched ${baseName(path)} for "${pattern}"` : `searched for "${pattern}"`;
		}
		case "find":
			return str(input.pattern) ? `looked for files named ${input.pattern as string}` : null;
		case "ls":
			return path ? `looked in ${baseName(path)}` : "looked in your home folder";
		case "pdf":
			return path ? `opened ${baseName(path)}` : null;
		case "research":
			return "started a web check";
		case "demo":
			return "started building a demo";
		case "visual":
			return "started drawing a figure";
		case "read_space":
			return "read the space card";
		case "search_space_files":
			return str(input.query) ? `searched your files for "${input.query as string}"` : null;
		case "search_graph":
			return "checked what you already studied";
		default:
			return null;
	}
}

function planOf(input: Record<string, unknown>): WorkPlan | null {
	const { items, done } = input;
	if (!Array.isArray(items) || !items.every((i) => typeof i === "string") || typeof done !== "number") return null;
	return { items, done: Math.max(0, Math.min(done, items.length)) };
}

/** A passage of a space file: its file's id and name and its place ("lines 1–21", "p. 3"). */
interface Passage {
	fileId: string;
	name: string;
	range: string;
}

const PASSAGE_ID = /^(f_[0-9a-f]{12}):\d+$/;

/** search_space_files' hits, one line each: "<passage id> · <file name> · <place>". */
function searchHits(output: unknown): [string, Passage][] {
	if (typeof output !== "string") return [];
	return output.split("\n").flatMap((line): [string, Passage][] => {
		const pieces = line.split(" · ");
		const id = PASSAGE_ID.exec(pieces[0] ?? "");
		return id && pieces.length >= 3 ? [[pieces[0]!, { fileId: id[1]!, name: pieces.slice(1, -1).join(" · "), range: pieces.at(-1)! }]] : [];
	});
}

/** The passage read_passage read, from its result's first line ("<file name> · <place> · <passage id>"), or before
 *  that arrives, from the search that found it. */
function passageRead(part: LhViewPart, input: Record<string, unknown>, hits: ReadonlyMap<string, Passage>): Passage | null {
	const pieces = typeof part.output === "string" ? (part.output.split("\n")[0] ?? "").split(" · ") : [];
	const id = PASSAGE_ID.exec(pieces.at(-1)?.split(" to ")[0] ?? "");
	if (id && pieces.length >= 3) return { fileId: id[1]!, name: pieces.slice(0, -2).join(" · "), range: pieces.at(-2)! };
	const asked = str(input.passage_id);
	return asked ? (hits.get(asked) ?? null) : null;
}

/** Where on the computer a passage's file is: a copied file's path holds its id; else the card file of that name. */
function passagePath(p: Passage, files: readonly CardFile[]): string | null {
	const file = files.find((f) => f.path?.includes(`/${p.fileId}/`)) ?? files.find((f) => f.name === p.name);
	return file?.path ?? null;
}

/** The desk shows text and PDF pages; Word, PowerPoint and EPUB files it can't. */
export const deskShows = (path: string): boolean => !/\.(docx|pptx|epub)$/i.test(path);

/** A passage's file open at the lines (or the PDF page) read. */
function passageReading(p: Passage, files: readonly CardFile[]): ReadingTarget | null {
	const path = passagePath(p, files);
	if (!path || !deskShows(path)) return null;
	if (/\.pdf$/i.test(path)) {
		const page = /^p\. (\d+)$/.exec(p.range);
		return { kind: "pdf", path, name: p.name, page: page ? Number(page[1]) : null };
	}
	const lines = /^lines (\d+)–(\d+)$/.exec(p.range);
	return { kind: "text", path, name: p.name, from: lines ? Number(lines[1]) : null, to: lines ? Number(lines[2]) : null };
}

/** What one tool call adds to the desk: its step lines and the file it opens. `hits` gathers the
 *  passages searches found, so a passage being read is named before its own result arrives. */
function toolStep(part: LhViewPart, tool: string, jobs: readonly JobRecord[], files: readonly CardFile[], hits: Map<string, Passage>): { steps: string[]; reading: ReadingTarget | null } {
	const input = inputOf(part);
	const path = str(input.path);
	if (tool === "search_space_files") for (const [id, p] of searchHits(part.output)) hits.set(id, p);
	if (tool === "read_passage") {
		const p = passageRead(part, input, hits);
		return p ? { steps: [`read ${p.range.replace(/^p\. /, "page ").replace("–", " to ")} of ${p.name}`], reading: passageReading(p, files) } : { steps: [], reading: null };
	}
	const label = stepLabel(tool, input);
	const steps = label ? [label] : [];
	if (tool === "read" && path && !IMAGE_EXT.test(path)) {
		const from = int(input.offset);
		const limit = int(input.limit);
		return { steps, reading: { kind: "text", path, name: baseName(path), from, to: from && limit ? from + limit - 1 : null } };
	}
	if (tool === "pdf" && path) {
		const job = jobs.find((j) => j.toolCallId === part.toolCallId);
		const progress = job?.activity ? pdfActivity(job.activity) : null;
		if (progress) steps.push(progress.step);
		return { steps, reading: { kind: "pdf", path, name: baseName(path), page: progress?.page ?? null } };
	}
	return { steps, reading: null };
}

/** The reply's work. `files` are the space card's, where a passage the teacher reads is found. */
export function agentWork(message: LhViewMessage | undefined, jobs: readonly JobRecord[], files: readonly CardFile[]): AgentWork {
	const parts = message?.role === "assistant" ? message.parts : [];
	let plan: WorkPlan | null = null;
	let planStart = 0;
	const steps: string[] = [];
	let reading: ReadingTarget | null = null;
	const hits = new Map<string, Passage>();
	for (const part of parts) {
		const tool = toolOf(part);
		if (!tool) continue;
		// An answered question ended a reply: what came before belongs to it.
		if (part.state === "output-available" && isQuestionTool(tool)) {
			plan = null;
			planStart = 0;
			steps.length = 0;
			reading = null;
			continue;
		}
		if (tool === "work_plan") {
			const next = planOf(inputOf(part));
			if (next) {
				plan = next;
				planStart = steps.length;
			}
			continue;
		}
		const step = toolStep(part, tool, jobs, files, hits);
		steps.push(...step.steps);
		reading = step.reading ?? reading;
	}
	const last = parts.at(-1);
	const replied = last?.type === "text" && typeof last.text === "string" && last.text.trim().length > 0;
	return { plan, steps: steps.slice(planStart), reading, replied };
}

/** The path of the file the lesson's teacher read last, in any reply. */
export function lastRead(messages: readonly LhViewMessage[], files: readonly CardFile[]): string | null {
	const hits = new Map<string, Passage>();
	let path: string | null = null;
	for (const m of messages) {
		if (m.role !== "assistant") continue;
		for (const part of m.parts) {
			const tool = toolOf(part);
			if (tool) path = toolStep(part, tool, [], files, hits).reading?.path ?? path;
		}
	}
	return path;
}

/** A page holds this many printed rows; a long line wraps every ROW_CHARS characters. */
export const ROWS_PER_PAGE = 38;
const ROW_CHARS = 64;

/** A text file cut into pages by printed rows; `start` is the first line's number. */
export function textPages(text: string): { start: number; lines: string[] }[] {
	const pages: { start: number; lines: string[] }[] = [];
	let rows = ROWS_PER_PAGE;
	text.split("\n").forEach((line, i) => {
		const need = Math.max(1, Math.ceil(line.length / ROW_CHARS));
		if (rows + need > ROWS_PER_PAGE && rows > 0) {
			pages.push({ start: i + 1, lines: [] });
			rows = 0;
		}
		pages.at(-1)!.lines.push(line);
		rows += need;
	});
	return pages;
}
