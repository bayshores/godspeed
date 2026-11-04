/**
 * THE CHEAT SHEET WRITER: the model calls behind a cheat sheet, each one
 * short request on the single-submit seam (runSubmitAgent), so the
 * connected agent gets it as one labeled work item ("Cheat sheet · CSE 21
 * Midterm") and answers with one tool call:
 *
 *  - writeSheet: every block at once from the topics, readiness, mistakes,
 *    rules, choices and the page budget (write_cheat_sheet).
 *  - changeBlocks: one to three blocks again (Tighten, Redo, a change the
 *    learner typed, or a topic added back), the same tool.
 *  - readRules: the class's own files searched for its cheat sheet rules
 *    (search_class_files, read_passage, then set_cheat_sheet_rules).
 *
 * Only the model talks here; what the app sends and keeps is
 * server/cheat-sheets.ts.
 */
import { Type, type Static } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { PiEngine } from "../models.ts";
import {
	CHEAT_SHEET_CONTENT,
	CHEAT_SHEET_PAPERS,
	INSTRUCTIONS_MAX,
	PAPERS,
	TEXT_SIZES,
	WATCH_OUT,
	type CheatSheetBlock,
	type CheatSheetContent,
	type CheatSheetRules,
	type CheatSheetWriting,
	type SheetMistake,
	type SheetTopic,
} from "../../core/cheat-sheet.ts";
import { runSubmitAgent } from "./submit-agent.ts";

const CHEAT_SHEET_INSTRUCTIONS = `You write a student's cheat sheet: the notes their class lets them bring into one exam. You get the class's rules, the student's choices, the page budget, the topics with how well the student knows each, and the mistakes they made in practice. Submit with one write_cheat_sheet call.

- One block per listed topic. When mistakes are listed, also a Watch out block (topic_id "${WATCH_OUT}"): one line per mistake, the right method next to the slip.
- Room follows need: weak topics and mistakes get the most, shaky topics are short, untested topics only the key formulas and definitions. Keep each block near its line budget.
- Dense like a real cheat sheet: formulas, definitions and one-line rules. No intros, no full sentences unless needed. Use the class's notation and terms.
- Only the kinds of content listed under "On it", never anything under "Not allowed".
- body: markdown lines, math in $...$, "- " for a short list. No headings, tables or code.
- title: the topic's name, or "Watch out". reason: 2 to 5 words the student sees beside the block, from the data ("Missed twice", "Shaky", "Not tested yet", "Needed a hint"). why: one sentence on what the block focuses on and why. Plain words, no em-dashes.
- The student's own instructions come before these defaults (what goes first, what to leave out, how much room), but never over the class's rules.
- Asked to change blocks: return only those, each with its block_id.`;

const CHEAT_SHEET_RULES_INSTRUCTIONS = `You find a class's cheat sheet rules for one exam in the class's own files: whether a sheet of notes is allowed, the paper (letter one side, letter both sides, a 3 × 5 index card, A4), handwritten or printed, and anything not allowed on it. Search with search_class_files, open what you need with read_passage, then submit once with set_cheat_sheet_rules. Report only what the files say; found is false when they say nothing. source: the file name and page, like "Syllabus.pdf, page 3".`;

const blockSchema = Type.Object({
	block_id: Type.Optional(Type.String({ description: "When changing a block: its id." })),
	topic_id: Type.String({ description: `The topic's id from the list, or "${WATCH_OUT}".` }),
	title: Type.String({ minLength: 1, maxLength: 60 }),
	body: Type.String({ minLength: 1, maxLength: 2000, description: "Markdown lines with $...$ math." }),
	reason: Type.String({ minLength: 1, maxLength: 40, description: "2 to 5 words beside the block." }),
	why: Type.Optional(Type.String({ maxLength: 240, description: "One sentence: what it focuses on and why." })),
});

const writeSchema = Type.Object({ blocks: Type.Array(blockSchema, { minItems: 1 }) });
type WriteSubmit = Static<typeof writeSchema>;

const rulesSchema = Type.Object({
	found: Type.Boolean({ description: "The files say something about a cheat sheet for this exam." }),
	allowed: Type.Optional(Type.Boolean()),
	paper: Type.Optional(Type.Union(CHEAT_SHEET_PAPERS.map((p) => Type.Literal(p)), { description: '"letter" (one side), "letter-both", "index-card" (3 × 5 in) or "a4".' })),
	writing: Type.Optional(Type.Union([Type.Literal("printed"), Type.Literal("by-hand")])),
	banned: Type.Optional(Type.Array(Type.String(), { description: 'What may not go on it, a few words each ("Worked examples").' })),
	source: Type.Optional(Type.String({ description: 'Where it says so: "Syllabus.pdf, page 3".' })),
});
type RulesSubmit = Static<typeof rulesSchema>;

/** One block as the agent wrote it. */
export type WrittenBlock = Pick<CheatSheetBlock, "topicId" | "title" | "body" | "reason" | "why"> & { blockId?: string };

/** A topic as the request lists it: its line budget and a few of its facts. */
export interface RequestTopic extends SheetTopic {
	lines: number;
	facts: { name: string; statement: string }[];
}

interface SheetRequest {
	/** "CSE 21 Midterm": the work item's label and the prompt's header. */
	title: string;
	/** The learner's words about the class (notation, textbook). */
	classNotes: string;
	/** The learner's own words for this sheet. */
	instructions: string;
	date: string;
	rules: CheatSheetRules;
	content: CheatSheetContent[];
	textSize: keyof typeof TEXT_SIZES;
	columns: number;
	linesPerColumn: number;
	topics: RequestTopic[];
	mistakes: readonly SheetMistake[];
	/** Every topic of the deadline by id (a mistake names its topic). */
	topicNames: ReadonlyMap<string, string>;
	engine: PiEngine | undefined;
	signal?: AbortSignal;
}

const STATUS_WORDS: Record<SheetTopic["status"], string> = { weak: "weak", shaky: "shaky", untested: "not tested yet", strong: "strong" };
const WRITING_WORDS: Record<CheatSheetWriting, string> = { printed: "printed", "by-hand": "copied by hand" };

function oneLine(text: string, max: number): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

/** The part every request shares: the exam, the rules, the choices, the budget. */
function sheetHeader(r: SheetRequest): string {
	const paper = PAPERS[r.rules.paper];
	const onIt = CHEAT_SHEET_CONTENT.filter((c) => r.content.includes(c.id)).map((c) => c.label.toLowerCase());
	return [
		`Exam: ${r.title} on ${r.date}`,
		r.classNotes ? `About the class: ${oneLine(r.classNotes, 300)}` : "",
		`Paper: ${paper.label} (${paper.size}), ${WRITING_WORDS[r.rules.writing]}, ${TEXT_SIZES[r.textSize].label.toLowerCase()} text, ${r.columns} columns of about ${r.linesPerColumn} lines${paper.sides === 2 ? " on each side" : ""}.`,
		`On it: ${onIt.join(", ") || "formulas"}`,
		r.rules.banned.length > 0 ? `Not allowed: ${r.rules.banned.join("; ")}` : "",
		r.instructions ? `The student's own instructions: ${oneLine(r.instructions, INSTRUCTIONS_MAX)}` : "",
	]
		.filter(Boolean)
		.join("\n");
}

function topicLines(t: RequestTopic): string {
	const facts = t.facts.map((f) => `  - ${f.name}: ${oneLine(f.statement, 140)}`);
	return [`${t.id} | ${t.name} | ${STATUS_WORDS[t.status]}${t.mistakes > 0 ? `, ${t.mistakes} ${t.mistakes === 1 ? "mistake" : "mistakes"}` : ""} | about ${t.lines} lines`, ...facts].join("\n");
}

function mistakeLines(mistakes: readonly SheetMistake[], names: ReadonlyMap<string, string>): string {
	return mistakes.map((m) => `- ${m.kind === "hint" ? "needed hints" : "answered wrong"} (${names.get(m.topicId) ?? m.topicId}): "${m.text}"`).join("\n");
}

/** The request for a whole sheet. */
function sheetPrompt(r: SheetRequest, watchOutLines: number): string {
	return [
		sheetHeader(r),
		`Topics (id | name | how the student does | budget), with some of the class's facts:\n${r.topics.map(topicLines).join("\n")}`,
		r.mistakes.length > 0 && r.content.includes("mistakes") ? `Mistakes for the Watch out block (about ${watchOutLines} lines):\n${mistakeLines(r.mistakes, r.topicNames)}` : "",
	]
		.filter(Boolean)
		.join("\n\n");
}

/** The request for one to three blocks: tighten, redo, the learner's own words, or a topic added back. */
function changePrompt(r: SheetRequest, change: BlockChange): string {
	const how =
		change.how === "tighten"
			? "Make each shorter: the same key facts in fewer lines, about two thirds of its length. Cut words, keep the formulas."
			: change.how === "redo"
				? "Write each again from scratch, a better way."
				: change.how === "add"
					? "Write a block for this topic. The student knows it well, so only what they'd still want to glance at."
					: `The student asks: "${oneLine(change.text ?? "", 400)}"`;
	const blocks = change.blocks.map((b) => `block_id ${b.id} | topic_id ${b.topicId} | ${b.title}\n${b.body}`).join("\n\n");
	const topics = r.topics.filter((t) => change.blocks.some((b) => b.topicId === t.id) || change.topicId === t.id);
	return [
		sheetHeader(r),
		`Topics:\n${topics.map(topicLines).join("\n")}`,
		change.blocks.some((b) => b.topicId === WATCH_OUT) && r.mistakes.length > 0 ? `Mistakes:\n${mistakeLines(r.mistakes, r.topicNames)}` : "",
		change.how === "add" ? `Add topic_id ${change.topicId}.` : `Change ${change.blocks.length === 1 ? "this block" : "these blocks"}. ${how}\n\n${blocks}`,
		change.how === "add" ? how : "",
	]
		.filter(Boolean)
		.join("\n\n");
}

function toBlocks(raw: WriteSubmit): WrittenBlock[] {
	return raw.blocks.map((b) => ({
		...(b.block_id ? { blockId: b.block_id } : {}),
		topicId: b.topic_id,
		title: b.title.trim(),
		body: b.body.trim(),
		reason: b.reason.trim(),
		...(b.why?.trim() ? { why: b.why.trim() } : {}),
	}));
}

const WRITE_TOOL = {
	toolName: "write_cheat_sheet",
	toolDescription: "Submit the cheat sheet's blocks (or the changed blocks).",
	parameters: writeSchema,
	fill: toBlocks,
	systemPrompt: CHEAT_SHEET_INSTRUCTIONS,
} as const;

/** Every block of a new sheet. Throws when the agent never submits. */
export async function writeSheet(r: SheetRequest, watchOutLines: number): Promise<WrittenBlock[]> {
	const ids = new Set([...r.topics.map((t) => t.id), WATCH_OUT]);
	return runSubmitAgent<WrittenBlock[]>({
		...WRITE_TOOL,
		taskLabel: `Cheat sheet · ${r.title}`,
		validate: (blocks) => {
			const unknown = blocks.filter((b) => !ids.has(b.topicId)).map((b) => b.topicId);
			if (unknown.length > 0) return `Unknown topic_id: ${unknown.join(", ")}. Use the ids from the list.`;
			const twice = blocks.map((b) => b.topicId).filter((id, i, all) => all.indexOf(id) !== i);
			return twice.length > 0 ? `One block per topic: ${twice.join(", ")} came twice.` : null;
		},
		prompt: sheetPrompt(r, watchOutLines),
		engine: r.engine,
		signal: r.signal,
		onStep: () => {},
		neverSubmitted: "the agent never sent the cheat sheet",
	});
}

/** What the learner asked of some blocks. */
export interface BlockChange {
	how: "tighten" | "redo" | "ask" | "add";
	/** The blocks to change (none when adding a topic). */
	blocks: readonly Pick<CheatSheetBlock, "id" | "topicId" | "title" | "body">[];
	/** The learner's words ("ask"). */
	text?: string;
	/** The topic to add ("add"). */
	topicId?: string;
}

/** The changed blocks (each with its block_id), or the added one. */
export async function changeBlocks(r: SheetRequest, change: BlockChange): Promise<WrittenBlock[]> {
	const wanted = change.blocks.map((b) => b.id);
	return runSubmitAgent<WrittenBlock[]>({
		...WRITE_TOOL,
		taskLabel: `Cheat sheet · ${r.title}`,
		validate: (blocks) => {
			if (change.how === "add") return blocks.length === 1 && blocks[0]!.topicId === change.topicId ? null : `Send one block with topic_id ${change.topicId}.`;
			const got = blocks.map((b) => b.blockId ?? "");
			return wanted.length === got.length && wanted.every((id) => got.includes(id)) ? null : `Send exactly these blocks, each with its block_id: ${wanted.join(", ")}.`;
		},
		prompt: changePrompt(r, change),
		engine: r.engine,
		signal: r.signal,
		onStep: () => {},
		neverSubmitted: "the agent never sent the changed blocks",
	});
}

/** What the agent found about the rules (found false = nothing). */
type FoundRules = { found: false } | { found: true; rules: Partial<CheatSheetRules> };

/** Search the class's files for the cheat sheet rules. */
export async function readRules(input: {
	title: string;
	date: string;
	/** The class's course-info files (syllabus, policies). */
	infoFiles: readonly string[];
	lookups: AgentTool<any>[];
	engine: PiEngine | undefined;
	signal?: AbortSignal;
}): Promise<FoundRules> {
	const files = input.infoFiles.length > 0 ? `Course info files: ${input.infoFiles.join(", ")}` : "The class has no course info files; search all its files.";
	return runSubmitAgent<FoundRules>({
		toolName: "set_cheat_sheet_rules",
		toolDescription: "Submit the cheat sheet rules the class's files give for this exam.",
		parameters: rulesSchema,
		fill: (raw: RulesSubmit): FoundRules =>
			raw.found
				? {
						found: true,
						rules: {
							...(raw.allowed !== undefined ? { allowed: raw.allowed } : {}),
							...(raw.paper ? { paper: raw.paper } : {}),
							...(raw.writing ? { writing: raw.writing } : {}),
							...(raw.banned ? { banned: raw.banned } : {}),
							...(raw.source?.trim() ? { source: raw.source.trim() } : {}),
						},
					}
				: { found: false },
		systemPrompt: CHEAT_SHEET_RULES_INSTRUCTIONS,
		prompt: `Exam: ${input.title} on ${input.date}\n${files}\nTry searches like "cheat sheet", "notes allowed", "index card", "formula sheet".`,
		lookups: input.lookups,
		maxTurns: 8,
		taskLabel: `Cheat sheet rules · ${input.title}`,
		engine: input.engine,
		signal: input.signal,
		onStep: () => {},
		neverSubmitted: "the agent never sent the rules",
	});
}
