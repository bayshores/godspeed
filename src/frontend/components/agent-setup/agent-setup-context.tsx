/**
 * The picked agent's setup, read once for the window (GET /api/agent/health). The setup card in
 * Settings and onboarding, its compact form in the teacher's panel and where a job failed, and the
 * strip's peek all read it here. It reads again on `agent-health`. A check that runs again for the
 * same agent still carries the answer before it, so that answer stands until the new one comes:
 * shown, a sign-in that just ended would flash its Log in key. An `agent-update` event carries the
 * update's newest line and state, which stands over the read's own: "done" is only told. While a
 * check fails, the window coming back to the front checks again, since the learner may have just
 * installed the agent or Node.js. The models the agent offers are read here too, once the agent
 * can be asked.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { readAgentHealth, readAgentModels, readAgentUpdate, type AgentHealth, type AgentModels, type AgentUpdate, type FolderAgent } from "@/shared/core";
import { jsonInit, send, type WriteResult } from "@/frontend/lib/api";
import { useAgentFolderView } from "@/frontend/components/agent-folder/agent-folder-context";
import { useServerEvent, useServerResync } from "@/frontend/components/server-events";
import { useServerResource } from "@/frontend/components/use-server-resource";
import { answered, cantRun } from "./agent-card-model";

interface AgentSetup {
	/** null until read. */
	health: AgentHealth | null;
	/** The first read has answered, or failed (then nothing stands in for the agent). */
	read: boolean;
	/** The update as last told, else as last read. */
	update: AgentUpdate | null;
	/** Whether the teacher can be asked: true once a check found the agent can run, false while one
	 *  found it can't. While the picked agent's first check runs it stays as it was; at the window's
	 *  start it is null. */
	askable: boolean | null;
	/** The models the picked agent offers; none until it can be asked. */
	models: AgentModels;
	/** Checks again now; the answer says a check runs. */
	checkAgain: () => Promise<WriteResult>;
}

const SetupContext = createContext<AgentSetup | null>(null);

export function AgentSetupProvider({ children }: { children: ReactNode }) {
	const { value, error, update: setValue } = useServerResource<unknown>("/api/agent/health", { on: { "agent-health": true } });
	const read = value !== null || error !== null;
	const answer = useMemo(() => readAgentHealth(value), [value]);
	const [settled, setSettled] = useState<AgentHealth | null>(null);
	const again = !!answer?.checking && answered(answer) && settled?.agent === answer.agent && settled.ownCommand === answer.ownCommand;
	if (!again && answer !== settled) setSettled(answer);
	const health = again ? settled : answer;
	const [wasAskable, setWasAskable] = useState<boolean | null>(null);
	const askable = answered(health) ? !cantRun(health) : wasAskable;
	if (askable !== wasAskable) setWasAskable(askable);
	const { value: rawModels } = useServerResource<unknown>(askable ? "/api/agent/models" : null, { on: { "agent-health": true } });
	const models = useMemo(() => readAgentModels(rawModels), [rawModels]);
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

	const shared = useMemo(() => ({ health, read, update, askable, models, checkAgain }), [health, read, update, askable, models, checkAgain]);
	return <SetupContext.Provider value={shared}>{children}</SetupContext.Provider>;
}

/** What `children` read stays as it last was while `hold` is true: a card that fades out keeps its
 *  words. */
export function HeldSetup({ hold, children }: { hold: boolean; children: ReactNode }) {
	const setup = useAgentSetup();
	const [held, setHeld] = useState(setup);
	if (!hold && held !== setup) setHeld(setup);
	return <SetupContext.Provider value={hold ? held : setup}>{children}</SetupContext.Provider>;
}

/** Outside a provider (isolated renders): nothing to read. */
const OUTSIDE: AgentSetup = { health: null, read: true, update: null, askable: null, models: readAgentModels(null), checkAgain: async () => null };

export function useAgentSetup(): AgentSetup {
	return useContext(SetupContext) ?? OUTSIDE;
}

/** The agent that is picked: the one the last check was for, else the folder's, else Claude Code. */
export function usePickedAgent(): FolderAgent {
	const { health } = useAgentSetup();
	const { view } = useAgentFolderView();
	return health?.agent ?? view?.agent ?? "claude";
}
