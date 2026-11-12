/**
 * The lesson's one writing box: for each state of the teacher column,
 * which buttons the box shows, what Enter does in it and which way out sits
 * beside "Your turn". Pure.
 */
import { answerTakesFiles, parseAskInput, parseExplainInput, toolQuestionKind } from "@/shared/core";

/** What waits in the column. */
export type BoxTurn =
	/** Nothing to answer; `next` is the go-ahead in the pause between problems. */
	| { kind: "none"; next?: string }
	| { kind: "problem" }
	/** A check waits behind "Check your understanding". */
	| { kind: "read-first" }
	/** The answer is picked above the box (choices, or the code editor). */
	| { kind: "choice"; picked: boolean }
	/** The box text is the answer. */
	| { kind: "written"; takesFiles: boolean };

export type BoxAction = "send" | "submit" | "reveal" | "next" | "stop";

export interface BoxButton {
	action: Exclude<BoxAction, "stop">;
	label: string;
	filled: boolean;
	disabled: boolean;
}

export interface BoxView {
	placeholder: string;
	left: BoxButton | null;
	right: BoxButton;
	/** What Enter in the box does; null makes a new line. */
	enter: BoxAction | null;
	/** The quiet button beside "Your turn". */
	exit: "skip" | "discard" | "stop" | null;
	/** A line over the box. */
	note: string | null;
}

/** A waiting question as the box sees it: written in the box, or picked
 *  above it (`picked` says whether an answer is). A question that came
 *  through broken is never answered, so it counts as nothing picked. */
export function questionTurn(tool: string, input: unknown, picked: boolean): BoxTurn {
	const kind = toolQuestionKind(tool);
	const ask = kind === "ask" ? parseAskInput(input) : undefined;
	const written = kind === "explain" ? parseExplainInput(input) !== undefined : ask !== undefined && !ask.options?.length;
	return written ? { kind: "written", takesFiles: answerTakesFiles(tool) } : { kind: "choice", picked };
}

export function lessonBox(s: {
	/** The teacher's name. */
	name: string;
	/** A reply is being written (or waits for an agent). */
	busy: boolean;
	waitingForAgent: boolean;
	hasText: boolean;
	hasFiles: boolean;
	turn: BoxTurn;
}): BoxView {
	const { turn } = s;
	const canSend = s.hasText || s.hasFiles;
	const empty = !canSend;

	if (turn.kind === "none" || turn.kind === "problem") {
		const placeholder = turn.kind === "problem" ? `Message ${s.name}, or type your work` : `Message ${s.name}`;
		if (s.busy) {
			// Typed text steers the reply; a steer carries no files.
			const canSteer = s.hasText && !s.hasFiles;
			return {
				placeholder,
				left: null,
				right: { action: "send", label: s.waitingForAgent ? "Send" : "Send when ready", filled: false, disabled: !canSteer },
				enter: canSteer ? "send" : empty ? "stop" : null,
				exit: "stop",
				note: s.hasFiles ? "Send pictures after the teacher finishes" : null,
			};
		}
		const send: BoxButton = { action: "send", label: "Send", filled: canSend, disabled: !canSend };
		const exit = turn.kind === "problem" ? "discard" : null;
		if (turn.kind === "none" && turn.next !== undefined) {
			return {
				placeholder,
				left: { ...send, filled: false },
				right: { action: "next", label: turn.next, filled: true, disabled: false },
				enter: canSend ? "send" : "next",
				exit,
				note: null,
			};
		}
		return { placeholder, left: null, right: send, enter: canSend ? "send" : null, exit, note: null };
	}

	// A question waits: the box can always ask about it instead, once the teacher is free.
	const ask: BoxButton = { action: "send", label: `Ask ${s.name}`, filled: false, disabled: s.busy || !canSend };
	const exit = s.busy ? "stop" : "skip";
	const idleEnter = s.busy && empty ? "stop" : null;
	if (turn.kind === "read-first") {
		return {
			placeholder: "Whatever comes to mind as you read.",
			left: ask,
			right: { action: "reveal", label: "Check your understanding", filled: true, disabled: false },
			enter: "reveal",
			exit,
			note: null,
		};
	}
	const ready = turn.kind === "choice" ? turn.picked : s.hasText || (turn.takesFiles && s.hasFiles);
	const canSubmit = ready && !s.busy;
	return {
		placeholder: turn.kind === "choice" ? `Your reasoning, or a question for ${s.name}` : `Type your answer, or a question for ${s.name}`,
		left: ask,
		right: { action: "submit", label: "Submit answer", filled: true, disabled: !canSubmit },
		enter: canSubmit ? "submit" : idleEnter,
		exit,
		note: null,
	};
}
