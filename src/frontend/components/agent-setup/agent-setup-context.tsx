/**
 * The picked agent's setup, read once for the window (GET /api/agent/health). The setup card in
 * Settings, onboarding and the teacher's panel, its compact form where a send failed, and the
 * strip's peek all read it here. It reads again on `agent-health`. An `agent-update` event carries
 * the update's newest line and state, which stands over the read's own: "done" is only told. While
 * a check fails, the window coming back to the front checks again, since the learner may have just
 * installed the agent or Node.js.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { readAgentHealth, readAgentUpdate, type AgentHealth, type AgentUpdate } from "@/shared/core";
import { jsonInit, send, type WriteResult } from "@/frontend/lib/api";
import { useServerEvent, useServerResync } from "@/frontend/components/server-events";
import { useServerResource } from "@/frontend/components/use-server-resource";

interface AgentSetup {
	/** null until read. */
	health: AgentHealth | null;
	/** The first read has answered, or failed (then nothing stands in for the agent). */
	read: boolean;
	/** The update as last told, else as last read. */
	update: AgentUpdate | null;
	/** Checks again now; the answer says a check runs. */
	checkAgain: () => Promise<WriteResult>;
}

const SetupContext = createContext<AgentSetup | null>(null);

export function AgentSetupProvider({ children }: { children: ReactNode }) {
	const { value, error, update: setValue } = useServerResource<unknown>("/api/agent/health", { on: { "agent-health": true } });
	const read = value !== null || error !== null;
	const health = useMemo(() => readAgentHealth(value), [value]);
	// What an `agent-update` event told, for the agent it was told for.
	const [told, setTold] = useState<{ agent: string; update: AgentUpdate } | null>(null);
	useServerEvent("agent-update", (payload) => {
		const update = readAgentUpdate(payload);
		if (update && health) setTold({ agent: health.agent, update });
	});
	// After a reconnect the read is newer than anything told before it.
	useServerResync(() => setTold(null));
	const update = told && told.agent === health?.agent ? told.update : (health?.update ?? null);

	const checkAgain = useCallback(async (): Promise<WriteResult> => {
		const { error, body } = await send("/api/agent/health", jsonInit("POST", {}));
		if (!error) setValue(() => body);
		return error;
	}, [setValue]);

	const failing = !!health?.failing;
	useEffect(() => {
		if (!failing) return;
		const back = () => {
			void checkAgain().then((error) => error && console.error("[agent setup] checking again failed:", error));
		};
		window.addEventListener("focus", back);
		return () => window.removeEventListener("focus", back);
	}, [failing, checkAgain]);

	const shared = useMemo(() => ({ health, read, update, checkAgain }), [health, read, update, checkAgain]);
	return <SetupContext.Provider value={shared}>{children}</SetupContext.Provider>;
}

/** Outside a provider (isolated renders): nothing to read. */
const OUTSIDE: AgentSetup = { health: null, read: true, update: null, checkAgain: async () => null };

export function useAgentSetup(): AgentSetup {
	return useContext(SetupContext) ?? OUTSIDE;
}
