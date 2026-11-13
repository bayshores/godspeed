/**
 * The lesson plan's step bar: the plan's steps in learning order, each with
 * its status and the answers to its questions. The lesson UI calls it
 * client-side with its view messages; the server reads the same count off
 * the native record (planPositionLh). Pure and browser-safe.
 */
import type { LhMessage } from "./native-messages.ts";
import type { PlanNodeStatus, PlanTree } from "./contracts.ts";
import { derivedNodeStatus, derivePlanStatuses, derivePlanStatusesLh, orderedPlanNodes } from "./contracts.ts";
import { answerOutcome, isAnswerData, type AnswerOutcome } from "./progress.ts";
import { confidenceLevel, type ConfidenceLevel } from "./question-core.ts";

/** The view-message slice the step bar reads (core/view.ts LhViewMessage). */
interface StepBarMessage {
	parts: Array<{ type: string; state?: string; toolCallId?: string; input?: unknown; output?: unknown }>;
}

export interface StepAnswer {
	toolCallId: string;
	/** "ungraded": an explain answer (the teacher grades it in words). */
	outcome: AnswerOutcome | "ungraded";
	level?: ConfidenceLevel;
}

export interface PlanStep {
	id: string;
	title: string;
	status: PlanNodeStatus;
	/** The answers to questions about this step, in order. */
	answers: StepAnswer[];
}

export interface PlanStepBar {
	steps: PlanStep[];
	/** Index of the current step; -1 before the first tagged question. */
	currentIndex: number;
}

/** The step bar for a lesson: the plan's nodes in order with their status
 *  (derivePlanStatuses) and the answers per step (matched by the quiz's
 *  nodeId). Empty when the lesson has no plan yet. */
export function planStepBar(tree: PlanTree | null, messages: readonly StepBarMessage[]): PlanStepBar {
	if (!tree || tree.nodes.length === 0) return { steps: [], currentIndex: -1 };
	const statuses = derivePlanStatuses(tree, messages as Parameters<typeof derivePlanStatuses>[1]);
	const answers = new Map<string, StepAnswer[]>();
	for (const m of messages) {
		for (const part of m.parts) {
			if (part.type !== "tool-quiz" && part.type !== "tool-explain") continue;
			if (part.state !== "output-available" || !isAnswerData(part.output)) continue;
			const nodeId = (part.input as { nodeId?: unknown } | undefined)?.nodeId;
			if (typeof nodeId !== "string") continue;
			const ad = part.output;
			if (ad.dismissed) continue;
			const outcome = ad.kind === "explain" ? (ad.dontKnow ? "dontKnow" : "ungraded") : answerOutcome(ad);
			if (!outcome) continue;
			const entry: StepAnswer = {
				toolCallId: part.toolCallId ?? "",
				outcome,
				...(typeof ad.confidence === "number" && !ad.dontKnow ? { level: confidenceLevel(ad.confidence) } : {}),
			};
			const list = answers.get(nodeId);
			if (list) list.push(entry);
			else answers.set(nodeId, [entry]);
		}
	}
	const steps = orderedPlanNodes(tree).map((n) => ({
		id: n.id,
		title: n.title,
		status: derivedNodeStatus(statuses, n.id),
		answers: answers.get(n.id) ?? [],
	}));
	return { steps, currentIndex: steps.findIndex((s) => s.status === "current") };
}

/** The step bar's count ("2 / 4"): the current step's number, or the
 *  steps done while none is current. */
export function stepPosition(steps: ReadonlyArray<{ status: PlanNodeStatus }>): number {
	const current = steps.findIndex((s) => s.status === "current");
	return current >= 0 ? current + 1 : steps.filter((s) => s.status === "visited").length;
}

/** The step bar's count and length over the native record. */
export function planPositionLh(tree: PlanTree, messages: readonly LhMessage[]): { done: number; total: number } {
	const statuses = derivePlanStatusesLh(tree, messages);
	const steps = orderedPlanNodes(tree).map((n) => ({ status: derivedNodeStatus(statuses, n.id) }));
	return { done: stepPosition(steps), total: steps.length };
}
