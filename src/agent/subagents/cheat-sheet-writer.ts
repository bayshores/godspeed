/**
 * THE CHEAT SHEET WRITER: one short request on the single-submit seam
 * (runSubmitAgent), so the connected agent gets it as one labeled work
 * item ("Cheat sheet · CSE 21 Midterm"). The agent may look up the class's
 * rules in its files (search_class_files, read_passage), then sends the
 * whole sheet with one write_cheat_sheet call: a new one, or the current
 * one changed as the learner asked.
 *
 * Only the model talks here; what the app sends and keeps is
 * server/cheat-sheets.ts.
 */
import { Type, type Static } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { UserMessage } from "@earendil-works/pi-ai";
import type { PiEngine } from "../models.ts";
import { DOC_MAX_CHARS, MAX_PAGES, PAGE_MAX_IN, PAGE_MIN_IN, docProblem, type CheatSheetDoc } from "../../core/cheat-sheet.ts";
import { runSubmitAgent } from "./submit-agent.ts";

const CHEAT_SHEET_INSTRUCTIONS = `You make a student's cheat sheet: the notes their class lets them bring into one exam. You get what the student asks, the exam's topics with how well they know each, their mistakes in practice and some of the class's facts. Send the whole sheet with one write_cheat_sheet call.

- Do what the student asks. Where they don't say, follow the class's rules for this exam (paper size, one side or both, handwritten or printed, what's not allowed): find them with search_class_files and read_passage, unless the request or the current sheet already settles them. Never break those rules.
- Otherwise: dense formulas, definitions and one-line rules, weak topics and the student's mistakes first with the most room, topics they know well short or left out. Use the class's notation. No intros.
- You pick the page size in inches (letter 8.5 x 11, A4 8.27 x 11.69, a 3 x 5 card is 5 x 3) and write each page as an HTML body; two pages are the front and back. Lay it out with your css: columns, text size, boxes. Fit everything inside its page; the app shows the student a page that runs over.
- Black ink on white unless asked for color. Math in $...$ and $$...$$ (LaTeX, rendered for you); \\$ is a dollar sign. Flowcharts and diagrams as inline SVG or HTML boxes. No scripts, links, outside images or fonts.
- Asked to change a sheet: you get the current one. Send it back whole, changed only as asked.
- Plain words, no em-dashes.`;

const writeSchema = Type.Object({
	width_in: Type.Number({ minimum: PAGE_MIN_IN, maximum: PAGE_MAX_IN, description: "Page width in inches." }),
	height_in: Type.Number({ minimum: PAGE_MIN_IN, maximum: PAGE_MAX_IN, description: "Page height in inches." }),
	css: Type.Optional(Type.String({ description: "CSS for every page (body is the page)." })),
	pages: Type.Array(Type.String({ minLength: 1 }), {
		minItems: 1,
		maxItems: MAX_PAGES,
		description: `Each page's HTML body, in order; two pages are the front and back. All of it under ${DOC_MAX_CHARS} characters.`,
	}),
});
type WriteSubmit = Static<typeof writeSchema>;

/** Write a sheet, or change one. Throws when the agent never sends it. */
export async function writeSheet(input: {
	/** "CSE 21 Midterm": the work item's label. */
	title: string;
	/** The request (core cheatSheetRequestText), with the learner's pictures. */
	prompt: UserMessage["content"];
	lookups: AgentTool<any>[];
	engine: PiEngine | undefined;
	signal?: AbortSignal;
}): Promise<CheatSheetDoc> {
	return runSubmitAgent<CheatSheetDoc>({
		toolName: "write_cheat_sheet",
		toolDescription: "Send the whole cheat sheet: the page size and each page's HTML.",
		parameters: writeSchema,
		fill: (raw: WriteSubmit): CheatSheetDoc => ({ widthIn: raw.width_in, heightIn: raw.height_in, css: raw.css ?? "", pages: raw.pages }),
		validate: docProblem,
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
}
