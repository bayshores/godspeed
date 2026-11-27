/**
 * The models the picked agent offers (GET /api/agent/models), in the agent's own order, each with
 * the name the agent gives it ("Sonnet 5.5"). `default` marks the agent's own default.
 */
import { isFolderAgent, type FolderAgent } from "../agent-folder.ts";
import { isRecord, isText } from "../is-record.ts";

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

/** The model `id` names, else the agent's own default, else none. */
export function shownModel(models: readonly AgentModel[], id: string | null): AgentModel | null {
	return models.find((m) => m.id === id) ?? models.find((m) => m.default) ?? null;
}

/** The answer made safe to use: rows that are not models are left out. */
export function readAgentModels(raw: unknown): AgentModels {
	if (!isRecord(raw)) return { agent: null, models: [] };
	const models = Array.isArray(raw.models) ? raw.models : [];
	return {
		agent: isFolderAgent(raw.agent) ? raw.agent : null,
		models: models.flatMap((m): AgentModel[] => (isRecord(m) && isText(m.id) && isText(m.name) ? [{ id: m.id, name: m.name, default: m.default === true }] : [])),
	};
}
