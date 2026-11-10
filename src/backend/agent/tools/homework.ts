/**
 * THE HOMEWORK TOOLS: post_problems saves the assignment's problems on its
 * deadline; problem opens one in the learner's Your turn panel (it ends
 * the turn, like practice's pose, but carries no solution: homework is
 * hints only); part marks the part the learner is on there; conclude
 * closes it and, when the learner's own work was right, marks it done.
 * The side tools are practice's.
 */
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { MAX_HOMEWORK_PROBLEMS, type HomeworkProblem } from "../../../shared/core/contracts/class.ts";
import { concludeMarksDone, type PostedProblem } from "../../../shared/core/homework.ts";
import { activeProblemOf } from "../../../shared/core/native-messages.ts";
import type { EnabledTools } from "../../../shared/core/tool-switches.ts";
import { concludeResult, invalidInputResult, problemResult } from "../tool-execute.ts";
import { healEncodedArguments, healToolRecord } from "./heal.ts";
import { practiceSideTools, type PracticeToolContext } from "./practice.ts";

/** The session's deadline, read and written through the class store. */
export interface HomeworkDeadline {
	problems(): readonly HomeworkProblem[];
	/** Saves the list (done marks kept by number); an error text when refused. */
	post(problems: PostedProblem[]): string | null;
	markDone(number: string): void;
}

export interface HomeworkToolContext extends Omit<PracticeToolContext, "graphNodes"> {
	homework: HomeworkDeadline;
}

/** The problem open now, by number; seeded once per turn from the record
 *  and flipped by the tools (the practice gate's reason). */
interface HomeworkGate {
	open: string | null;
}

const postProblemsInput = Type.Object({
	problems: Type.Array(
		Type.Object({
			number: Type.String({ description: 'As the assignment numbers it, e.g. "1", "2b", "Q3". Unique.' }),
			title: Type.String({ description: "A few words on what it asks." }),
			text: Type.String({ description: "The problem as the assignment states it (markdown + LaTeX), with any parts." }),
			page: Type.Optional(Type.Integer({ minimum: 1, description: "The assignment page it is on." })),
		}),
		{ minItems: 1, maxItems: MAX_HOMEWORK_PROBLEMS },
	),
});

const problemInput = Type.Object({
	number: Type.String({ description: "REQUIRED — the problem's number as posted with post_problems." }),
	statement: Type.String({ description: "REQUIRED — the problem as the learner sees it while working (markdown + LaTeX): the assignment's wording. Never any part of its answer." }),
});

const partInput = Type.Object({
	part: Type.String({ description: 'REQUIRED — the part as the problem labels it, e.g. "a", "b", "2".' }),
});

const concludeInput = Type.Object({
	outcome: Type.Union([Type.Literal("solved"), Type.Literal("solvedWithHints"), Type.Literal("movedOn"), Type.Literal("dismissed")], {
		description: "REQUIRED — solved or solvedWithHints once the learner's own work is right (marks the problem done), movedOn when the learner leaves it for now. Bare words, no quotes (dismissed is synthesized, never yours).",
	}),
	verdict: Type.String({ description: "REQUIRED — what was right in the learner's work, or where it still breaks. Never the answer." }),
});

export function homeworkTools(ctx: HomeworkToolContext, enabled?: EnabledTools): Record<string, AgentTool<any>> {
	const record = ctx.chatStore.getChat(ctx.chatId);
	const active = record ? activeProblemOf(record.messages) : null;
	const gate: HomeworkGate = { open: active ? String((active.input as { number?: unknown }).number ?? "") : null };

	const postProblems: AgentTool<typeof postProblemsInput> = {
		name: "post_problems",
		label: "post_problems",
		description:
			"Save the assignment's problems, all of them in order, in one call. The learner sees them as the session's list with how many are done. Calling it again replaces the list; a problem keeps its done mark by number.",
		parameters: postProblemsInput,
		executionMode: "sequential",
		prepareArguments: (args: unknown) => healEncodedArguments(args, postProblemsInput) as never,
		execute: async (_id, input) => {
			const refused = ctx.homework.post(input.problems);
			if (refused) return invalidInputResult("post_problems", [refused]);
			return { content: [{ type: "text", text: `Saved ${input.problems.length} problems.` }], details: null };
		},
	};

	const problem: AgentTool<typeof problemInput> = {
		name: "problem",
		label: "problem",
		description:
			"Open one problem in the learner's Your turn panel, where it stays in view. Ends the turn: the learner's work and questions arrive as their messages (text and photos). Only one problem is open at a time; conclude it before opening the next.",
		parameters: problemInput,
		executionMode: "sequential",
		prepareArguments: (args: unknown) => healEncodedArguments(args, problemInput) as never,
		execute: async (_id, input) => {
			if (gate.open !== null) return invalidInputResult("problem", [`problem ${gate.open} is still open — conclude it first`]);
			const numbers = ctx.homework.problems().map((p) => p.number);
			if (numbers.length === 0) return invalidInputResult("problem", ["no problems are posted yet — post them with post_problems first"]);
			if (!numbers.includes(input.number)) return invalidInputResult("problem", [`no problem numbered ${JSON.stringify(input.number)}; the numbers are ${numbers.join(", ")}`]);
			gate.open = input.number;
			return problemResult("the learner's work and questions arrive as their messages.");
		},
	};

	const part: AgentTool<typeof partInput> = {
		name: "part",
		label: "part",
		description: "For a problem with parts: mark the part the learner works on now, when they start it. Their panel marks it and scrolls the problem to it. Doesn't end the turn.",
		parameters: partInput,
		executionMode: "sequential",
		prepareArguments: (args: unknown) => healEncodedArguments(args, partInput) as never,
		execute: async () => {
			if (gate.open === null) return invalidInputResult("part", ["no problem is open"]);
			return { content: [{ type: "text", text: "Marked." }], details: null };
		},
	};

	const conclude: AgentTool<typeof concludeInput> = {
		name: "conclude",
		label: "conclude",
		description:
			"Close the open problem with the outcome and verdict; solved and solvedWithHints mark it done. Then say your closing words and END YOUR TURN: the next problem waits for the learner's go-ahead.",
		parameters: concludeInput,
		executionMode: "sequential",
		prepareArguments: (args: unknown) => healEncodedArguments(args, concludeInput) as never,
		execute: async (_id, input) => {
			if (gate.open === null) return invalidInputResult("conclude", ["no problem is open"]);
			if (concludeMarksDone(input.outcome)) ctx.homework.markDone(gate.open);
			gate.open = null;
			return concludeResult();
		},
	};

	return healToolRecord({ post_problems: postProblems, problem, part, conclude, ...practiceSideTools(ctx, enabled) });
}
