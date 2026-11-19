/**
 * THE OUTSIDE AGENT'S LIVE STATUS: one read of
 * GET /api/mcp-access shared by every surface (teacher pane, activity
 * panel, lesson composer, onboarding, Settings → Connection). It refreshes
 * on the server's "agent-changed" event (a check-in, a lapse, work
 * starting or stopping to wait), on reconnect, and when the window comes
 * back. The same read holds the address and token an outside app needs.
 */

import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { jsonInit, send, type WriteResult } from "@/frontend/lib/api";
import { useStableValue } from "@/frontend/lib/use-stable-value";
import { useServerResource } from "@/frontend/components/use-server-resource";

export interface AgentStatus {
	/** An agent checked in recently. */
	connected: boolean;
	/** The agent ran the work loop recently (wait_for_work, respond, read_work). */
	teaching: boolean;
	/** The agent's name from its MCP client info ("Claude Code"). The
	 *  learner sees the teacher's name instead, except in Settings, Connection. */
	name?: string;
	/** A helper waits, or still works on an item it took. */
	helperHere: boolean;
	/** The teacher is compacting its context and the helper answers meanwhile. */
	helperCovering: boolean;
	/** Requests waiting for (or being handled by) the agent. */
	pendingWork: number;
	/** Those that are lesson turns; the rest are background jobs. */
	pendingTurns: number;
	/** Background jobs no one took that a helper would take now: the window starts one for them. */
	helperWork: number;
	/** Lessons whose current request an agent took and hasn't answered, with the ISO claim time. */
	claimedLessons: { lessonId: string; claimedAt: string }[];
	/** The live terminals godspeed runs, and whether each checked in within 3 minutes. Absent: none. */
	terminals?: { id: string; here: boolean }[];
	/** An agent outside godspeed's terminals checked in within 3 minutes. Absent: not known. */
	outsideHere?: boolean;
}

/** How to get the teacher teaching: turn it on, or tell the connected one to start. */
export function teachStep(teacher: string, connected: boolean): string {
	return connected ? `Tell ${teacher} to start teaching.` : `Turn on ${teacher} to begin.`;
}

/** The notice shown while work waits and no agent is teaching. */
export function waitingNotice(teacher: string, connected: boolean): string {
	return connected ? `Waiting for ${teacher}. Tell it to start teaching.` : teachStep(teacher, false);
}

/** True when work is waiting and no agent is running the work loop to take it. */
export function agentWaiting(status: AgentStatus | null): boolean {
	return !!status && !status.teaching && status.pendingWork > 0;
}

/** True in a lesson when no agent is teaching (none connected, or one not
 *  running the work loop), whether or not a turn is running. */
export function lessonAgentWaiting(status: AgentStatus | null): boolean {
	return !!status && !status.teaching;
}

/** Parse the /api/mcp-access body (pure — exported for tests). */
export function parseAgentStatus(body: unknown): AgentStatus | null {
	if (!body || typeof body !== "object") return null;
	const b = body as { agentConnected?: unknown; agentTeaching?: unknown; agentName?: unknown; helperHere?: unknown; helperCovering?: unknown; pendingWork?: unknown; pendingTurns?: unknown; helperWork?: unknown; claimedLessons?: unknown; terminals?: unknown; outsideHere?: unknown };
	return {
		connected: b.agentConnected === true,
		teaching: b.agentTeaching === true,
		...(typeof b.agentName === "string" && b.agentName.trim() ? { name: b.agentName.trim() } : {}),
		helperHere: b.helperHere === true,
		helperCovering: b.helperCovering === true,
		pendingWork: typeof b.pendingWork === "number" && b.pendingWork > 0 ? b.pendingWork : 0,
		pendingTurns: typeof b.pendingTurns === "number" && b.pendingTurns > 0 ? b.pendingTurns : 0,
		helperWork: typeof b.helperWork === "number" && b.helperWork > 0 ? b.helperWork : 0,
		claimedLessons: Array.isArray(b.claimedLessons)
			? b.claimedLessons.filter((c): c is { lessonId: string; claimedAt: string } =>
				!!c && typeof c.lessonId === "string" && typeof c.claimedAt === "string")
			: [],
		...(Array.isArray(b.terminals)
			? { terminals: b.terminals.filter((t): t is { id: string; here: boolean } => !!t && typeof t.id === "string" && typeof t.here === "boolean").map((t) => ({ id: t.id, here: t.here })) }
			: {}),
		...(typeof b.outsideHere === "boolean" ? { outsideHere: b.outsideHere } : {}),
	};
}

/** The desktop app's terminals provide it again, corrected (use-terminals.ts). */
export const AgentStatusContext = createContext<AgentStatus | null>(null);

/** What an outside MCP app needs: the address and the access token. */
interface McpAccess {
	url: string;
	token: string;
}

interface AccessState {
	/** null until read. */
	access: McpAccess | null;
	/** The last read failed. */
	failed: boolean;
	/** Make a new token: the error line, or null once made. */
	rotate: () => Promise<WriteResult>;
}

const AccessContext = createContext<AccessState>({ access: null, failed: false, rotate: async () => null });

export function AgentStatusProvider({ children }: { children: React.ReactNode }) {
	// A failed read keeps the last status.
	const { value: body, error, reload, update } = useServerResource<McpAccess>("/api/mcp-access", { on: { "agent-changed": true } });
	// Unchanged figures keep the same object, so readers skip a render.
	const status = useStableValue(parseAgentStatus(body));
	useEffect(() => {
		const onVisible = () => {
			if (document.visibilityState === "visible") void reload();
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => document.removeEventListener("visibilitychange", onVisible);
	}, [reload]);
	const rotate = useCallback(async () => {
		const made = await send("/api/mcp-access", jsonInit("POST", { action: "rotate" }));
		if (made.error === null) update(() => made.body as McpAccess);
		return made.error;
	}, [update]);
	const access = useMemo<AccessState>(() => ({ access: body && { url: body.url, token: body.token }, failed: error !== null, rotate }), [body, error, rotate]);
	return (
		<AccessContext.Provider value={access}>
			<AgentStatusContext.Provider value={status}>{children}</AgentStatusContext.Provider>
		</AccessContext.Provider>
	);
}

/** The address and token an outside app needs, from the status's read. */
export function useMcpAccess(): AccessState {
	return useContext(AccessContext);
}

/** The live status; null until the first read (or outside the provider). */
export function useAgentStatus(): AgentStatus | null {
	return useContext(AgentStatusContext);
}

/** The teacher's status line (the top bar and the teacher panel), by the
 *  teacher's name. Connected but not teaching is only "on". Pure, exported
 *  for tests. */
export function agentStatusLabel(agent: Pick<AgentStatus, "connected" | "teaching" | "pendingWork"> | null, teacher: string): string {
	return !agent
		? `${teacher} is off`
		: agent.teaching
			? teacher
			: agent.connected
				? `${teacher} is on`
				: agent.pendingWork > 0
					? `Waiting for ${teacher}`
					: `${teacher} is off`;
}
