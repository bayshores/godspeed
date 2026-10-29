"use client";

/**
 * THE OUTSIDE AGENT'S LIVE STATUS (owner, 2026-10-27): one read of
 * GET /api/mcp-access shared by every surface (sidebar footer, activity
 * panel, lesson composer, onboarding). It refreshes on the server's
 * "agent-changed" event (a check-in, a lapse, work starting or stopping
 * to wait), on reconnect, and when the window comes back.
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useServerEvent, useServerResync } from "@/components/server-events";

export interface AgentStatus {
	/** An agent checked in recently. */
	connected: boolean;
	/** The agent's name from its MCP handshake ("Claude Code"). */
	name?: string;
	/** Requests waiting for (or being handled by) the agent. */
	pendingWork: number;
}

/** The notice shown while work waits and no agent is connected. */
export const WAITING_NOTICE = "Waiting for your agent. Run /godspeed:teach";

/** True when work is waiting and no agent is there to take it. */
export function agentWaiting(status: AgentStatus | null): boolean {
	return !!status && !status.connected && status.pendingWork > 0;
}

/** Parse the /api/mcp-access body (pure — exported for tests). */
export function parseAgentStatus(body: unknown): AgentStatus | null {
	if (!body || typeof body !== "object") return null;
	const b = body as { agentConnected?: unknown; agentName?: unknown; pendingWork?: unknown };
	return {
		connected: b.agentConnected === true,
		...(typeof b.agentName === "string" && b.agentName.trim() ? { name: b.agentName.trim() } : {}),
		pendingWork: typeof b.pendingWork === "number" && b.pendingWork > 0 ? b.pendingWork : 0,
	};
}

/** True when two statuses read the same, so a poll can keep the old object
 *  and consumers skip a render (pure — exported for tests). */
export function sameAgentStatus(a: AgentStatus | null, b: AgentStatus): boolean {
	return !!a && a.connected === b.connected && a.name === b.name && a.pendingWork === b.pendingWork;
}

const AgentStatusContext = createContext<AgentStatus | null>(null);

export function AgentStatusProvider({ children }: { children: React.ReactNode }) {
	const [status, setStatus] = useState<AgentStatus | null>(null);
	const refresh = useCallback(() => {
		fetch("/api/mcp-access", { cache: "no-store" })
			.then((r) => (r.ok ? r.json() : null))
			.then((body) => {
				const next = parseAgentStatus(body);
				if (next) setStatus((prev) => (sameAgentStatus(prev, next) ? prev : next));
			})
			.catch(() => {/* keep the last status */});
	}, []);
	useEffect(() => {
		refresh();
		const onVisible = () => {
			if (document.visibilityState === "visible") refresh();
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => document.removeEventListener("visibilitychange", onVisible);
	}, [refresh]);
	useServerEvent("agent-changed", refresh);
	useServerResync(refresh);
	return <AgentStatusContext.Provider value={status}>{children}</AgentStatusContext.Provider>;
}

/** The live status; null until the first read (or outside the provider). */
export function useAgentStatus(): AgentStatus | null {
	return useContext(AgentStatusContext);
}

/** The sidebar footer's agent line (also Settings → Connection). Pure — exported for tests. While work waits and no
 *  agent is connected it reads "Waiting for your agent". */
export function footerLabel(agent: { connected: boolean; name?: string; pendingWork?: number } | null, jobs: number): string {
	const waiting = !!agent && !agent.connected && (agent.pendingWork ?? 0) > 0;
	const who = agent?.connected ? agent.name?.trim() || "Your agent" : waiting ? "Waiting for your agent" : "No agent connected";
	return jobs > 0 ? `${who} · ${jobs} job${jobs === 1 ? "" : "s"}` : who;
}
