import type * as AgentCore from "@earendil-works/pi-agent-core";

/**
 * The agent engine, loaded on first use. pi-agent-core (and the full pi-ai
 * it pulls in) costs ~0.25 s warm / ~0.5 s cold to load, so startup skips
 * it and the first lesson turn or background job pays instead.
 *
 * Async entry points await loadAgentCore() before building an Agent; the
 * sync builders (teacher-agent.ts) read agentCore() and fail loudly if
 * nobody loaded it first.
 */
let loaded: typeof AgentCore | null = null;
let loading: Promise<typeof AgentCore> | null = null;

export function loadAgentCore(): Promise<typeof AgentCore> {
	loading ??= import("@earendil-works/pi-agent-core").then((mod) => (loaded = mod));
	return loading;
}

/** The engine if it is already loaded, else null (lets callers skip an
 *  await, and its timing change, once the engine is in). */
export function loadedAgentCore(): typeof AgentCore | null {
	return loaded;
}

export function agentCore(): typeof AgentCore {
	if (!loaded) throw new Error("The agent engine is not loaded yet: await loadAgentCore() before building an agent.");
	return loaded;
}
