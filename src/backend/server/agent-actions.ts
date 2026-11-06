/**
 * WHAT THE AGENT CHANGED (Halley): every MCP tool that changes
 * something records one action here. The last 20 are kept in memory for
 * the panel's "Recent" (GET /api/agent-actions; a restart clears them),
 * and each new one goes out as the "agent-action" event so the window can
 * fly Halley to it.
 *
 * globalThis-backed like the event bus: Next compiles routes as separate
 * module instances, and they must all share one list.
 */
import { randomUUID } from "node:crypto";
import { APP_SOURCE, emit, type AgentAction } from "../../shared/core/events.ts";

export const RECENT_LIMIT = 20;
/** The same label on the same target within this window updates the last
 *  entry instead of adding one (a lesson turn calls respond many times). */
export const COALESCE_MS = 2 * 60_000;
const LABEL_MAX = 80;

interface ActionsState {
	list: AgentAction[];
}

const KEY = Symbol.for("lh.agentActions");

function state(): ActionsState {
	const g = globalThis as Record<symbol, ActionsState | undefined>;
	return (g[KEY] ??= { list: [] });
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
		return last;
	}
	const action: AgentAction = {
		id: `act_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
		at: new Date(now).toISOString(),
		agent,
		label,
		classId: input.classId,
		target: input.target,
		page: input.page,
		...(input.removed ? { removed: true as const } : {}),
	};
	list.push(action);
	if (list.length > RECENT_LIMIT) list.splice(0, list.length - RECENT_LIMIT);
	emit("agent-action", action);
	return action;
}

const FOLDER_LABEL = /^Added (\d+) files? from (.+)$/;

/** A linked folder's new files, as the app's own entry: "Added 3 files from
 *  Google Drive". Scans a few minutes apart add to the newest such entry. */
export function recordFolderFiles(classId: string, count: number, from: string, now = Date.now()): void {
	const last = state().list.at(-1);
	const match = last?.agent === APP_SOURCE && last.classId === classId && now - Date.parse(last.at) < COALESCE_MS ? FOLDER_LABEL.exec(last.label) : null;
	const merged = match && match[2] === from ? Number(match[1]) + count : null;
	const label = (n: number) => `Added ${n} ${n === 1 ? "file" : "files"} from ${from}`;
	if (last && merged !== null) {
		last.label = label(merged);
		last.at = new Date(now).toISOString();
		emit("agent-action", last);
		return;
	}
	recordAgentAction({ agent: APP_SOURCE, label: label(count), classId, target: null, page: "/class/files" }, now);
}

/** The recent actions, newest first. */
export function recentAgentActions(): AgentAction[] {
	return [...state().list].reverse();
}

/** Tests only: forget everything. */
export function clearAgentActions(): void {
	state().list.length = 0;
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
