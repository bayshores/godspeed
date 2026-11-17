/**
 * The lesson's answer box: for each thing that waits for the learner, the
 * box's size and button, what Enter does in it, the way out at the end of
 * the foot row and the "Stuck?" keys before it.
 * Talking to the teacher happens in its terminal (use-terminal-lines.ts), so
 * the box takes only answers and work. Pure.
 */
import { answerTakesFiles, parseAskInput, parseExplainInput, toolQuestionKind, type AppPosed } from "@/shared/core";

/** What waits in "Your turn". */
export type BoxTurn =
	/** The open problem, worked on in the box. */
	| { kind: "problem" }
	/** A check waits behind "Check your understanding". */
	| { kind: "read-first" }
	/** The answer is picked above the box (choices, or the code editor).
	 *  `ownAnswer`: an ask whose box text is the answer when nothing is
	 *  picked (then `picked` says there is text). `appPosed`: the app asked it (the next topic's opener, or a question
	 *  from earlier). */
	| { kind: "choice"; picked: boolean; appPosed?: AppPosed["kind"]; ownAnswer?: true }
	/** The box text is the answer. */
	| { kind: "written"; takesFiles: boolean };

export type BoxAction = "send" | "submit" | "reveal";

export interface BoxButton {
	action: BoxAction;
	label: string;
	filled: boolean;
	disabled: boolean;
}

export interface BoxView {
	placeholder: string;
	/** "line": optional text, one line with the button beside it. "lines": text that is the
	 *  answer or the work, three lines with the button inside the box. Both grow to five. */
	size: "line" | "lines";
	button: BoxButton;
	/** What Enter in the box does; null makes a new line. */
	enter: BoxAction | null;
	/** The quiet way out at the end of the foot row. */
	exit: "skip" | "discard";
	/** Whether what the box sends carries attached files, so the Attach button shows. */
	attach: boolean;
	/** The "Stuck?" keys, or null while nothing is asked yet. */
	help: HelpKeys | null;
}

/** The lines the hint and simpler keys send, as if typed in the teacher's terminal. */
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
	/** A reply is being written (or waits for an agent). */
	busy: boolean;
	hasText: boolean;
	hasFiles: boolean;
	turn: BoxTurn;
}): BoxView {
	const { turn } = s;
	if (turn.kind === "problem") {
		// Work goes in once the teacher is free.
		const canSend = (s.hasText || s.hasFiles) && !s.busy;
		return {
			placeholder: "Your work",
			size: "lines",
			button: { action: "send", label: "Send", filled: canSend, disabled: !canSend },
			enter: canSend ? "send" : null,
			exit: "discard",
			attach: true,
			help: { dontKnow: "send", dontKnowDisabled: s.busy, linesDisabled: s.busy },
		};
	}
	if (turn.kind === "read-first") {
		return { placeholder: "Whatever comes to mind as you read.", size: "line", button: { action: "reveal", label: "Check your understanding", filled: true, disabled: false }, enter: "reveal", exit: "skip", attach: false, help: null };
	}
	const ready = turn.kind === "choice" ? turn.picked : s.hasText || (turn.takesFiles && s.hasFiles);
	// An answer to a question from earlier wakes nobody, so it goes in while the teacher writes.
	const canAnswer = !s.busy || (turn.kind === "choice" && turn.appPosed === "review");
	const canSubmit = ready && canAnswer;
	return {
		placeholder: turn.kind === "written" ? "Your answer" : turn.ownAnswer && !turn.picked ? "Pick one above, or type your own answer" : "Your reasoning (optional)",
		size: turn.kind === "written" ? "lines" : "line",
		button: { action: "submit", label: "Submit answer", filled: true, disabled: !canSubmit },
		enter: canSubmit ? "submit" : null,
		exit: "skip",
		attach: turn.kind === "written" ? turn.takesFiles : turn.ownAnswer === true && !turn.appPosed,
		help: { dontKnow: "answer", dontKnowDisabled: !canAnswer, linesDisabled: s.busy },
	};
}
