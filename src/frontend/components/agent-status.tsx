/**
 * THE AGENT'S LIVE STATUS: one read of GET /api/mcp-access shared by
 * every surface (teacher pane, activity panel, lesson composer,
 * onboarding, Settings → Connection). It refreshes on the server's
 * "agent-changed" event (a check-in, a lapse), as a lesson turn
 * starts and settles, on reconnect, and when the window comes back. The
 * same read holds the address and token an outside app needs.
 */

import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { jsonInit, send, type WriteResult } from "@/frontend/lib/api";
import { useStableValue } from "@/frontend/lib/use-stable-value";
import { useServerResource } from "@/frontend/components/use-server-resource";

export interface AgentStatus {
	/** An agent in a terminal checked in recently. */
	connected: boolean;
	/** The agent's name from its MCP client info ("Claude Code"). The
	 *  learner sees the teacher's name instead, except in Settings, Connection. */
	name?: string;
	/** Lesson turns running now, in any lesson. */
	turnsRunning: number;
	/** The live terminals godspeed runs, and whether each checked in within 3 minutes. Absent: none. */
	terminals?: { id: string; here: boolean }[];
	/** An agent outside godspeed's terminals checked in within 3 minutes. Absent: not known. */
	outsideHere?: boolean;
}

/** Parse the /api/mcp-access body (pure — exported for tests). */
export function parseAgentStatus(body: unknown): AgentStatus | null {
	if (!body || typeof body !== "object") return null;
	const b = body as { agentConnected?: unknown; agentName?: unknown; turnsRunning?: unknown; terminals?: unknown; outsideHere?: unknown };
	return {
		connected: b.agentConnected === true,
		...(typeof b.agentName === "string" && b.agentName.trim() ? { name: b.agentName.trim() } : {}),
		turnsRunning: typeof b.turnsRunning === "number" && b.turnsRunning > 0 ? b.turnsRunning : 0,
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
	// A turn's start and end change `turnsRunning`.
	const { value: body, error, reload, update } = useServerResource<McpAccess>("/api/mcp-access", { on: { "agent-changed": true, "turn-started": true, "turn-settled": true } });
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

