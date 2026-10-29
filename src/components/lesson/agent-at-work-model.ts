import { QUESTION_TOOLS, type JobRecord, type LhViewMessage, type LhViewPart } from "@/core";

/**
 * What the teacher is doing in the reply it is working on, read from that
 * reply's tool calls: its plan (the newest work_plan call), the steps it
 * took since that plan, and the file it is reading. One message can hold
 * several replies, since an answered question continues the same group.
 */

export interface WorkPlan {
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
export const STEP_TOOLS: ReadonlySet<string> = new Set(["read", "grep", "find", "ls", "pdf", "research", "demo", "visual", "read_class"]);

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
		case "read_class":
			return "read the class card";
		default:
			return null;
	}
}

function planOf(input: Record<string, unknown>): WorkPlan | null {
	const { items, done } = input;
	if (!Array.isArray(items) || !items.every((i) => typeof i === "string") || typeof done !== "number") return null;
	return { items, done: Math.max(0, Math.min(done, items.length)) };
}

export function agentWork(message: LhViewMessage | undefined, jobs: readonly JobRecord[]): AgentWork {
	const parts = message?.role === "assistant" ? message.parts : [];
	let plan: WorkPlan | null = null;
	let planStart = 0;
	const steps: string[] = [];
	let reading: ReadingTarget | null = null;
	for (const part of parts) {
		const tool = toolOf(part);
		if (!tool) continue;
		// An answered question ended a reply: what came before belongs to it.
		if (part.state === "output-available" && (QUESTION_TOOLS as readonly string[]).includes(tool)) {
			plan = null;
			planStart = 0;
			steps.length = 0;
			reading = null;
			continue;
		}
		const input = inputOf(part);
		if (tool === "work_plan") {
			const next = planOf(input);
			if (next) {
				plan = next;
				planStart = steps.length;
			}
			continue;
		}
		const label = stepLabel(tool, input);
		if (label) steps.push(label);
		const path = str(input.path);
		if (tool === "read" && path && !IMAGE_EXT.test(path)) {
			const from = int(input.offset);
			const limit = int(input.limit);
			reading = { kind: "text", path, name: baseName(path), from, to: from && limit ? from + limit - 1 : null };
		}
		if (tool === "pdf" && path) {
			const job = jobs.find((j) => j.toolCallId === part.toolCallId);
			const progress = job?.activity ? pdfActivity(job.activity) : null;
			if (progress) steps.push(progress.step);
			reading = { kind: "pdf", path, name: baseName(path), page: progress?.page ?? null };
		}
	}
	const last = parts.at(-1);
	const replied = last?.type === "text" && typeof last.text === "string" && last.text.trim().length > 0;
	return { plan, steps: steps.slice(planStart), reading, replied };
}

/** A page holds this many printed rows; a long line wraps every ROW_CHARS characters. */
export const ROWS_PER_PAGE = 44;
const ROW_CHARS = 58;

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
