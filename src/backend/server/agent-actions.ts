/**
 * THE ACTIVITY LOG: what changed lately, and who did it. Every MCP tool
 * that changes something records one action here, as do the app (a linked
 * folder's new files) and the learner (answers, deadlines saved in the
 * app). The newest ACTIONS_MAX are saved to disk and served by
 * GET /api/agent-actions; each new one goes out as the "agent-action"
 * event so Follow can open the page an agent changed.
 *
 * globalThis-backed like the event bus: Next compiles routes as separate
 * module instances, and they must all share one list.
 */
import { randomUUID } from "node:crypto";
import { APP_SOURCE, emit, LEARNER_SOURCE, type AgentAction } from "../../shared/core/events.ts";
import type { QuestionAnswerData } from "../../shared/core/question-core.ts";
import type { DeadlinePatch } from "../../shared/core/ports.ts";
import { readAgentActions, writeAgentActions } from "../store/agent-actions.ts";

export const ACTIONS_MAX = 200;
/** The same label on the same target within this window updates the last
 *  entry instead of adding one (a lesson turn calls respond many times). */
export const COALESCE_MS = 2 * 60_000;
const LABEL_MAX = 80;

interface ActionsState {
	list: AgentAction[];
}

const KEY = Symbol.for("lh.agentActions");

/** Read from disk on first use, so the log survives a restart. */
function state(): ActionsState {
	const g = globalThis as Record<symbol, ActionsState | undefined>;
	return (g[KEY] ??= { list: readAgentActions() });
}

/** A failed save keeps the list in memory and never fails the change. */
function save(): void {
	try {
		writeAgentActions(state().list);
	} catch (err) {
		console.error("[agent-action] saving failed:", err);
	}
}

export type AgentActionInput = Omit<AgentAction, "id" | "at" | "agent"> & { agent?: string };

/** A label cut to a readable length. */
function shortLabel(text: string): string {
	const one = text.replace(/\s+/g, " ").trim();
	return one.length > LABEL_MAX ? `${one.slice(0, LABEL_MAX - 1).trimEnd()}…` : one;
}

function sameTarget(a: AgentAction["target"], b: AgentAction["target"]): boolean {
	return a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id);
}

/** Record one action and announce it. A repeat of the newest action (same
 *  label and target, within COALESCE_MS) only refreshes its time and is
 *  not announced again. Returns the stored action. */
export function recordAgentAction(input: AgentActionInput, now = Date.now()): AgentAction {
	const { list } = state();
	const label = shortLabel(input.label);
	const agent = input.agent?.trim() || "Your agent";
	const last = list.at(-1);
	if (last && last.label === label && last.agent === agent && sameTarget(last.target, input.target) && now - Date.parse(last.at) < COALESCE_MS && !input.removed) {
		last.at = new Date(now).toISOString();
		save();
		return last;
	}
	const action: AgentAction = {
		id: `act_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
		at: new Date(now).toISOString(),
		agent,
		label,
		spaceId: input.spaceId,
		target: input.target,
		page: input.page,
		...(input.removed ? { removed: true as const } : {}),
		...(input.open ? { open: true as const } : {}),
	};
	list.push(action);
	if (list.length > ACTIONS_MAX) list.splice(0, list.length - ACTIONS_MAX);
	save();
	emit("agent-action", action);
	return action;
}

/** Change the newest entry in place (it adds up several events) and
 *  announce it again. */
function updateNewest(last: AgentAction, label: string, now: number): void {
	last.label = label;
	last.at = new Date(now).toISOString();
	save();
	emit("agent-action", last);
}

const FOLDER_LABEL = /^Added (\d+) files? from (.+)$/;

/** A linked folder's new files, as the app's own entry: "Added 3 files from
 *  Google Drive". Scans a few minutes apart add to the newest such entry. */
export function recordFolderFiles(spaceId: string, count: number, from: string, now = Date.now()): void {
	const last = state().list.at(-1);
	const match = last?.agent === APP_SOURCE && last.spaceId === spaceId && now - Date.parse(last.at) < COALESCE_MS ? FOLDER_LABEL.exec(last.label) : null;
	const merged = match && match[2] === from ? Number(match[1]) + count : null;
	const label = (n: number) => `Added ${n} ${n === 1 ? "file" : "files"} from ${from}`;
	if (last && merged !== null) {
		updateNewest(last, label(merged), now);
		return;
	}
	recordAgentAction({ agent: APP_SOURCE, label: label(count), spaceId, target: null, page: "/space/files" }, now);
}

/** Right and total answers in an answer entry's label. */
function answerTally(label: string): { right: number; total: number } | null {
	if (label === "Answered right") return { right: 1, total: 1 };
	if (label === "Answered wrong" || label === "Didn't know") return { right: 0, total: 1 };
	const many = /^Answered (\d+) of (\d+) right$/.exec(label);
	return many ? { right: Number(many[1]), total: Number(many[2]) } : null;
}

/** A graded answer (quiz and probe questions; others are graded by the
 *  agent later) as the learner's entry. Answers to a lesson's questions in
 *  a row add up: "Answered 2 of 3 right". */
export function recordAnswer(lesson: { id: string; spaceId?: string }, answer: QuestionAnswerData, now = Date.now()): void {
	if (answer.kind !== "quiz") return;
	const right = !answer.dontKnow && answer.correct === true;
	const last = state().list.at(-1);
	const sum =
		last?.agent === LEARNER_SOURCE && sameTarget(last.target, { kind: "lesson", id: lesson.id }) && now - Date.parse(last.at) < COALESCE_MS
			? answerTally(last.label)
			: null;
	if (last && sum) {
		updateNewest(last, `Answered ${sum.right + (right ? 1 : 0)} of ${sum.total + 1} right`, now);
		return;
	}
	const label = answer.dontKnow ? "Didn't know" : right ? "Answered right" : "Answered wrong";
	recordAgentAction({ agent: LEARNER_SOURCE, label, spaceId: lesson.spaceId ?? null, target: { kind: "lesson", id: lesson.id }, page: `/chat/${lesson.id}` }, now);
}

/** A deadline the learner saved in the app, with the verbs the agent's
 *  entries use: "Added Test 2", "Moved Test 2", "Marked Test 2 done". */
export function recordDeadlineChange(spaceId: string, deadline: { id: string; name: string }, change: "added" | DeadlinePatch, now = Date.now()): void {
	const { name } = deadline;
	const keys = change === "added" ? [] : Object.keys(change);
	const label =
		change === "added"
			? `Added ${name}`
			: change.done !== undefined
				? `Marked ${name} ${change.done ? "done" : "not done"}`
				: `${keys.length > 0 && keys.every((k) => k === "date" || k === "time") ? "Moved" : "Changed"} ${name}`;
	recordAgentAction({ agent: LEARNER_SOURCE, label, spaceId, target: { kind: "deadline", id: deadline.id }, page: "/" }, now);
}

/** The saved actions, newest first. */
export function recentAgentActions(): AgentAction[] {
	return [...state().list].reverse();
}

/** Tests only: forget everything, on disk too. */
export function clearAgentActions(): void {
	state().list.length = 0;
	save();
}

/** Record what an agent changed, for the teacher's panel. Never fails the
 *  tool that made the change. */
export function noteAgentAction(caller: string | undefined, input: AgentActionInput): void {
	try {
		recordAgentAction({ ...input, agent: caller });
	} catch (err) {
		console.error("[agent-action] recording failed:", err);
	}
}
