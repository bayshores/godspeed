import { useMemo } from "react";
import { readAgentModels, type AgentModels } from "@/shared/core";
import { useServerResource } from "@/frontend/components/use-server-resource";

/** The models the picked agent offers, read again when the agent changes or is checked again. No
 *  models until the agent answers, and while it can't. */
export function useAgentModels(): AgentModels {
	const { value } = useServerResource<unknown>("/api/agent/models", { on: { "agent-changed": true, "agent-health": true } });
	return useMemo(() => readAgentModels(value), [value]);
}
