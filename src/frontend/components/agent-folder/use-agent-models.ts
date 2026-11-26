import { useMemo } from "react";
import { readAgentModels, type AgentModels } from "@/shared/core";
import { useServerResource } from "@/frontend/components/use-server-resource";

/** The models the picked agent offers, read again each time the agent is checked. No models until
 *  the agent answers, and while it can't. */
export function useAgentModels(): AgentModels {
	const { value } = useServerResource<unknown>("/api/agent/models", { on: { "agent-health": true } });
	return useMemo(() => readAgentModels(value), [value]);
}
