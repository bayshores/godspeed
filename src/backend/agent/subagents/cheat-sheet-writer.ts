/**
 * THE CHEAT SHEET WRITER: one message of a sheet's chat as one short
 * request on the single-submit seam (runSubmitAgent), so the connected
 * agent gets it as one labeled work item ("Cheat sheet · CSE 21 Midterm").
 * The agent may look things up in the space's files (search_space_files,
 * read_passage), makes or changes the PDF with its own tools in the
 * sheet's working folder, and answers with one sheet_reply call: its
 * words, and the new PDF's path and any rules the learner set when there
 * are some.
 *
 * Only the model talks here; what the app sends and keeps, and how a PDF
 * is checked and taken, is server/cheat-sheets.ts.
 */
import { Type, type Static } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { UserMessage } from "@earendil-works/pi-ai";
import type { PiEngine } from "../models.ts";
import { MAX_PAGES, type SheetPage } from "../../../shared/core/cheat-sheet.ts";
import { RULE_MAX_CHARS } from "../../../shared/core/teaching-areas.ts";
import { runSubmitAgent } from "./submit-agent.ts";

const CHEAT_SHEET_INSTRUCTIONS = `You help a learner with their cheat sheet: the notes they may bring into one exam, a real PDF you make in a working folder. Each request is one message from the learner about it, with the exam, its topics, their mistakes, the sheet's rules and the chat so far. Reply with one sheet_reply call.

- A question ("what does pool mean?"): answer it in plain words in text and leave the sheet alone. If the sheet's wording caused the confusion, also fix the sheet.
- A change, or something on the sheet that is wrong or would confuse a beginner: edit the source in the working folder, compile it, check it (below) and send the PDF as pdf_path, with a short note in text of what changed.
- When the learner says something that should hold for every later change ("A4, both sides", "no slang"), put it in new_rules, one short line each. Follow every one of the sheet's rules.
- Write for a beginner who barely studied: plain words, no slang, no notation the space doesn't use. Methods that work for any problem of a kind, never one practice problem's details. A mistake becomes the rule it broke. Where one part depends on another, say where to look ("see card 4").
- Where the sheet's rules don't settle the space's rules for this exam (paper size, sides, what's allowed), find them with search_space_files and read_passage. Never break them.
- Keep the source in the working folder (LaTeX works well: sheet.tex with latexmk, tectonic or pdflatex). A change edits it; don't start over. One PDF page per side. Black on white unless asked. No em-dashes.
- Before sending a PDF, check it: count the pages and check their size (pdfinfo); render each page to an image (pdftoppm -r 60 -png) and look at every one; nothing runs off a page, overlaps or is too small to read; every formula and method agrees with the space's material. Fix what you find first.`;

const replySchema = Type.Object({
	text: Type.String({ minLength: 1, description: "Your answer to the learner, in markdown with $LaTeX$ math. When you changed the sheet, say what changed in a line or two." }),
	pdf_path: Type.Optional(Type.String({ minLength: 1, description: `Only when you made or changed the sheet: the new PDF, inside the working folder (absolute, or relative to it). 1 to ${MAX_PAGES} pages.` })),
	new_rules: Type.Optional(
		Type.Array(Type.String({ minLength: 1, maxLength: RULE_MAX_CHARS }), { description: "Requirements the learner just set that should hold for every later change of this sheet, one short line each." }),
	),
});
type ReplySubmit = Static<typeof replySchema>;

/** A PDF godspeed checked and read. */
export interface TakenPdf {
	bytes: Uint8Array;
	pages: SheetPage[];
	/** Its real path, in the working folder. */
	file: string;
}

/** The agent's answer to one message. */
interface SheetReply {
	text: string;
	pdf: TakenPdf | null;
	rules: string[];
}

/** Answer one message about the sheet. Throws when the agent never sends a
 *  usable reply. */
export async function replyOnSheet(input: {
	/** "CSE 21 Midterm": the work item's label. */
	title: string;
	/** The request (core cheatSheetRequestText), with the learner's pictures. */
	prompt: UserMessage["content"];
	lookups: AgentTool<any>[];
	/** Checks and reads the PDF at a path: it, or why it can't be used. */
	takePdf: (path: string) => Promise<TakenPdf | string>;
	engine: PiEngine | undefined;
	signal?: AbortSignal;
}): Promise<SheetReply> {
	let pdf: TakenPdf | null = null;
	const reply = await runSubmitAgent<{ text: string; path?: string; rules: string[] }>({
		toolName: "sheet_reply",
		toolDescription: "Answer the learner: your words, and the new PDF's path when you made or changed the sheet.",
		parameters: replySchema,
		fill: (raw: ReplySubmit) => ({ text: raw.text, ...(raw.pdf_path ? { path: raw.pdf_path } : {}), rules: raw.new_rules ?? [] }),
		// The PDF is read here, once, so what was checked is what is kept.
		validate: async ({ path }) => {
			pdf = null;
			if (!path) return null;
			const got = await input.takePdf(path);
			if (typeof got === "string") return got;
			pdf = got;
			return null;
		},
		systemPrompt: CHEAT_SHEET_INSTRUCTIONS,
		prompt: input.prompt,
		lookups: input.lookups,
		maxTurns: 10,
		taskLabel: `Cheat sheet: ${input.title}`,
		engine: input.engine,
		signal: input.signal,
		onStep: () => {},
		neverSubmitted: "the agent never answered",
	});
	return { text: reply.text, pdf, rules: reply.rules };
}
