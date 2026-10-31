"use client";

/**
 * THE OUTSIDE AGENT'S LIVE STATUS: one read of
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
	/** The agent ran the work loop recently (wait_for_work, respond, read_work). */
	teaching: boolean;
	/** The agent's name from its MCP client info ("Claude Code"). */
	name?: string;
	/** Requests waiting for (or being handled by) the agent. */
	pendingWork: number;
	/** Lessons whose current request an agent took and hasn't answered, with the ISO claim time. */
	claimedLessons: { lessonId: string; claimedAt: string }[];
}

/** How to get the agent teaching: open one from the sidebar, or ask the
 *  connected one to start. */
export function teachStep(name?: string): string {
	return name ? `Tell ${name} to start teaching.` : "Open your agent from the sidebar.";
}

/** The notice shown while work waits and no agent is teaching. */
export function waitingNotice(name?: string): string {
	return `Waiting for your agent. ${teachStep(name)}`;
}

/** True when work is waiting and no agent is running the work loop to take it. */
export function agentWaiting(status: AgentStatus | null): boolean {
	return !!status && !status.teaching && status.pendingWork > 0;
}

/** Parse the /api/mcp-access body (pure — exported for tests). */
export function parseAgentStatus(body: unknown): AgentStatus | null {
	if (!body || typeof body !== "object") return null;
	const b = body as { agentConnected?: unknown; agentTeaching?: unknown; agentName?: unknown; pendingWork?: unknown; claimedLessons?: unknown };
	return {
		connected: b.agentConnected === true,
		teaching: b.agentTeaching === true,
		...(typeof b.agentName === "string" && b.agentName.trim() ? { name: b.agentName.trim() } : {}),
		pendingWork: typeof b.pendingWork === "number" && b.pendingWork > 0 ? b.pendingWork : 0,
		claimedLessons: Array.isArray(b.claimedLessons)
			? b.claimedLessons.filter((c): c is { lessonId: string; claimedAt: string } =>
				!!c && typeof c.lessonId === "string" && typeof c.claimedAt === "string")
			: [],
	};
}

/** True when two statuses read the same, so a poll can keep the old object
 *  and consumers skip a render (pure — exported for tests). */
export function sameAgentStatus(a: AgentStatus | null, b: AgentStatus): boolean {
	return !!a && a.connected === b.connected && a.teaching === b.teaching && a.name === b.name && a.pendingWork === b.pendingWork
		&& JSON.stringify(a.claimedLessons) === JSON.stringify(b.claimedLessons);
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

/** The sidebar footer's agent line (also Settings → Connection and Halley's
 *  panel). Pure — exported for tests. */
export function footerLabel(agent: Pick<AgentStatus, "connected" | "teaching" | "name" | "pendingWork"> | null, jobs: number): string {
	const name = agent?.name?.trim() || "Your agent";
	const who = !agent
		? "No agent connected"
		: agent.teaching
			? name
			: agent.connected
				? `${name} connected, not teaching`
				: agent.pendingWork > 0
					? "Waiting for your agent"
					: "No agent connected";
	return jobs > 0 ? `${who} · ${jobs} job${jobs === 1 ? "" : "s"}` : who;
}
