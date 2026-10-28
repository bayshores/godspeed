/** Read-time API-dollar estimates. Every call now runs on the outside agent
 * (owner, 2026-10-27), which bills its own plan, so no call has a per-token
 * price: every cost resolves null (unpriced) and the plan labels in
 * core/prices.ts name who paid. The folds stay so old records keep their
 * shape.
 */
import type { CallUsage, ChatRecord, JobRecord, TurnUsage } from "../core/contracts.ts";
import { sessionCost as foldSessionCost, turnCost as foldTurnCost, jobCost as foldJobCost } from "../core/prices.ts";

export function callCost(_call: Partial<CallUsage>, _modelId: string): number | null {
	return null;
}

export function turnCost(turn: TurnUsage): number | null {
	return foldTurnCost(turn, callCost);
}
export function sessionCost(record: Pick<ChatRecord, "turns">) {
	return foldSessionCost(record, callCost);
}
export function jobCost(job: Pick<JobRecord, "usage">): number | null {
	const usage = job.usage;
	if (!usage || usage.steps < 1) return null;
	return foldJobCost(job, callCost);
}
