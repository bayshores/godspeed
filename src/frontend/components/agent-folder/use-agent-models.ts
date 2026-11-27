import type { AgentModels } from "@/shared/core";
import { useAgentSetup } from "@/frontend/components/agent-setup/agent-setup-context";

/** The models the picked agent offers: none until the agent can be asked. */
export function useAgentModels(): AgentModels {
	return useAgentSetup().models;
}
