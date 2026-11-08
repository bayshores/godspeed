/**
 * data/agent-actions.json: the activity log (server/agent-actions.ts),
 * oldest first. Rewritten whole on each change; small by design
 * (ACTIONS_MAX entries).
 */
import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../config.ts";
import type { AgentAction } from "../../shared/core/events.ts";
import { setAsideCorrupt } from "./set-aside.ts";
import { writeFileAtomic } from "./write-file-atomic.ts";

const ACTIONS_FILE = path.join(PATHS.data, "agent-actions.json");
const VERSION = 1;
const TARGET_KINDS = new Set(["deadline", "file", "class", "lesson"]);

function parseAction(entry: unknown): AgentAction[] {
	const a = entry as Partial<Record<keyof AgentAction, unknown>> | null;
	if (typeof a?.id !== "string" || typeof a.at !== "string" || typeof a.agent !== "string" || typeof a.label !== "string" || typeof a.page !== "string") return [];
	const t = a.target as { kind?: unknown; id?: unknown } | null | undefined;
	const target = t && TARGET_KINDS.has(t.kind as string) && typeof t.id === "string" ? { kind: t.kind as NonNullable<AgentAction["target"]>["kind"], id: t.id } : null;
	return [
		{
			id: a.id,
			at: a.at,
			agent: a.agent,
			label: a.label,
			classId: typeof a.classId === "string" ? a.classId : null,
			target,
			page: a.page,
			...(a.removed === true ? { removed: true as const } : {}),
			...(a.open === true ? { open: true as const } : {}),
		},
	];
}

/** Oldest first. A missing file reads as no actions; a broken one is set aside. */
export function readAgentActions(): AgentAction[] {
	try {
		const list = (JSON.parse(fs.readFileSync(ACTIONS_FILE, "utf8")) as { actions?: unknown } | null)?.actions;
		return Array.isArray(list) ? list.flatMap(parseAction) : [];
	} catch (err) {
		if (err instanceof SyntaxError) setAsideCorrupt(ACTIONS_FILE);
		return [];
	}
}

export function writeAgentActions(actions: readonly AgentAction[]): void {
	writeFileAtomic(ACTIONS_FILE, JSON.stringify({ version: VERSION, actions }, null, "\t"));
}
