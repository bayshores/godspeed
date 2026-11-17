/**
 * The lesson's answer box: for each thing that waits for the learner, the
 * box's button, what Enter does in it and the way out beside "Your turn".
 * Talking to the teacher happens in its terminal (use-terminal-lines.ts), so
 * the box takes only answers and work. Pure.
 */
import { answerTakesFiles, parseAskInput, parseExplainInput, toolQuestionKind, type AppPosed } from "@/shared/core";

/** What waits in the column. */
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
	button: BoxButton;
	/** What Enter in the box does; null makes a new line. */
	enter: BoxAction | null;
	/** The quiet button beside "Your turn". */
	exit: "skip" | "discard";
	/** Whether what the box sends carries attached files, so the Attach button shows. */
	attach: boolean;
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
		return { placeholder: "Your work", button: { action: "send", label: "Send", filled: canSend, disabled: !canSend }, enter: canSend ? "send" : null, exit: "discard", attach: true };
	}
	if (turn.kind === "read-first") {
		return { placeholder: "Whatever comes to mind as you read.", button: { action: "reveal", label: "Check your understanding", filled: true, disabled: false }, enter: "reveal", exit: "skip", attach: false };
	}
	const ready = turn.kind === "choice" ? turn.picked : s.hasText || (turn.takesFiles && s.hasFiles);
	// An answer to a question from earlier wakes nobody, so it goes in while the teacher writes.
	const canSubmit = ready && (!s.busy || (turn.kind === "choice" && turn.appPosed === "review"));
	return {
		placeholder: turn.kind === "written" ? "Your answer" : turn.ownAnswer && !turn.picked ? "Pick one above, or type your own answer" : "Your reasoning",
		button: { action: "submit", label: "Submit answer", filled: true, disabled: !canSubmit },
		enter: canSubmit ? "submit" : null,
		exit: "skip",
		attach: turn.kind === "written" ? turn.takesFiles : turn.ownAnswer === true && !turn.appPosed,
	};
}
