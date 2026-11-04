/**
 * THE CHEAT SHEET WRITER: one short request on the single-submit seam
 * (runSubmitAgent), so the connected agent gets it as one labeled work
 * item ("Cheat sheet · CSE 21 Midterm"). The agent may look up the class's
 * rules in its files (search_class_files, read_passage), makes the sheet
 * as a PDF with its own tools in the sheet's working folder, and sends its
 * path with one write_cheat_sheet call: a new sheet, or the current one
 * changed as the learner asked.
 *
 * Only the model talks here; what the app sends and keeps, and how a PDF
 * is checked and taken, is server/cheat-sheets.ts.
 */
import { Type, type Static } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { UserMessage } from "@earendil-works/pi-ai";
import type { PiEngine } from "../models.ts";
import { MAX_PAGES, type SheetPage } from "../../core/cheat-sheet.ts";
import { runSubmitAgent } from "./submit-agent.ts";

const CHEAT_SHEET_INSTRUCTIONS = `You make a student's cheat sheet as a real PDF: the notes their class lets them bring into one exam. You get what the student asks, the exam's topics with how well they know each, their mistakes in practice, some of the class's facts and a working folder. Make the PDF with your own tools and send it with one write_cheat_sheet call.

- Do what the student asks. Where they don't say, follow the class's rules for this exam (paper size, one side or both, handwritten or printed, what's not allowed): find them with search_class_files and read_passage, unless the request already settles them. Never break those rules.
- Otherwise: dense formulas, definitions and one-line rules, weak topics and the student's mistakes first with the most room, topics they know well short or left out. Use the class's notation. No intros.
- Write the source in the working folder and keep it there. LaTeX works well (sheet.tex, compiled with latexmk, tectonic or pdflatex; TikZ for flowcharts); anything that makes a good PDF is fine. A change edits that source; don't start over.
- One PDF page per side: two pages are the front and back. Before sending, check the page count and that nothing runs off a page or overlaps.
- Black on white unless asked for color.
- Plain words, no em-dashes.`;

const writeSchema = Type.Object({
	pdf_path: Type.String({ minLength: 1, description: `The finished PDF, inside the working folder (absolute, or relative to it). 1 to ${MAX_PAGES} pages.` }),
});
type WriteSubmit = Static<typeof writeSchema>;

/** A PDF godspeed checked and read. */
export interface TakenPdf {
	bytes: Uint8Array;
	pages: SheetPage[];
}

/** Make a sheet, or change one. Throws when the agent never sends a usable PDF. */
export async function writeSheet(input: {
	/** "CSE 21 Midterm": the work item's label. */
	title: string;
	/** The request (core cheatSheetRequestText), with the learner's pictures. */
	prompt: UserMessage["content"];
	lookups: AgentTool<any>[];
	/** Checks and reads the PDF at a path: it, or why it can't be used. */
	takePdf: (path: string) => Promise<TakenPdf | string>;
	engine: PiEngine | undefined;
	signal?: AbortSignal;
}): Promise<TakenPdf> {
	let taken: TakenPdf | undefined;
	await runSubmitAgent<{ path: string }>({
		toolName: "write_cheat_sheet",
		toolDescription: "Send the finished cheat sheet: the path of the PDF you made.",
		parameters: writeSchema,
		fill: (raw: WriteSubmit) => ({ path: raw.pdf_path }),
		// The PDF is read here, once, so what was checked is what is kept.
		validate: async ({ path }) => {
			const got = await input.takePdf(path);
			if (typeof got === "string") return got;
			taken = got;
			return null;
		},
		systemPrompt: CHEAT_SHEET_INSTRUCTIONS,
		prompt: input.prompt,
		lookups: input.lookups,
		maxTurns: 10,
		taskLabel: `Cheat sheet · ${input.title}`,
		engine: input.engine,
		signal: input.signal,
		onStep: () => {},
		neverSubmitted: "the agent never sent the cheat sheet",
	});
	if (!taken) throw new Error("the agent never sent the cheat sheet");
	return taken;
}
