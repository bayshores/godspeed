/**
 * The lesson's box, there for the whole lesson: for each state of "Your
 * turn", the box's keys, what Enter does in it and the "Stuck?" keys over it.
 * The learner talks to the teacher here: beside an answer key, the ask key
 * sends the box's words as a question and leaves what waits open. A
 * problem's box takes work and questions alike, plain messages the teacher
 * reads. With nothing waiting the box only asks. Pure.
 */
import { answerTakesFiles, parseAskInput, parseExplainInput, toolQuestionKind, type AppPosed, type ToggleableTool } from "@/shared/core";

/** What waits in "Your turn". */
export type BoxTurn =
	/** The open problem, worked on in the box. `picked`: a choice of its is picked, which is
	 *  enough to send. */
	| { kind: "problem"; picked: boolean }
	/** The answer is picked above the box (choices, or the code editor).
	 *  `ownAnswer`: an ask whose box text is the answer when nothing is
	 *  picked (then `picked` says there is text). `appPosed`: the app asked it (the next topic's opener, or a question
	 *  from earlier). */
	| { kind: "choice"; picked: boolean; appPosed?: AppPosed["kind"]; ownAnswer?: true }
	/** The box text is the answer. */
	| { kind: "written"; takesFiles: boolean }
	/** Nothing waits: the box asks the teacher something. `nextKey`: the
	 *  next state's key shows above it, and stays the sheet's bright key. */
	| { kind: "ask"; nextKey: boolean }
	/** A lesson end asks for the learner's own words on a note; `ready`: the text can be saved; `leave`: the label of the key that ends the day. */
	| { kind: "words"; ready: boolean; leave: string | null };

export type BoxAction = "send" | "submit" | "skip" | "save" | "leave";

export interface BoxButton {
	action: BoxAction;
	label: string;
	filled: boolean;
	disabled: boolean;
}

export interface BoxView {
	placeholder: string;
	/** The ask key, then the answer key; a problem and the ask state have one. At most one is filled. */
	keys: BoxButton[];
	/** What Enter in the box does; null makes a new line. */
	enter: BoxAction | null;
	/** Whether what the box sends carries attached files, so the Attach button shows. */
	attach: boolean;
	/** The "Stuck?" keys; none with nothing waiting. */
	help: HelpKeys | null;
}

/** What the teacher can be asked for in any lesson, and the tool each needs (Settings switches
 *  a tool off). */
const LESSON_IDEAS: readonly { line: string; tool: ToggleableTool | null }[] = [
	{ line: "Draw it", tool: "visual" },
	{ line: "Show a demo", tool: "demo" },
	{ line: "Look it up", tool: "research" },
	{ line: "Quiz me", tool: null },
];

/** The "Try asking" lines under the box while nothing waits, each sent as if typed in it.
 *  `tools`: the tools' switches from Settings; one not named is on. */
export function lessonIdeas(tools: Readonly<Record<string, boolean>>): string[] {
	return LESSON_IDEAS.filter((i) => i.tool === null || (tools[i.tool] ?? true)).map((i) => i.line);
}

/** The lines the hint and simpler keys send, as if typed in the box. */
export const HELP_LINES = { hint: "Give me a hint", simpler: "Explain it simpler" } as const;

export interface HelpKeys {
	/** "I don't know" answers the waiting question, or with a problem open
	 *  is sent like the other two keys. */
	dontKnow: "answer" | "send";
	dontKnowDisabled: boolean;
	/** The hint and simpler keys wait for the teacher. */
	linesDisabled: boolean;
}

/** A waiting question as the box sees it: written in the box, or picked
 *  above it (`picked` says whether an answer is). A question that came
 *  through broken is never answered, so it counts as nothing picked. */
export function questionTurn(tool: string, input: unknown, picked: boolean, appPosed?: AppPosed["kind"]): BoxTurn {
	const kind = toolQuestionKind(tool);
	const ask = kind === "ask" ? parseAskInput(input) : undefined;
	const written = kind === "explain" ? parseExplainInput(input) !== undefined : ask !== undefined && !ask.options?.length;
	// An answer the app asked for (opener, review) is sent without files.
	if (written) return { kind: "written", takesFiles: answerTakesFiles(tool) && !appPosed };
	return { kind: "choice", picked, ...(appPosed ? { appPosed } : {}), ...(ask ? { ownAnswer: true as const } : {}) };
}

export function lessonBox(s: {
	/** The teacher's name, for the ask key. */
	teacher: string;
	/** A reply is being written (or waits for an agent). */
	busy: boolean;
	hasText: boolean;
	hasFiles: boolean;
	turn: BoxTurn;
}): BoxView {
	const { turn } = s;
	// A line sent while the teacher writes steers the reply, and a steer carries no files.
	const steers = !(s.busy && s.hasFiles);
	if (turn.kind === "problem") {
		const canSend = (s.hasText || s.hasFiles || turn.picked) && steers;
		return {
			placeholder: "Your work or a question",
			keys: [{ action: "send", label: "Send", filled: canSend, disabled: !canSend }],
			enter: canSend ? "send" : null,
			attach: true,
			help: { dontKnow: "send", dontKnowDisabled: s.busy, linesDisabled: s.busy },
		};
	}
	if (turn.kind === "words") {
		return {
			placeholder: "One or two sentences",
			keys: [
				...(turn.leave ? [{ action: "leave" as const, label: turn.leave, filled: false, disabled: false }] : []),
				{ action: "skip", label: "Skip", filled: false, disabled: false },
				{ action: "save", label: "Save", filled: turn.ready, disabled: !turn.ready },
			],
			enter: turn.ready ? "save" : null,
			attach: false,
			help: null,
		};
	}
	const ask = (canAsk: boolean, filled: boolean): BoxButton => ({ action: "send", label: `Ask ${s.teacher}`, filled, disabled: !canAsk });
	if (turn.kind === "ask" && s.busy) {
		// A line sent while the teacher works steers what it writes, and a steer carries no files.
		const canSend = s.hasText && steers;
		return {
			placeholder: `Tell ${s.teacher} what to focus on`,
			keys: [{ action: "send", label: "Send", filled: canSend && !turn.nextKey, disabled: !canSend }],
			enter: canSend ? "send" : null,
			attach: false,
			help: null,
		};
	}
	if (turn.kind === "ask") {
		const canAsk = (s.hasText || s.hasFiles) && steers;
		return {
			placeholder: "Your question",
			keys: [ask(canAsk, canAsk && !turn.nextKey)],
			enter: canAsk ? "send" : null,
			attach: true,
			help: null,
		};
	}
	const ready = turn.kind === "choice" ? turn.picked : s.hasText || (turn.takesFiles && s.hasFiles);
	// An answer to a question from earlier wakes nobody, so it goes in while the teacher writes.
	const canAnswer = !s.busy || (turn.kind === "choice" && turn.appPosed === "review");
	const canSubmit = ready && canAnswer;
	// A question beside the open one waits for the teacher: its reply never steers.
	const canAsk = s.hasText && !s.busy;
	// Words under choices with none picked can only be a question.
	const asksOnEnter = turn.kind === "choice" && !turn.ownAnswer && !turn.picked && canAsk;
	return {
		placeholder: turn.kind === "written" || (turn.ownAnswer && !turn.picked) ? "An answer or a question" : "Your reasoning or a question",
		// The bright key is the one Enter presses.
		keys: [ask(canAsk, asksOnEnter), { action: "submit", label: "Submit answer", filled: !asksOnEnter, disabled: !canSubmit }],
		enter: canSubmit ? "submit" : asksOnEnter ? "send" : null,
		attach: turn.kind === "written" ? turn.takesFiles : turn.ownAnswer === true && !turn.appPosed,
		help: { dontKnow: "answer", dontKnowDisabled: !canAnswer, linesDisabled: s.busy },
	};
}
