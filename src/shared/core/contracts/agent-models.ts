/**
 * The models the picked agent offers (GET /api/agent/models), in the agent's own order, each with
 * the name the agent gives it ("Sonnet 5.5"). `default` marks the agent's own default.
 */
import { isFolderAgent, type FolderAgent } from "../agent-folder.ts";
import { isRecord } from "../is-record.ts";

export interface AgentModel {
	id: string;
	name: string;
	default: boolean;
}

/** The agent the list is for, null before it answers. */
export interface AgentModels {
	agent: FolderAgent | null;
	models: AgentModel[];
}

const str = (v: unknown): v is string => typeof v === "string" && v !== "";

/** The answer made safe to use: rows that are not models are left out. */
export function readAgentModels(raw: unknown): AgentModels {
	if (!isRecord(raw)) return { agent: null, models: [] };
	const models = Array.isArray(raw.models) ? raw.models : [];
	return {
		agent: isFolderAgent(raw.agent) ? raw.agent : null,
		models: models.flatMap((m): AgentModel[] => (isRecord(m) && str(m.id) && str(m.name) ? [{ id: m.id, name: m.name, default: m.default === true }] : [])),
	};
}
