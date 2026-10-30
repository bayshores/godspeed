/**
 * What each outside agent has already seen of each lesson, so a later work
 * item sends only the new messages. Saved per agent (its own session id),
 * so an app restart doesn't re-send whole lessons and a second agent never
 * gets just the tail of a lesson it never saw.
 */
import { createHash } from "node:crypto";

/** How many messages of a conversation an agent has seen, and a hash of them. */
export interface SeenMark {
	count: number;
	hash: string;
}

/** Saved marks, per agent. */
export interface AgentSeenFile {
	agents: Record<string, { at: string; conversations: Record<string, SeenMark> }>;
}

/** Where marks are saved (store/agent-seen.ts). */
export interface SeenStore {
	get(agent: string, conversation: string): SeenMark | undefined;
	set(agent: string, conversation: string, mark: SeenMark): void;
	forgetAgent(agent: string): void;
}

/** Agents kept in the file; each new agent session drops the oldest. */
export const SEEN_AGENTS_MAX = 20;

/** The mark for a list of message fingerprints. */
export function seenMark(prints: readonly string[]): SeenMark {
	const hash = createHash("sha256");
	for (const print of prints) hash.update(print).update("\0");
	return { count: prints.length, hash: hash.digest("hex").slice(0, 32) };
}

/** True when the agent saw exactly the first `mark.count` of these messages. */
export function continuesFrom(mark: SeenMark | undefined, prints: readonly string[]): boolean {
	if (!mark || mark.count > prints.length) return false;
	return seenMark(prints.slice(0, mark.count)).hash === mark.hash;
}

/** A saved file, checked. Anything unreadable reads as nothing seen. */
export function parseAgentSeen(raw: unknown): AgentSeenFile {
	const out: AgentSeenFile = { agents: {} };
	const agents = (raw as { agents?: unknown } | null)?.agents;
	if (!agents || typeof agents !== "object") return out;
	for (const [agent, entry] of Object.entries(agents)) {
		const { at, conversations } = (entry ?? {}) as { at?: unknown; conversations?: unknown };
		if (typeof at !== "string" || !conversations || typeof conversations !== "object") continue;
		const kept: Record<string, SeenMark> = {};
		for (const [conversation, mark] of Object.entries(conversations)) {
			const { count, hash } = (mark ?? {}) as { count?: unknown; hash?: unknown };
			if (Number.isInteger(count) && (count as number) >= 0 && typeof hash === "string") kept[conversation] = { count: count as number, hash };
		}
		out.agents[agent] = { at, conversations: kept };
	}
	return out;
}

/** The file with one mark set, keeping the SEEN_AGENTS_MAX newest agents. */
export function withSeen(file: AgentSeenFile, agent: string, conversation: string, mark: SeenMark, at: string): AgentSeenFile {
	const entry = file.agents[agent];
	const agents = { ...file.agents, [agent]: { at, conversations: { ...entry?.conversations, [conversation]: mark } } };
	const newest = Object.entries(agents)
		.sort(([, a], [, b]) => b.at.localeCompare(a.at))
		.slice(0, SEEN_AGENTS_MAX);
	return { agents: Object.fromEntries(newest) };
}
